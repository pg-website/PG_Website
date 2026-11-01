'use client'

import type { Ref } from 'react'
import { CONTROL_CLASS } from '@/components/ui/form/controlStyles'
import { useFieldControl } from '@/components/ui/form/fieldContext'
import { parseInstant, toIstParts } from '@/lib/format/instant'

const pad = (n: number): string => String(n).padStart(2, '0')

/** ISO instant to the `datetime-local` value on the IST wall clock. */
function toLocalInput(iso: string | number | null): string {
  const ms = iso === null ? null : parseInstant(iso)
  if (ms === null) return ''
  const p = toIstParts(ms)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}
function fromLocalInput(local: string): string | null {
  return local === '' ? null : `${local}:00+05:30`
}

interface DateTimeInputProps {
  value: string | null
  onChange: (iso: string | null) => void
  onBlur: () => void
  name: string
  ref: Ref<HTMLInputElement>
  /** Earliest selectable instant (ISO or epoch ms); earlier days and times are greyed out in the picker. */
  min?: string | number | null
}

/** Native datetime-local picker on the IST wall clock; the value is an ISO instant. */
export function DateTimeInput({ value, onChange, onBlur, name, ref, min = null }: DateTimeInputProps) {
  const field = useFieldControl()
  return (
    <input
      ref={ref}
      id={field?.id}
      name={name}
      type="datetime-local"
      value={toLocalInput(value)}
      min={toLocalInput(min) || undefined}
      suppressHydrationWarning
      onChange={(event) => onChange(fromLocalInput(event.target.value))}
      onBlur={onBlur}
      aria-describedby={field?.['aria-describedby']}
      aria-invalid={field?.['aria-invalid']}
      className={CONTROL_CLASS}
    />
  )
}
