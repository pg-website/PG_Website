import type { Metadata } from 'next'
import { AdminSettingsPage } from '@/features/admin/settings/AdminSettingsPage'
import { routeMetadata } from '@/lib/routes/metadata'

export const metadata: Metadata = routeMetadata('admin-settings')

export default function Page() {
  return <AdminSettingsPage />
}
