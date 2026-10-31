'use client'

import { useState } from 'react'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/feedback/useToast'
import { ChoiceCard } from '@/components/ui/form/ChoiceCard'
import { Field } from '@/components/ui/form/Field'
import { Textarea } from '@/components/ui/form/Textarea'
import { OUTCOME_LABEL, OUTCOMES } from '@/features/event-control/pairings/pairings-labels'
import type { ResultAction as ResultActionKind } from '@/features/event-control/pairings/pairings-logic'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { ApiError } from '@/lib/api/errors'
import type { AdminPairingDto } from '@/lib/api/types/admin/control-rounds'
import type { ResultOutcome } from '@/lib/api/types/event-room'

type GamePairing = Extract<AdminPairingDto, { kind: 'game' }>

interface Props {
  eventId: string
  roundId: string
  pairing: GamePairing
  action: ResultActionKind
  onDone: () => void
}

const TRIGGER_LABEL: Readonly<Record<ResultActionKind, string>> = {
  record: 'Enter result',
  override: 'Override result',
  resolve: 'Resolve dispute',
}

const TITLE: Readonly<Record<ResultActionKind, string>> = {
  record: 'Enter the result',
  override: 'Override the result',
  resolve: 'Resolve the dispute',
}

const SIDE_LABEL = { white: 'White', black: 'Black', admin: 'The host' } as const

/**
 * Result entry, override and dispute resolution for one game (C11). Every outcome needs a reason (kept in the audit
 * log) and the result becomes final at once, so the dialog names the board and both players before it confirms.
 */
export function ResultAction({ eventId, roundId, pairing, action, onDone }: Props) {
  const api = useApi().admin
  const toast = useToast()
  const [outcome, setOutcome] = useState<ResultOutcome | null>(null)
  const [reason, setReason] = useState('')
  const result = pairing.result

  const consequence =
    action === 'resolve'
      ? `This settles board ${String(pairing.board)} (${pairing.white.name} v ${pairing.black.name}) and makes the result final.`
      : action === 'override'
        ? `This replaces the final result on board ${String(pairing.board)} (${pairing.white.name} v ${pairing.black.name}). Players see the new result.`
        : `This records a final result for board ${String(pairing.board)} (${pairing.white.name} v ${pairing.black.name}).`

  return (
    <ConfirmAction
      renderTrigger={(open) => (
        <Button
          size="sm"
          variant={action === 'resolve' ? 'primary' : 'secondary'}
          onClick={() => {
            setOutcome(null)
            setReason('')
            open()
          }}
        >
          {TRIGGER_LABEL[action]}
          <span className="sr-only"> for board {pairing.board}</span>
        </Button>
      )}
      title={TITLE[action]}
      consequence={consequence}
      confirmLabel={action === 'resolve' ? 'Resolve dispute' : 'Save result'}
      actionLabel="save this result"
      onConfirm={async (key) => {
        const trimmed = reason.trim()
        if (outcome === null) throw new ApiError('VALIDATION_FAILED', { status: 422 })
        await api.control.recordResult(
          eventId,
          roundId,
          pairing.pairingId,
          { action: action === 'resolve' ? 'resolve' : 'record', outcome, reason: trimmed },
          { idempotencyKey: key },
        )
      }}
      onDone={() => {
        toast.success('Result saved')
        onDone()
      }}
    >
      <div className="mt-4 flex flex-col gap-4">
        {result.state === 'disputed' ? (
          <p className="text-sm text-ink-soft">
            {SIDE_LABEL[result.submittedBy]} reported &ldquo;{OUTCOME_LABEL[result.outcome]}&rdquo;;{' '}
            {SIDE_LABEL[result.disputedBy].toLowerCase()} disputed it.
            {result.note === null ? '' : ` Note: ${result.note}`}
          </p>
        ) : null}
        <Field group label="Outcome" required>
          <div className="grid grid-cols-3 gap-2">
            {OUTCOMES.map((value) => (
              <ChoiceCard
                key={value}
                type="radio"
                name={`outcome-${pairing.pairingId}`}
                value={value}
                checked={outcome === value}
                onCheckedChange={() => {
                  setOutcome(value)
                }}
                label={value === 'white' ? 'White' : value === 'black' ? 'Black' : 'Draw'}
                description={
                  value === 'white'
                    ? `${pairing.white.name} wins`
                    : value === 'black'
                      ? `${pairing.black.name} wins`
                      : undefined
                }
              />
            ))}
          </div>
        </Field>
        <Field label="Reason" optionalLabel hint="Up to 500 characters. Kept in the audit log.">
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
        </Field>
      </div>
    </ConfirmAction>
  )
}
