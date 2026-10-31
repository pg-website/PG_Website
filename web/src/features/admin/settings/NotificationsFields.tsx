'use client'

import { useWatch, type UseFormReturn } from 'react-hook-form'
import { Banner } from '@/components/ui/feedback/Banner'
import { Input } from '@/components/ui/form/Input'
import type { SettingsDto } from '@/lib/api/types/admin/settings'
import { SettingField } from '@/features/admin/settings/SettingField'
import { SwitchField } from '@/features/admin/settings/SwitchField'

type Values = SettingsDto['notifications']

export function NotificationsFields({ form }: { form: UseFormReturn<Values, unknown, Values> }) {
  const { register, control, formState } = form
  const errors = formState.errors
  const emailEnabled = useWatch({ control, name: 'emailEnabled' })
  return (
    <div className="grid gap-5">
      <SwitchField control={control} name="emailEnabled" label="Send emails" />
      {emailEnabled ? null : <Banner tone="warning">Event messages and state emails stop while sending is off.</Banner>}
      <SettingField label="Sender name" error={errors.senderName?.message}>
        <Input {...register('senderName')} maxLength={60} />
      </SettingField>
      <SettingField
        label="Contact form destination"
        hint="Contact-form messages are delivered here."
        error={errors.contactDestinationEmail?.message}
      >
        <Input type="email" {...register('contactDestinationEmail')} />
      </SettingField>
      <SettingField
        label="Reminder hours before event"
        hint="Whole hours, 1 to 168."
        error={errors.reminderHoursBefore?.message}
      >
        <Input type="number" min={1} max={168} {...register('reminderHoursBefore', { valueAsNumber: true })} />
      </SettingField>
    </div>
  )
}
