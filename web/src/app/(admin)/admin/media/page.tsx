import type { Metadata } from 'next'
import { MediaLibraryPage } from '@/features/admin/media/MediaLibraryPage'
import { routeMetadata } from '@/lib/routes/metadata'

export const metadata: Metadata = routeMetadata('admin-media')

export default function Page() {
  return <MediaLibraryPage />
}
