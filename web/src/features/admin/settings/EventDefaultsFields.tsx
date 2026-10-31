'use client'

import { Controller, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/form/Input'
import { Select } from '@/components/ui/form/Select'
import { PAIRING_MODE_LABEL } from '@/features/event-control/overview/overview-labels'
import type { SettingsDto } from '@/lib/api/types/admin/settings'
import { EVENT_TYPES, PAIRING_MODES, type EventType } from '@/lib/api/types/event-state'
import { SettingField } from '@/features/admin/settings/SettingField'
import { SwitchField } from '@/features/admin/settings/SwitchField'
import { isNotApplied } from '@/features/admin/settings/settings-meta'

type Values = SettingsDto['eventDefaults']

const EVENT_TYPE_LABEL: Readonly<Record<EventType, string>> = {
  social: 'Social',
  rated_tournament: 'Rated tournament',
  league: 'League',
  workshop: 'Workshop',
  special: 'Special',
}
const TYPE_OPTIONS = EVENT_TYPES.map((value) => ({ value, label: EVENT_TYPE_LABEL[value] }))
const PAIRING_OPTIONS = PAIRING_MODES.map((value) => ({ value, label: PAIRING_MODE_LABEL[value] }))

export function EventDefaultsFields({ form }: { form: UseFormReturn<Values, unknown, Values> }) {
  const { register, control, formState } = form
  const errors = formState.errors
  const na = isNotApplied('eventDefaults', 'type')
  return (
    <div className="grid gap-5">
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <SettingField label="Event type" error={errors.type?.message} notApplied={na}>
            <Select
              options={TYPE_OPTIONS}
              value={field.value}
              onValueChange={(v) => {
                field.onChange(v)
              }}
            />
          </SettingField>
        )}
      />
      <Controller
        control={control}
        name="pairingMode"
        render={({ field }) => (
          <SettingField label="Pairing mode" error={errors.pairingMode?.message} notApplied={na}>
            <Select
              options={PAIRING_OPTIONS}
              value={field.value}
              onValueChange={(v) => {
                field.onChange(v)
              }}
            />
          </SettingField>
        )}
      />
      <SettingField label="Capacity" hint="1 to 100000." error={errors.capacity?.message} notApplied={na}>
        <Input type="number" min={1} max={100000} {...register('capacity', { valueAsNumber: true })} />
      </SettingField>
      <SwitchField control={control} name="waitlistEnabled" label="Waitlist enabled" notApplied={na} />
      <SettingField label="Time control" error={errors.timeControl?.message} notApplied={na}>
        <Input {...register('timeControl')} maxLength={60} />
      </SettingField>
    </div>
  )
}
