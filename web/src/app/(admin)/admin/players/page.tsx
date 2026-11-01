import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PlayersAdminPage } from '@/features/admin/players/PlayersAdminPage'
import { routeMetadata } from '@/lib/routes/metadata'

export const metadata: Metadata = routeMetadata('admin-players')

export default function Page() {
  return (
    <Suspense>
      <PlayersAdminPage />
    </Suspense>
  )
}
