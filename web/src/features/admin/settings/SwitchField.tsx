'use client'

import { useState, type ReactNode } from 'react'
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form'
import { NotAppliedBadge } from '@/features/admin/settings/NotAppliedBadge'
import { Switch } from '@/components/ui/form/Switch'
import { ConfirmDialog } from '@/components/ui/overlay/ConfirmDialog'

interface SwitchFieldProps<T extends FieldValues> {
  control: Control<T>
  name: Path<T>
  label: string
  description?: ReactNode
  notApplied?: boolean
  /** When `needsConfirm(next)` is true the change waits for a confirm dialog (no step-up, PLAN-005 OQ-3). */
  confirm?: { needsConfirm: (next: boolean) => boolean; title: string; consequence: (next: boolean) => string }
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  notApplied = false,
  confirm,
}: SwitchFieldProps<T>) {
  const [pending, setPending] = useState<boolean | null>(null)
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <>
          <Switch
            ref={field.ref}
            name={field.name}
            label={<>{label}{notApplied ? <NotAppliedBadge /> : null}</>}
            description={description}
            error={fieldState.error?.message}
            checked={Boolean(field.value)}
            onBlur={field.onBlur}
            onCheckedChange={(next) => {
              if (confirm?.needsConfirm(next) === true) setPending(next)
              else field.onChange(next)
            }}
          />
          {confirm === undefined || pending === null ? null : (
            <ConfirmDialog
              open
              onOpenChange={(open) => {
                if (!open) setPending(null)
              }}
              onConfirm={() => {
                field.onChange(pending)
                setPending(null)
              }}
              title={confirm.title}
              consequence={confirm.consequence(pending)}
              confirmLabel="Apply change"
            />
          )}
        </>
      )}
    />
  )
}
