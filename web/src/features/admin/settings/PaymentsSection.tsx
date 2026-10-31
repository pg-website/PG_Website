'use client'

import { paymentSettingsSchema, type SettingsDto } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'
import { PaymentsFields } from '@/features/admin/settings/PaymentsFields'
import { SettingsForm } from '@/features/admin/settings/SettingsForm'

type Values = SettingsDto['payments']

export function PaymentsSection({ dto, onDirtyChange }: { dto: SettingsDto; onDirtyChange: (dirty: boolean) => void }) {
  return (
    <SectionShell title="Payments" intro="Seat holds and refunds.">
      <SettingsForm<Values>
        group="payments"
        dto={dto}
        schema={paymentSettingsSchema}
        pick={(d) => d.payments}
        onDirtyChange={onDirtyChange}
      >
        {(form) => <PaymentsFields form={form} />}
      </SettingsForm>
    </SectionShell>
  )
}
