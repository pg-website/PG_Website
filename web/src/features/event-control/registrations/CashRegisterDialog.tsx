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
import { rupeesToPaise } from '@/features/admin/payments/payments-labels'
import { adminPlayersQuery } from '@/lib/query/query-options/admin'
import type { AdminPlayerRowDto } from '@/lib/api/types/admin/players'
import type { EventOverviewDto } from '@/lib/api/types/admin/control-overview'
import { formatInr } from '@/lib/format/money'

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

// ---- Sub-components (defined OUTSIDE CashRegisterDialog — rule 5.4) ----

interface PlayerResultItemProps {
  player: AdminPlayerRowDto
  selected: boolean
  onSelect: (player: AdminPlayerRowDto) => void
}

/** One player row in the search results list. */
function PlayerResultItem({ player, selected, onSelect }: PlayerResultItemProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(player)
      }}
      aria-pressed={selected}
      className={[
        'w-full rounded-public border px-3 py-2 text-left text-sm transition-colors',
        selected
          ? 'border-forest bg-forest/10 text-ink'
          : 'border-line bg-transparent text-ink hover:border-forest/40',
      ].join(' ')}
    >
      <span className="block font-semibold">{player.name}</span>
      <span className="block text-xs text-ink-soft">{player.email}</span>
    </button>
  )
}

interface ConfirmSummaryProps {
  playerName: string
  eventTitle: string
  eventPricePaise: number | undefined
  amountRupees: string
}

/** Confirmation view: player, event, published fee and entered amount. */
function ConfirmSummary({ playerName, eventTitle, eventPricePaise, amountRupees }: ConfirmSummaryProps) {
  const enteredPaise = rupeesToPaise(amountRupees)
  const feeMatches = eventPricePaise === undefined || enteredPaise === eventPricePaise
  return (
    <dl className="grid gap-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="font-semibold text-ink-soft">Player</dt>
        <dd className="text-ink">{playerName}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="font-semibold text-ink-soft">Event</dt>
        <dd className="text-ink">{eventTitle}</dd>
      </div>
      {eventPricePaise !== undefined ? (
        <div className="flex justify-between gap-4">
          <dt className="font-semibold text-ink-soft">Published fee</dt>
          <dd className="text-ink">{formatInr(eventPricePaise, { zero: 'amount' })}</dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-4">
        <dt className="font-semibold text-ink-soft">Amount collected</dt>
        <dd className={feeMatches ? 'text-ink' : 'text-warning-ink font-semibold'}>
          {enteredPaise !== null ? formatInr(enteredPaise, { zero: 'amount' }) : amountRupees}
        </dd>
      </div>
      {!feeMatches ? (
        <p className="text-xs text-warning-ink">The collected amount differs from the published entry fee.</p>
      ) : null}
    </dl>
  )
}

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

  // dialog open state
  const [open, setOpen] = useState(false)
  // two-step flow
  const [step, setStep] = useState<'search' | 'confirm'>('search')

  // player search state
  const [searchText, setSearchText] = useState('')
  const [searchQ, setSearchQ] = useState<string | undefined>(undefined)
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
    const q = searchText.trim()
    if (q.length < SEARCH_MIN) {
      setSearchQ(undefined)
      return
    }
    const timer = setTimeout(() => {
      setSearchQ(q)
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [searchText])

  // player search query — always called (rule: no conditional hooks)
  const searchQuery = useQuery({
    ...adminPlayersQuery(api.admin, searchQ !== undefined ? { q: searchQ, pageSize: 10 } : undefined),
    enabled: searchQ !== undefined,
    placeholderData: keepPreviousData,
  })

  // ---- derived state (rule 5.1: derive during render, not in effects) ----
  const parsedPaise = rupeesToPaise(amountRupees)
  const amountValid = parsedPaise !== null && parsedPaise > 0
  const showAmountError = amountRupees.trim() !== '' && !amountValid
  const confirmEnabled = selectedPlayer !== null && amountValid && !isPending
  const players = searchQuery.data?.items ?? []
  const errorCopy = error === null ? null : copyFor(error, { action: 'register this player with cash' })

  // ---- event handlers ----

  const openDialog = () => {
    setStep('search')
    setSearchText('')
    setSearchQ(undefined)
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
    if (selectedPlayer === null || parsedPaise === null) return
    setError(null)
    // useTransition for submit — keeps UI responsive (rule 6.11)
    startTransition(async () => {
      try {
        await api.admin.control.cashRegisterPlayer(
          eventId,
          { playerId: selectedPlayer.id, amountPaise: parsedPaise },
          intentKey,
        )
        setOpen(false)
        onSuccess()
        toast.success(`${selectedPlayer.name} registered with cash payment`)
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
        <Button
          variant="primary"
          size="lg"
          disabled={!confirmEnabled}
          onClick={handleNext}
        >
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
          loadingLabel="Registering…"
          onClick={handleConfirm}
        >
          Confirm cash payment
        </Button>
      </>
    )

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        Register with cash
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Register with cash"
        descriptionText="Confirm a player's cash payment at the desk. The registration is marked confirmed immediately."
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
                  <p className="text-sm text-ink-soft">No players found for "{searchQ}".</p>
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
          </div>
        ) : (
          <div className="grid gap-4">
            <ConfirmSummary
              playerName={selectedPlayer?.name ?? ''}
              eventTitle={overview.title}
              eventPricePaise={overview.pricePaise}
              amountRupees={amountRupees}
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
