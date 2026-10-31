'use client'

import { authSettingsSchema, type SettingsDto } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'
import { AuthFields } from '@/features/admin/settings/AuthFields'
import { SettingsForm } from '@/features/admin/settings/SettingsForm'

type Values = SettingsDto['auth']

export function AuthSection({ dto, onDirtyChange }: { dto: SettingsDto; onDirtyChange: (dirty: boolean) => void }) {
  return (
    <SectionShell title="Authentication" intro="Who can sign in and how long admin sessions last.">
      <SettingsForm<Values>
        group="auth"
        dto={dto}
        schema={authSettingsSchema}
        pick={(d) => d.auth}
        onDirtyChange={onDirtyChange}
      >
        {(form) => <AuthFields form={form} />}
      </SettingsForm>
    </SectionShell>
  )
}
