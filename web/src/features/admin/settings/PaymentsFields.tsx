'use client'

import type { UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/form/Input'
import type { SettingsDto } from '@/lib/api/types/admin/settings'
import { SettingField } from '@/features/admin/settings/SettingField'
import { isNotApplied } from '@/features/admin/settings/settings-meta'

type Values = SettingsDto['payments']

export function PaymentsFields({ form }: { form: UseFormReturn<Values, unknown, Values> }) {
  const { register, formState } = form
  return (
    <div className="grid gap-5">
      <input type="hidden" {...register('currency')} />
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-ink-soft">Currency</p>
        <p className="text-body text-ink">{form.getValues('currency')}</p>
        <p className="text-sm text-muted">Fixed at launch and not editable.</p>
      </div>
      <SettingField
        label="Seat hold minutes"
        hint="How long a seat is held during payment. 1 to 60."
        error={formState.errors.holdMinutes?.message}
        notApplied={isNotApplied('payments', 'holdMinutes')}
      >
        <Input type="number" min={1} max={60} {...register('holdMinutes', { valueAsNumber: true })} />
      </SettingField>
      <SettingField
        label="Default refund window (hours)"
        hint="Leave empty for no default window. 0 to 1440."
        error={formState.errors.defaultRefundWindowHours?.message}
        notApplied={isNotApplied('payments', 'defaultRefundWindowHours')}
      >
        <Input
          type="number"
          min={0}
          max={1440}
          {...register('defaultRefundWindowHours', {
            setValueAs: (v: string | number | null) =>
              v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v),
          })}
        />
      </SettingField>
    </div>
  )
}
