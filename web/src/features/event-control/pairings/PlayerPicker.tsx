'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Dialog } from '@/components/ui/overlay/Dialog'
import {
  filterOptions,
  MAX_PICKER_ROWS,
  type PickerOption,
} from '@/features/event-control/pairings/pairings-logic'

interface Props {
  /** Names the seat in the dialog title and the accessible label ("Board 2 White", "Bye"). */
  seatLabel: string
  /** Text on the trigger button ("Change", "Add bye"). */
  triggerText: string
  options: readonly PickerOption[]
  /** Called with the chosen registration id. The dialog closes itself. */
  onChoose: (registrationId: string) => void
  disabled?: boolean
  /** Explains what choosing a seated player does. Shown above the list. */
  swapNote: string
}

/**
 * Searchable player choice for one seat or the bye list (TASK-085 White and Black selects). Built on the existing Dialog
 * (focus trap, Escape, focus back to the trigger). The search matches name or exact rating; the list is capped so a
 * large event stays light. A player already seated elsewhere is marked, and choosing them swaps the two seats.
 */
export function PlayerPicker({ seatLabel, triggerText, options, onChoose, disabled = false, swapNote }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const matches = filterOptions(options, query)
  const shown = matches.slice(0, MAX_PICKER_ROWS)
  const choose = (registrationId: string): void => {
    onChoose(registrationId)
    setOpen(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      title={`Choose a player for ${seatLabel}`}
      descriptionText={swapNote}
      size="md"
      presentation="sheet"
      trigger={
        <Button variant="secondary" size="md" disabled={disabled}>
          {triggerText}
          <span className="sr-only"> for {seatLabel}</span>
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Field label="Search by name or rating">
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            autoComplete="off"
          />
        </Field>
        <p role="status" className="text-sm text-ink-soft">
          {matches.length === 0
            ? 'No players match.'
            : `${String(matches.length)} player${matches.length === 1 ? '' : 's'}${
                matches.length > shown.length ? `, showing the first ${String(shown.length)}. Type to narrow the list.` : ''
              }`}
        </p>
        <ul className="grid max-h-1/2 list-none gap-2 overflow-y-auto overscroll-contain p-0">
          {shown.map((option) => (
            <li key={option.registrationId}>
              <button
                type="button"
                onClick={() => {
                  choose(option.registrationId)
                }}
                className="flex min-h-control w-full min-w-0 items-center justify-between gap-3 rounded-public border border-line bg-parchment-soft px-3 py-2 text-left hover:bg-sand"
              >
                <span className="min-w-0">
                  <span className="block font-semibold wrap-break-word">{option.name}</span>
                  <span className="block text-sm text-ink-soft">
                    {option.rating === null ? 'Unrated' : `Rating ${String(option.rating)}`}
                    {option.firstTimer ? ' · First time' : ''}
                    {option.checkedIn === true ? ' · Checked in' : ''}
                    {option.checkedIn === false ? ' · Not checked in' : ''}
                  </span>
                </span>
                {option.seatedAt === null ? null : (
                  <span className="shrink-0 text-right text-sm text-ink-soft">Now {option.seatedAt}. Swaps seats.</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
