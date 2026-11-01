'use client'

import { useId } from 'react'
import { useController } from 'react-hook-form'
import { FormField } from '@/components/ui/form/FormField'
import { ChoiceCard } from '@/components/ui/form/ChoiceCard'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Switch } from '@/components/ui/form/Switch'
import { Heading } from '@/components/ui/Heading'
import { useLockedField, useStepForm } from '@/features/event-builder/context'
import { IntInput } from '@/features/event-builder/steps/int-input'
import { PoolField, type GameSystemValues } from '@/features/event-builder/fields/PoolField'
import type { BuilderStepProps } from '@/features/event-builder/types'
import type { RatingPool } from '@/lib/api/types/identity'
import type { PairingMode } from '@/lib/api/types/event-state'

// Builder step 5 (EV-11, screen 42): three pairing-mode choice cards (Balanced social matching / Swiss / Open play)
// instead of a Select. Rated Yes/No remains a Switch (same UX as before). Locked-field hints are preserved.

const DEFAULT_POOL: RatingPool = 'rapid'

// Reference screen 42 labels and descriptions for the three pairing cards.
interface PairingCardOption {
  value: PairingMode
  label: string
  description: string
}

const PAIRING_CARD_OPTIONS: readonly PairingCardOption[] = [
  {
    value: 'social_balanced',
    label: 'Balanced social matching',
    description: 'Rating proximity + recent opponent history + player intent.',
  },
  {
    value: 'swiss',
    label: 'Swiss tournament',
    description: 'Score groups, rematch avoidance, colour balance.',
  },
  {
    value: 'none',
    label: 'Open play',
    description: 'No generated pairing.',
  },
]

export function GameSystemStep({ dataKey }: BuilderStepProps) {
  const form = useStepForm<GameSystemValues>(dataKey ?? 'gameSystem')
  const rated = useLockedField('rated')
  const pairing = useLockedField('pairingMode')
  const { control, setValue, getValues } = form
  const groupId = useId()

  const pairingController = useController({ control, name: 'pairingMode' })
  // Backend readiness requires rounds for swiss / round_robin.
  const roundsRequired = pairingController.field.value === 'swiss' || pairingController.field.value === 'round_robin'

  return (
    <div className="grid min-w-0 gap-6">
        {/* Rating section */}
        <section aria-labelledby={`${groupId}-rating`} className="grid min-w-0 gap-4">
          <Heading level={2} size="card" id={`${groupId}-rating`}>
            Rating
          </Heading>
          <FormField control={control} name="rated" label="Rated" group>
            {(field, id) => (
              <Switch
                id={id}
                ref={field.ref}
                label="Rated event"
                description={
                  rated.locked
                    ? `Locked: ${rated.reason}`
                    : 'Results update players\u2019 ratings. Turn off for casual play.'
                }
                checked={field.value}
                disabled={rated.locked}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  if (checked && getValues('pool') === undefined) setValue('pool', DEFAULT_POOL)
                }}
                onBlur={field.onBlur}
              />
            )}
          </FormField>
          <PoolField control={control} />
        </section>

        {/* Pairing mode cards — screen 42 reference */}
        <section aria-labelledby={`${groupId}-pairing-heading`} className="grid min-w-0 gap-4">
          <Heading level={2} size="card" id={`${groupId}-pairing-heading`}>
            Play format
          </Heading>
          <Field
            label="Pairing mode"
            group
            id={`${groupId}-pairing`}
            hint={pairing.locked ? `Locked: ${pairing.reason}` : 'How players are paired each round.'}
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              {PAIRING_CARD_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  type="radio"
                  name={`${groupId}-pairing`}
                  value={option.value}
                  label={option.label}
                  description={option.description}
                  checked={pairingController.field.value === option.value}
                  disabled={pairing.locked}
                  onCheckedChange={(checked) => {
                    if (checked) pairingController.field.onChange(option.value)
                  }}
                  onBlur={pairingController.field.onBlur}
                />
              ))}
            </div>
          </Field>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <FormField
              control={control}
              name="rounds"
              label="Rounds"
              hint={
                roundsRequired
                  ? '1 to 20. Required for Swiss tournaments.'
                  : '1 to 20. Leave empty to decide later.'
              }
              required={roundsRequired}
              optionalLabel={!roundsRequired}
            >
              {(field) => (
                <IntInput
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Not set"
                />
              )}
            </FormField>
            <FormField
              control={control}
              name="timeControl"
              label="Time control"
              hint="For example 10+5. Up to 60 characters."
              required
            >
              {(field) => (
                <Input
                  ref={field.ref}
                  name={field.name}
                  maxLength={60}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  onBlur={field.onBlur}
                />
              )}
            </FormField>
          </div>
        </section>
    </div>
  )
}
