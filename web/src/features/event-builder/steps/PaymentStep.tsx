'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/form/Input'
import { PriceInput } from '@/features/event-builder/steps/price-input'
import { ChoiceCard } from '@/components/ui/form/ChoiceCard'
import { Field } from '@/components/ui/form/Field'
import { FormField } from '@/components/ui/form/FormField'
import { Heading } from '@/components/ui/Heading'
import { useLockedField, useStepForm } from '@/features/event-builder/context'
import type { BuilderStepProps } from '@/features/event-builder/types'
import type { PaymentStep as PaymentValues } from '@/lib/api/types/admin/event-builder'

// Builder step 4 (EV-10, screen 41): four payment mode cards (Free / Fixed price / Member price / Invite–comp).
// Member price and Invite/comp are disabled per OQ-09 (excluded from this launch).
// `pricePaise = 0` represents Free; any positive value represents Fixed price.
// Provider row is read-only (Razorpay). Currency is locked to INR and never sent (patch.ts drops it).

type PaymentMode = 'free' | 'fixed'

// Derive the initial UI mode from the stored pricePaise value.
function modeFromPaise(paise: number): PaymentMode {
  return Number.isFinite(paise) && paise > 0 ? 'fixed' : 'free'
}

interface ModeCardOption {
  value: PaymentMode | 'member' | 'invite'
  label: string
  description: string
  disabled?: boolean
}

const PAYMENT_MODE_OPTIONS: readonly ModeCardOption[] = [
  {
    value: 'free',
    label: 'Free',
    description: 'No payment provider involved.',
  },
  {
    value: 'fixed',
    label: 'Fixed price',
    description: 'One server-owned fee.',
  },
  {
    value: 'member',
    label: 'Member price',
    description: 'Separate member fee.',
    disabled: true,
  },
  {
    value: 'invite',
    label: 'Invite / comp',
    description: 'Admin-controlled access.',
    disabled: true,
  },
]

export function PaymentStep({ dataKey }: BuilderStepProps) {
  const form = useStepForm<PaymentValues>(dataKey ?? 'payment')
  const price = useLockedField('pricePaise')
  const { control, setValue } = form
  const groupId = useId()

  const [payMode, setPayMode] = useState<PaymentMode>(() => modeFromPaise(form.getValues('pricePaise')))

  function handleModeChange(next: PaymentMode): void {
    setPayMode(next)
    if (next === 'free') {
      // Set price to 0 (free) when switching to Free mode.
      setValue('pricePaise', 0, { shouldDirty: true })
    }
  }

  return (
    <div className="grid min-w-0 gap-6">
      {/* Payment mode cards — screen 41 reference */}
      <section aria-labelledby={`${groupId}-mode-heading`} className="grid min-w-0 gap-4">
        <Heading level={2} size="card" id={`${groupId}-mode-heading`}>
          Payment mode
        </Heading>
        <Field label="How players pay" group id={`${groupId}-mode`}>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {PAYMENT_MODE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                type="radio"
                name={`${groupId}-mode`}
                value={option.value}
                label={option.label}
                description={
                  option.disabled ? (
                    <>
                      {option.description}
                      <span className="block text-muted">(not available at launch)</span>
                    </>
                  ) : (
                    option.description
                  )
                }
                checked={option.disabled ? false : payMode === option.value}
                disabled={option.disabled || price.locked}
                onCheckedChange={(checked) => {
                  if (checked && !option.disabled && (option.value === 'free' || option.value === 'fixed')) {
                    handleModeChange(option.value)
                  }
                }}
              />
            ))}
          </div>
        </Field>
      </section>

      {/* Price — only shown when Fixed price mode is selected */}
      {payMode === 'fixed' ? (
        <section aria-labelledby={`${groupId}-price-heading`} className="grid min-w-0 gap-4">
          <Heading level={2} size="card" id={`${groupId}-price-heading`}>
            Price
          </Heading>
          <FormField
            control={control}
            name="pricePaise"
            label="Entry price (INR)"
            hint={
              price.locked
                ? `Locked: ${price.reason}`
                : 'In rupees, up to 2 decimals. Stored in paise. The server is the source of truth for the final amount.'
            }
          >
            {(field) => (
              <PriceInput
                ref={field.ref}
                name={field.name}
                paise={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                disabled={price.locked}
              />
            )}
          </FormField>

          {/* Provider — read-only (Razorpay, screen 41) */}
          <Field label="Provider" hint="Payment gateway. Fixed to Razorpay for all paid events.">
            <Input value="Razorpay" disabled readOnly aria-readonly="true" />
          </Field>
        </section>
      ) : null}

      {/* Refunds and holds */}
      <section aria-labelledby={`${groupId}-rules-heading`} className="grid min-w-0 gap-4">
        <Heading level={2} size="card" id={`${groupId}-rules-heading`}>
          Refunds and holds
        </Heading>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="refundWindowHours"
            label="Refund window (hours before start)"
            hint="Leave empty for no refunds."
          >
            {(field) => (
              <Input
                ref={field.ref}
                name={field.name}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="No refunds"
                value={field.value ?? ''}
                onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
                onBlur={field.onBlur}
              />
            )}
          </FormField>
          <FormField
            control={control}
            name="holdMinutes"
            label="Seat hold (minutes)"
            hint="How long a seat is held while the player pays (1 to 60)."
          >
            {(field) => (
              <Input
                ref={field.ref}
                name={field.name}
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                step={1}
                value={Number.isFinite(field.value) ? field.value : ''}
                onChange={(event) =>
                  field.onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
                }
                onBlur={field.onBlur}
              />
            )}
          </FormField>
        </div>
      </section>
    </div>
  )
}
