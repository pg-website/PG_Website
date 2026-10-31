import 'server-only'
import { cache } from 'react'
import { getPublicApi } from '@/lib/api/adapters/getPublicApi.server'
import type { PublicProfileDto } from '@/lib/api/types/player-profile'
import { isValidPublicId } from '@/lib/routes/params'

// Public player profile (PLAN-007, `/players/[publicId]`). The id is validated first (M13): a malformed id is null with
// no fetch. A backend 404 (unknown, hidden, suspended) is null via the adapter; every other failure throws. Short
// revalidate window (60 s, matching the endpoint's s-maxage) so hiding a profile takes effect quickly; no tags.

const PLAYER_PROFILE_REVALIDATE_SECONDS = 60

export const getPlayerProfile = cache(async (publicId: string): Promise<PublicProfileDto | null> => {
  if (!isValidPublicId(publicId)) return null
  return getPublicApi().getPlayerProfile(publicId, { revalidate: PLAYER_PROFILE_REVALIDATE_SECONDS })
})
