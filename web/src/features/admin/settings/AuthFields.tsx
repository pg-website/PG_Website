'use client'

import type { UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/form/Input'
import type { SettingsDto } from '@/lib/api/types/admin/settings'
import { SettingField } from '@/features/admin/settings/SettingField'
import { SwitchField } from '@/features/admin/settings/SwitchField'
import { isNotApplied } from '@/features/admin/settings/settings-meta'

type Values = SettingsDto['auth']

export function AuthFields({ form }: { form: UseFormReturn<Values, unknown, Values> }) {
  const { register, control, formState } = form
  return (
    <div className="grid gap-5">
      <SwitchField
        control={control}
        name="googleSignInEnabled"
        label="Google sign-in"
        notApplied={isNotApplied('auth', 'googleSignInEnabled')}
        confirm={{
          needsConfirm: () => true,
          title: 'Change Google sign-in?',
          consequence: (next) =>
            next ? 'Players will be able to sign in with Google.' : 'Players will no longer be able to sign in with Google.',
        }}
      />
      <SwitchField
        control={control}
        name="signupOpen"
        label="Open sign-up"
        description="When off, new players cannot create accounts."
        notApplied={isNotApplied('auth', 'signupOpen')}
        confirm={{
          needsConfirm: (next) => !next,
          title: 'Close sign-up?',
          consequence: () => 'New players cannot create accounts until sign-up is opened again.',
        }}
      />
      <SettingField
        label="Admin session hours"
        hint="Whole hours, 1 to 12."
        error={formState.errors.adminSessionHours?.message}
        notApplied={isNotApplied('auth', 'adminSessionHours')}
      >
        <Input type="number" min={1} max={12} {...register('adminSessionHours', { valueAsNumber: true })} />
      </SettingField>
    </div>
  )
}
