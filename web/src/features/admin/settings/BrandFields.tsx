'use client'

import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/form/Input'
import type { SettingsDto } from '@/lib/api/types/admin/settings'
import { SettingField } from '@/features/admin/settings/SettingField'

type Values = SettingsDto['brand']
const MAX_SOCIAL = 8

export function BrandFields({ form }: { form: UseFormReturn<Values, unknown, Values> }) {
  const { register, control, formState } = form
  const errors = formState.errors
  const social = useFieldArray({ control, name: 'social' })
  return (
    <div className="grid gap-5">
      <SettingField label="Site name" error={errors.siteName?.message}>
        <Input {...register('siteName')} maxLength={60} />
      </SettingField>
      <SettingField label="Support email" error={errors.supportEmail?.message}>
        <Input type="email" {...register('supportEmail')} />
      </SettingField>
      <SettingField
        label="Event desk link"
        hint="WhatsApp or phone link for Message event desk (https, mailto or tel)."
        error={errors.deskContactHref?.message}
      >
        <Input
          {...register('deskContactHref', {
            setValueAs: (v: string | null) => (v === null || v.trim() === '' ? null : v.trim()),
          })}
        />
      </SettingField>
      <SettingField label="Default city" error={errors.defaultCity?.message}>
        <Input {...register('defaultCity')} maxLength={80} />
      </SettingField>
      <fieldset className="grid min-w-0 gap-3 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-ink-soft">
          Social links ({social.fields.length}/{MAX_SOCIAL})
        </legend>
        {social.fields.map((item, index) => (
          <div key={item.id} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <SettingField label={`Link ${index + 1} label`} error={errors.social?.[index]?.label?.message}>
              <Input {...register(`social.${index}.label`)} maxLength={40} />
            </SettingField>
            <SettingField label={`Link ${index + 1} address`} error={errors.social?.[index]?.href?.message}>
              <Input {...register(`social.${index}.href`)} />
            </SettingField>
            <Button
              variant="secondary"
              onClick={() => {
                social.remove(index)
              }}
              aria-label={`Remove social link ${index + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
        {errors.social?.message === undefined ? null : (
          <p className="text-sm font-semibold text-danger-ink">{errors.social.message}</p>
        )}
        {social.fields.length < MAX_SOCIAL ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                social.append({ label: '', href: '' })
              }}
            >
              Add social link
            </Button>
          </div>
        ) : null}
      </fieldset>
    </div>
  )
}
