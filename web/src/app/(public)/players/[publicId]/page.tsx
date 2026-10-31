import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicProfile } from '@/features/player/public-profile/PublicProfile'
import { getPlayerProfile } from '@/lib/data/public/player-profile'
import { isValidPublicId } from '@/lib/routes/params'
import { playerProfileHref } from '@/lib/routes/routes'
import { buildMetadata } from '@/lib/seo/metadata'

// Public player profile (PLAN-007): ISR on demand, 60 s window, always noindex. The id is validated and notFound() called
// before any fetch (M13). Unknown, hidden and suspended players are all the same 404 (existence is not leaked).
export const revalidate = 60
export const dynamicParams = true

interface PlayerPageProps {
  params: Promise<{ publicId: string }>
}

export function generateStaticParams(): { publicId: string }[] {
  return [] // profiles render on first hit; there is no list endpoint
}

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { publicId } = await params
  if (!isValidPublicId(publicId)) notFound()
  const player = await getPlayerProfile(publicId)
  if (player === null) notFound()
  return buildMetadata({ title: player.displayName, path: playerProfileHref(player.publicId), noindex: true })
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { publicId } = await params
  if (!isValidPublicId(publicId)) notFound()
  // Shares the React.cache entry with generateMetadata: one upstream request.
  const player = await getPlayerProfile(publicId)
  if (player === null) notFound()
  return <PublicProfile player={player} />
}
