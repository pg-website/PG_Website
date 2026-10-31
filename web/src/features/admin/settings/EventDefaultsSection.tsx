'use client'

import { eventDefaultSettingsSchema, type SettingsDto } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'
import { EventDefaultsFields } from '@/features/admin/settings/EventDefaultsFields'
import { SettingsForm } from '@/features/admin/settings/SettingsForm'

type Values = SettingsDto['eventDefaults']

export function EventDefaultsSection({
  dto,
  onDirtyChange,
}: {
  dto: SettingsDto
  onDirtyChange: (dirty: boolean) => void
}) {
  return (
    <SectionShell title="Event defaults" intro="Starting values for new events.">
      <SettingsForm<Values>
        group="eventDefaults"
        dto={dto}
        schema={eventDefaultSettingsSchema}
        pick={(d) => d.eventDefaults}
        onDirtyChange={onDirtyChange}
      >
        {(form) => <EventDefaultsFields form={form} />}
      </SettingsForm>
    </SectionShell>
  )
}
