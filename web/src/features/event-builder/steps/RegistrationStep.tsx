'use client'

import { useState } from 'react'
import { IstDateTimeInput } from '@/features/event-builder/steps/registration-inputs'
import { IntInput } from '@/features/event-builder/steps/int-input'
import { Switch } from '@/components/ui/form/Switch'
import { FormField } from '@/components/ui/form/FormField'
import { Heading } from '@/components/ui/Heading'
import { useLockedField, useStepForm } from '@/features/event-builder/context'
import type { BuilderStepProps } from '@/features/event-builder/types'
import type { RegistrationStep as RegistrationValues } from '@/lib/api/types/admin/event-builder'

// Builder step 3 (FE-27): capacity, waitlist and registration rules. Operational group (E04); capacity can be locked by
// the server once registrations exist, in which case it is disabled and the reason is visible text.

export function RegistrationStep({ dataKey }: BuilderStepProps) {
  const form = useStepForm<RegistrationValues>(dataKey ?? 'registration')
  const capacity = useLockedField('capacity')
  const { control } = form
  // Empty capacity is "unlimited" (sent as null). The switch only decides which control is shown.
  const [unlimited, setUnlimited] = useState(() => form.getValues('capacity') === null)

  return (
    <div className="grid min-w-0 gap-6">
        <section aria-labelledby="reg-capacity" className="grid min-w-0 gap-4">
          <Heading level={2} size="card" id="reg-capacity">
            Capacity
          </Heading>
          <Switch
            label="Unlimited places"
            description={
              capacity.locked
                ? `Locked: ${capacity.reason}`
                : 'No cap on registrations. Turn off to set a maximum number of places.'
            }
            checked={unlimited}
            disabled={capacity.locked}
            onCheckedChange={(next) => {
              setUnlimited(next)
              if (next) form.setValue('capacity', null, { shouldDirty: true })
            }}
          />
          {unlimited ? null : (
            <FormField
              control={control}
              name="capacity"
              label="Capacity"
              hint={
                capacity.locked
                  ? `Locked: ${capacity.reason}`
                  : 'Maximum registrations (1 to 100000). Left empty it means unlimited.'
              }
            >
              {(field) => (
                <IntInput
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={capacity.locked}
                  placeholder="Unlimited"
                />
              )}
            </FormField>
          )}
          <FormField control={control} name="waitlistEnabled" label="Waitlist" group>
            {(field, id) => (
              <Switch
                id={id}
                ref={field.ref}
                label="Enable waitlist"
                description="When the event is full, players can join a waitlist and are promoted as seats free up."
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          </FormField>
        </section>

        <section aria-labelledby="reg-rules" className="grid min-w-0 gap-4">
          <Heading level={2} size="card" id="reg-rules">
            Rules
          </Heading>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <FormField
              control={control}
              name="opensAt"
              label="Registration opens"
              hint="India time (IST). Leave empty to open immediately. Must be before registration closes."
            >
              {(field) => (
                <IstDateTimeInput
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            </FormField>
            <FormField
              control={control}
              name="closesAt"
              label="Registration closes"
              hint="India time (IST). Leave empty to close at the start. Must be after it opens and no later than the event start."
            >
              {(field) => (
                <IstDateTimeInput
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            </FormField>
          </div>
          <FormField control={control} name="minAge" label="Minimum age" hint="Leave empty for no age limit.">
            {(field) => (
              <IntInput
                ref={field.ref}
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                placeholder="No minimum"
              />
            )}
          </FormField>
          <FormField control={control} name="membershipRequired" label="Membership" group>
            {(field, id) => (
              <Switch
                id={id}
                ref={field.ref}
                label="Membership required"
                description="Only signed-in members can register."
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          </FormField>
          <FormField control={control} name="askFirstTimer" label="First-timer question" group>
            {(field, id) => (
              <Switch
                id={id}
                ref={field.ref}
                label="Ask if this is their first event"
                description="Adds a first-timer question to registration."
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          </FormField>
        </section>
    </div>
  )
}
