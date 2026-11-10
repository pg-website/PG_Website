'use client'

import { useDeferredValue, useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banner } from '@/components/ui/feedback/Banner'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { pushToast } from '@/components/ui/feedback/toastStore'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { copyFor } from '@/lib/api/error-copy'
import { isAbortError, isApiError } from '@/lib/api/errors'
import { newIdempotencyKey } from '@/lib/api/idempotency'
import type { AdminPlayerDto } from '@/lib/api/types/admin/players'
import type { AdminEventRowDto } from '@/lib/api/types/admin/event-list'
import { adminEventsQuery } from '@/lib/query/query-options/admin'
import { qk } from '@/lib/query/keys'
import { formatInr } from '@/lib/format/money'
import { formatEventDate } from '@/lib/format/date'

// PLAN-012 TASK-212. Admin-direct enrollment of a player into a registration_open event.
// Rules: rule 5.4 (no sub-components), rule 5.14 (useDeferredValue), rule 6.11 (useTransition), rule 6.9 (ternary conditionals).

interface EnrollInEventDialogProps {
  player: Pick<AdminPlayerDto, 'id' | 'name' | 'status' | 'role'>
}

/** Formats entry fee or "Free". */
function entryFee(event: AdminEventRowDto): string {
  return formatInr(event.pricePaise)
}

/** Short title for a list row: title then date then fee. */
function eventSummary(event: AdminEventRowDto): string {
  const date = event.startsAt !== null ? formatEventDate(event.startsAt) : 'Date TBC'
  const fee = entryFee(event)
  return `${date} · ${fee}`
}

/**
 * Dialog to enroll a player directly into a registration_open event.
 * Shows only when player.status === 'active'. Searches events by title, then asks for confirmation.
 */
export function EnrollInEventDialog({ player }: EnrollInEventDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AdminEventRowDto | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Debounce the event search query with useDeferredValue (rule 5.14)
  const deferredSearch = useDeferredValue(search)
  const searchQuery = deferredSearch.trim() !== '' ? deferredSearch.trim() : undefined

  const eventsQuery = useQuery({
    ...adminEventsQuery(api.admin, {
      status: 'registration_open',
      ...(searchQuery !== undefined ? { q: searchQuery } : {}),
      pageSize: 20,
    }),
    enabled: open,
  })

  const events = eventsQuery.data?.items ?? []
  const isSearching = deferredSearch !== search || eventsQuery.isFetching

  function openDialog(): void {
    setSearch('')
    setSelected(null)
    setErrorMessage(null)
    setOpen(true)
  }

  function handleClose(next: boolean): void {
    if (isPending) return
    setOpen(next)
  }

  function handleSelectEvent(event: AdminEventRowDto): void {
    setSelected(event)
    setErrorMessage(null)
  }

  function handleBack(): void {
    setSelected(null)
    setErrorMessage(null)
  }

  function handleEnroll(): void {
    if (selected === null) return
    setErrorMessage(null)
    const intentKey = newIdempotencyKey()
    const eventTitle = selected.title.trim() !== '' ? selected.title : 'this event'

    startTransition(async () => {
      try {
        await api.admin.events.enrollPlayer(selected.id, { playerId: player.id }, intentKey)
        setOpen(false)
        pushToast('success', `${player.name} enrolled in ${eventTitle}.`)
        // Invalidate registrations for this event so control-room lists refresh if open
        void queryClient.invalidateQueries({ queryKey: qk.admin.registrations(selected.id) })
      } catch (error) {
        if (isAbortError(error)) return
        if (isApiError(error) && error.code === 'ALREADY_REGISTERED') {
          setErrorMessage('This player is already registered for this event.')
          return
        }
        if (isApiError(error) && error.code === 'EVENT_FULL') {
          setErrorMessage('This event is currently full.')
          return
        }
        const copy = copyFor(error, { action: 'enroll this player' })
        setErrorMessage(`${copy.title} ${copy.body}`)
      }
    })
  }

  // Only show the button for active players
  if (player.status !== 'active') return null

  const hasSelectedEvent = selected !== null

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        Enroll in event
      </Button>

      <Dialog
        open={open}
        onOpenChange={handleClose}
        title="Enroll in event"
        descriptionText={
          hasSelectedEvent
            ? `Confirm enrollment of ${player.name} in ${selected.title.trim() !== '' ? selected.title : 'this event'}.`
            : `Search for a registration-open event and enroll ${player.name} directly (admin enrolled, no payment).`
        }
        dismissible={!isPending}
        footer={
          hasSelectedEvent ? (
            <>
              <Button variant="ghost" onClick={handleBack} disabled={isPending}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={handleEnroll}
                disabled={isPending}
                loading={isPending}
                loadingLabel="Enrolling…"
              >
                Confirm enroll
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )
        }
      >
        <div className="grid gap-4">
          {errorMessage !== null ? (
            <Banner tone="danger" live="alert">
              {errorMessage}
            </Banner>
          ) : null}

          {hasSelectedEvent ? (
            <div className="grid gap-2 rounded-public border border-line p-4">
              <p className="font-semibold">
                {selected.title.trim() !== '' ? selected.title : 'Untitled event'}
              </p>
              <p className="text-sm text-ink-soft">{eventSummary(selected)}</p>
              <p className="mt-2 text-sm">
                This creates a confirmed spot for{' '}
                <strong className="font-semibold">{player.name}</strong> (admin enrolled, no payment required).
              </p>
            </div>
          ) : (
            <>
              <Field label="Search events" hint="Filter by event name.">
                <Input
                  type="search"
                  value={search}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(e) => {
                    setSearch(e.target.value)
                  }}
                />
              </Field>

              {isSearching && events.length === 0 ? (
                <p className="text-sm text-muted">Searching…</p>
              ) : events.length === 0 ? (
                <p className="text-sm text-muted">
                  {searchQuery !== undefined
                    ? 'No registration-open events match that search.'
                    : 'No events are open for registration right now.'}
                </p>
              ) : (
                <ul className="grid gap-2" aria-label="Matching events">
                  {events.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        className="w-full rounded-public border border-line p-3 text-left hover:border-forest-muted hover:bg-sand/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                        onClick={() => {
                          handleSelectEvent(event)
                        }}
                      >
                        <p className="font-semibold">
                          {event.title.trim() !== '' ? event.title : 'Untitled event'}
                        </p>
                        <p className="mt-0.5 text-sm text-ink-soft">{eventSummary(event)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Dialog>
    </>
  )
}
