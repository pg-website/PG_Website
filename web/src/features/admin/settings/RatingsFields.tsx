'use client'

import type { UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/form/Input'
import type { SettingsDto } from '@/lib/api/types/admin/settings'
import { SettingField } from '@/features/admin/settings/SettingField'
import { SwitchField } from '@/features/admin/settings/SwitchField'
import { isNotApplied } from '@/features/admin/settings/settings-meta'

type Values = SettingsDto['ratings']

export function RatingsFields({ form }: { form: UseFormReturn<Values, unknown, Values> }) {
  const { register, control, formState } = form
  return (
    <div className="grid gap-5">
      <SwitchField
        control={control}
        name="ratingsEnabled"
        label="Ratings enabled"
        notApplied={isNotApplied('ratings', 'ratingsEnabled')}
      />
      <SettingField
        label="Provisional games"
        hint="Games before a rating counts as established. 0 to 100."
        error={formState.errors.provisionalGames?.message}
        notApplied={isNotApplied('ratings', 'provisionalGames')}
      >
        <Input type="number" min={0} max={100} {...register('provisionalGames', { valueAsNumber: true })} />
      </SettingField>
      <SwitchField
        control={control}
        name="showRatingsByDefault"
        label="Show ratings by default"
        notApplied={isNotApplied('ratings', 'showRatingsByDefault')}
      />
    </div>
  )
}
