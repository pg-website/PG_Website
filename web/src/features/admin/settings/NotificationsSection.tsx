'use client'

import { notificationSettingsSchema, type SettingsDto } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'
import { NotificationsFields } from '@/features/admin/settings/NotificationsFields'
import { SettingsForm } from '@/features/admin/settings/SettingsForm'

type Values = SettingsDto['notifications']

export function NotificationsSection({
  dto,
  onDirtyChange,
}: {
  dto: SettingsDto
  onDirtyChange: (dirty: boolean) => void
}) {
  return (
    <SectionShell title="Notifications" intro="Email sending and where contact-form messages go.">
      <SettingsForm<Values>
        group="notifications"
        dto={dto}
        schema={notificationSettingsSchema}
        pick={(d) => d.notifications}
        onDirtyChange={onDirtyChange}
      >
        {(form) => <NotificationsFields form={form} />}
      </SettingsForm>
    </SectionShell>
  )
}
