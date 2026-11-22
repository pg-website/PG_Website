'use client'

import { useEffect, useState, useTransition } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Banner } from '@/components/ui/feedback/Banner'
import { useToast } from '@/components/ui/feedback/useToast'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { copyFor } from '@/lib/api/error-copy'
import { newIdempotencyKey } from '@/lib/api/idempotency'
import type { IdempotencyKey } from '@/lib/api/types/primitives'
import { rupeesToPaise } from '@/lib/format/money'
import { adminPlayersQuery } from '@/lib/query/query-options/admin'
import type { AdminPlayerRowDto } from '@/lib/api/types/admin/players'
import type { EventOverviewDto } from '@/lib/api/types/admin/control-overview'
import { ConfirmSummary } from '@/features/event-control/registrations/ConfirmSummary'
import { PlayerResultItem } from '@/features/event-control/registrations/PlayerResultItem'

// CashRegisterDialog (FEAT-002, TASK-007). Toolbar button + two-step modal:
//   Step 1 — search a player + enter collected amount.
//   Step 2 — confirm: player name, event name, published fee, entered amount side-by-side.
// Rules followed: sub-components extracted (rule 5.4), useTransition for submit (rule 6.11),
// lazy state init for amount (rule 5.12), functional setState for selectedPlayer (rule 5.11),
// explicit conditional rendering (rule 6.9).

const DEBOUNCE_MS = 300
const SEARCH_MIN = 2
const CANCEL_BTN_CLASS =
  'inline-flex min-h-control min-w-0 items-center justify-center rounded-public border border-forest bg-transparent px-6 py-3 text-center type-button text-forest hover:bg-line'

// ---- Main component ----

export interface CashRegisterDialogProps {
  eventId: string
  overview: EventOverviewDto
  onSuccess: () => void
}

/**
 * Cash registration toolbar button + two-step dialog (FEAT-002).
 * The parent is responsible for not rendering this component on free events or cancelled/completed events.
 */
export function CashRegisterDialog({ eventId, overview, onSuccess }: CashRegisterDialogProps) {
  const api = useApi()
  const toast = useToast()
  // Free events have nothing to collect: the same dialog enrolls the player directly (admin_enrolled).
  const free = overview.pricePaise === 0

  // dialog open state
  const [open, setOpen] = useState(false)
  // two-step flow
  const [step, setStep] = useState<'search' | 'confirm'>('search')

  // player search state
  const [searchText, setSearchText] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  // functional setState: new state depends on previous (toggle selection)
  const [selectedPlayer, setSelectedPlayer] = useState<AdminPlayerRowDto | null>(null)

  // amount: lazy state init from event entry fee (rule 5.12)
  const [amountRupees, setAmountRupees] = useState(() => {
    const p = overview.pricePaise
    return p !== undefined && p > 0 ? String(p / 100) : ''
  })

  // submit error and idempotency key
  const [error, setError] = useState<unknown>(null)
  const [intentKey, setIntentKey] = useState<IdempotencyKey>(() => newIdempotencyKey())
  const [isPending, startTransition] = useTransition()

  // debounce player search text (rule: defer API calls, not UI updates)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchText.trim())
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [searchText])
  // Derived: too-short input disables the query immediately, without waiting for the debounce.
  const searchQ = searchText.trim().length < SEARCH_MIN || debouncedQ.length < SEARCH_MIN ? undefined : debouncedQ

  // player search query — always called (rule: no conditional hooks)
  const searchQuery = useQuery({
    ...adminPlayersQuery(api.admin, searchQ !== undefined ? { q: searchQ, pageSize: 10 } : undefined),
    enabled: searchQ !== undefined,
    placeholderData: keepPreviousData,
  })

  // ---- derived state (rule 5.1: derive during render, not in effects) ----
  const parsedPaise = rupeesToPaise(amountRupees)
  const amountValid = free || (parsedPaise !== null && parsedPaise > 0)
  const showAmountError = !free && amountRupees.trim() !== '' && !amountValid
  const confirmEnabled = selectedPlayer !== null && amountValid && !isPending
  const players = searchQuery.data?.items ?? []
  const errorCopy =
    error === null ? null : copyFor(error, { action: free ? 'enroll this player' : 'register this player with cash' })

  // ---- event handlers ----

  const openDialog = () => {
    setStep('search')
    setSearchText('')
    setDebouncedQ('')
    setSelectedPlayer(null)
    // reset amount to current event price each time dialog opens
    const p = overview.pricePaise
    setAmountRupees(p !== undefined && p > 0 ? String(p / 100) : '')
    setError(null)
    setIntentKey(newIdempotencyKey())
    setOpen(true)
  }

  const handlePlayerSelect = (player: AdminPlayerRowDto) => {
    // functional setState: toggle selection based on previous state (rule 5.11)
    setSelectedPlayer((current) => (current?.id === player.id ? null : player))
  }

  const handleNext = () => {
    if (!confirmEnabled) return
    setError(null)
    setStep('confirm')
  }

  const handleBack = () => {
    setStep('search')
    setError(null)
  }

  const handleConfirm = () => {
    if (selectedPlayer === null || (!free && parsedPaise === null)) return
    setError(null)
    // useTransition for submit — keeps UI responsive (rule 6.11)
    startTransition(async () => {
      try {
        if (free) {
          await api.admin.events.enrollPlayer(eventId, { playerId: selectedPlayer.id }, intentKey)
        } else if (parsedPaise !== null) {
          await api.admin.control.cashRegisterPlayer(
            eventId,
            { playerId: selectedPlayer.id, amountPaise: parsedPaise },
            intentKey,
          )
        }
        setOpen(false)
        onSuccess()
        toast.success(free ? `${selectedPlayer.name} enrolled` : `${selectedPlayer.name} registered with cash payment`)
      } catch (err) {
        setError(err)
      }
    })
  }

  // ---- footer (changes per step) ----

  const footer =
    step === 'search' ? (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
          }}
          className={CANCEL_BTN_CLASS}
        >
          Cancel
        </button>
        <Button variant="primary" size="lg" disabled={!confirmEnabled} onClick={handleNext}>
          Review
        </Button>
      </>
    ) : (
      <>
        <button
          type="button"
          aria-disabled={isPending || undefined}
          onClick={isPending ? undefined : handleBack}
          className={CANCEL_BTN_CLASS}
        >
          Back
        </button>
        <Button
          variant="primary"
          size="lg"
          disabled={!confirmEnabled}
          loading={isPending}
          loadingLabel={free ? 'Enrolling…' : 'Registering…'}
          onClick={handleConfirm}
        >
          {free ? 'Confirm enrollment' : 'Confirm cash payment'}
        </Button>
      </>
    )

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        {free ? 'Enroll player' : 'Register with cash'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={free ? 'Enroll player' : 'Register with cash'}
        descriptionText={
          free
            ? 'Add a player to this free event. The registration is marked confirmed immediately.'
            : "Confirm a player's cash payment at the desk. The registration is marked confirmed immediately."
        }
        dismissible={!isPending}
        footer={footer}
        size="md"
      >
        {step === 'search' ? (
          <div className="grid gap-4">
            <Field label="Search for player" hint="Enter at least 2 characters — name, email or phone.">
              <Input
                type="search"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value)
                }}
                placeholder="Name, email or phone"
                autoComplete="off"
              />
            </Field>

            {searchQ !== undefined ? (
              <div className="grid gap-2" role="listbox" aria-label="Player search results">
                {searchQuery.isPending ? (
                  <p className="text-sm text-ink-soft">Searching…</p>
                ) : players.length === 0 ? (
                  <p className="text-sm text-ink-soft">No players found for &ldquo;{searchQ}&rdquo;.</p>
                ) : (
                  players.map((player) => (
                    <PlayerResultItem
                      key={player.id}
                      player={player}
                      selected={selectedPlayer?.id === player.id}
                      onSelect={handlePlayerSelect}
                    />
                  ))
                )}
              </div>
            ) : null}

            {free ? null : (
              <Field
                label="Amount collected (₹)"
                hint="Whole rupees or up to 2 decimal places (e.g. 500 or 500.50)."
                error={showAmountError ? 'Enter a valid amount greater than zero' : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={amountRupees}
                  onChange={(event) => {
                    setAmountRupees(event.target.value)
                  }}
                  placeholder="e.g. 500"
                />
              </Field>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <ConfirmSummary
              playerName={selectedPlayer?.name ?? ''}
              eventTitle={overview.title}
              eventPricePaise={overview.pricePaise}
              amountRupees={amountRupees}
              free={free}
            />
            {errorCopy !== null ? (
              <Banner tone="danger" title={errorCopy.title} live="alert">
                {errorCopy.body}
              </Banner>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  )
}
