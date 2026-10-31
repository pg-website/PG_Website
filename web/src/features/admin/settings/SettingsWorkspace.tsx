'use client'

import { useCallback, useState } from 'react'
import { AuthSection } from '@/features/admin/settings/AuthSection'
import { BrandSection } from '@/features/admin/settings/BrandSection'
import { EventDefaultsSection } from '@/features/admin/settings/EventDefaultsSection'
import { IntegrationStatus } from '@/features/admin/settings/IntegrationStatus'
import { NotificationsSection } from '@/features/admin/settings/NotificationsSection'
import { PaymentsSection } from '@/features/admin/settings/PaymentsSection'
import { RatingsSection } from '@/features/admin/settings/RatingsSection'
import { SettingsNav } from '@/features/admin/settings/SettingsNav'
import type { SettingsSectionId } from '@/features/admin/settings/settings-meta'
import type { SettingsDto } from '@/lib/api/types/admin/settings'

export function SettingsWorkspace({ dto }: { dto: SettingsDto }) {
  const [active, setActive] = useState<SettingsSectionId>('brand')
  const [dirty, setDirty] = useState(false)
  const onDirtyChange = useCallback((next: boolean) => {
    setDirty(next)
  }, [])

  const select = (id: SettingsSectionId): void => {
    if (id === active) return
    if (dirty && !window.confirm('You have unsaved changes in this section. Leave without saving?')) return
    setDirty(false)
    setActive(id)
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[14rem_1fr]">
      <SettingsNav active={active} onSelect={select} />
      <div className="min-w-0 border border-line-admin bg-parchment-soft p-4 sm:p-6">
        {active === 'brand' ? <BrandSection dto={dto} onDirtyChange={onDirtyChange} /> : null}
        {active === 'auth' ? <AuthSection dto={dto} onDirtyChange={onDirtyChange} /> : null}
        {active === 'ratings' ? <RatingsSection dto={dto} onDirtyChange={onDirtyChange} /> : null}
        {active === 'payments' ? <PaymentsSection dto={dto} onDirtyChange={onDirtyChange} /> : null}
        {active === 'notifications' ? <NotificationsSection dto={dto} onDirtyChange={onDirtyChange} /> : null}
        {active === 'eventDefaults' ? <EventDefaultsSection dto={dto} onDirtyChange={onDirtyChange} /> : null}
        {active === 'integrations' ? <IntegrationStatus integrations={dto.integrations} /> : null}
      </div>
    </div>
  )
}
