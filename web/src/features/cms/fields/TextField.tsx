'use client'

import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Textarea } from '@/components/ui/form/Textarea'
import { useModel, type Path } from '@/features/cms/fields/model'

interface TextFieldProps {
  path: Path
  label: string
  /** Server length limit; sets maxLength. */
  max: number
  multiline?: boolean
  hint?: string
  /** Empty input stores null (for nullable fields). */
  nullable?: boolean
}

/** Plain-text field bound to a path of the section content. Text only: no markup is interpreted anywhere. */
export function TextField({ path, label, max, multiline = false, hint, nullable = false }: TextFieldProps) {
  const model = useModel()
  const raw = model.get(path)
  const value = typeof raw === 'string' ? raw : ''
  const error = model.errorAt(path)
  const onChange = (next: string) => {
    model.set(path, nullable && next === '' ? null : next)
  }
  return (
    <Field label={label} hint={hint} error={error} optionalLabel={nullable}>
      {multiline ? (
        <Textarea
          value={value}
          maxLength={max}
          disabled={model.disabled}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      ) : (
        <Input
          value={value}
          maxLength={max}
          disabled={model.disabled}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      )}
    </Field>
  )
}
