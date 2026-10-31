'use client'

import { Heading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { SettingsSkeleton } from '@/features/admin/settings/SettingsSkeleton'
import { SettingsWorkspace } from '@/features/admin/settings/SettingsWorkspace'
import { useAdminSettings } from '@/features/admin/settings/useAdminSettings'

export function AdminSettingsPage() {
  const query = useAdminSettings()
  return (
    <div className="grid gap-6 p-4 sm:p-6">
      <header>
        <Heading level={1} size="section">
          Settings
        </Heading>
        <Text variant="small" className="mt-1">
          Site, sign-in, ratings, payments and notification settings. Secrets are never shown here.
        </Text>
      </header>
      <QueryView query={query} loadingLabel="Loading settings" skeleton={<SettingsSkeleton />} errorAction="load settings">
        {(dto) => <SettingsWorkspace dto={dto} />}
      </QueryView>
    </div>
  )
}
