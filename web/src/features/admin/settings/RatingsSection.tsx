'use client'

import { ratingSettingsSchema, type SettingsDto } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'
import { RatingsFields } from '@/features/admin/settings/RatingsFields'
import { SettingsForm } from '@/features/admin/settings/SettingsForm'

type Values = SettingsDto['ratings']

export function RatingsSection({ dto, onDirtyChange }: { dto: SettingsDto; onDirtyChange: (dirty: boolean) => void }) {
  return (
    <SectionShell title="Ratings" intro="Rating system behaviour for rated events.">
      <SettingsForm<Values>
        group="ratings"
        dto={dto}
        schema={ratingSettingsSchema}
        pick={(d) => d.ratings}
        onDirtyChange={onDirtyChange}
      >
        {(form) => <RatingsFields form={form} />}
      </SettingsForm>
    </SectionShell>
  )
}
