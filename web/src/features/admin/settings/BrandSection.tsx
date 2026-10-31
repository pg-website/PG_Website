'use client'

import { brandSettingsSchema, type SettingsDto } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'
import { BrandFields } from '@/features/admin/settings/BrandFields'
import { SettingsForm } from '@/features/admin/settings/SettingsForm'

type Values = SettingsDto['brand']

export function BrandSection({ dto, onDirtyChange }: { dto: SettingsDto; onDirtyChange: (dirty: boolean) => void }) {
  return (
    <SectionShell title="Brand & site" intro="Public site details. The public site updates shortly after you save.">
      <SettingsForm<Values>
        group="brand"
        dto={dto}
        schema={brandSettingsSchema}
        pick={(d) => d.brand}
        onDirtyChange={onDirtyChange}
      >
        {(form) => <BrandFields form={form} />}
      </SettingsForm>
    </SectionShell>
  )
}
