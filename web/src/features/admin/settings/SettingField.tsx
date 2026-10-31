import type { ReactNode } from 'react'
import { Field } from '@/components/ui/form/Field'
import { NotAppliedBadge } from '@/features/admin/settings/NotAppliedBadge'

/** Field wrapper for text/number inputs with the badge in the label. */
export function SettingField({
  label,
  hint,
  error,
  notApplied = false,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string
  notApplied?: boolean
  children: ReactNode
}) {
  return (
    <Field label={<>{label}{notApplied ? <NotAppliedBadge /> : null}</>} hint={hint} error={error}>
      {children}
    </Field>
  )
}
