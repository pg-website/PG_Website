import type { Metadata } from 'next'
import { ContentAdminPage } from '@/features/cms/ContentAdminPage'
import { routeMetadata } from '@/lib/routes/metadata'

export const metadata: Metadata = routeMetadata('admin-content')

export default function Page() {
  return <ContentAdminPage />
}
