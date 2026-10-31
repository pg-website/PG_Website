import type { PublicIdentity } from '@/lib/api/types/identity'
import { deepFreeze } from '@/lib/mock/seeds/freeze'

// Fictional opponents (public identity only, AC-107) and the demo player's own public identity. Names follow screens
// 22 to 30 of the reference. Immutable.

export const MOCK_PLAYER_IDENTITY: PublicIdentity = deepFreeze({
  publicId: null,
  displayName: 'Asha Rao',
  initials: 'AR',
  rating: { pool: 'rapid', value: 1286 },
  cityChapter: 'Bengaluru',
})

const person = (displayName: string, initials: string, rating: number | null, city: string | null): PublicIdentity => ({
  publicId: null,
  displayName,
  initials,
  rating: rating === null ? null : { pool: 'rapid', value: rating },
  cityChapter: city,
})

export const MOCK_OPPONENTS = deepFreeze({
  aarav: person('Aarav Menon', 'AM', 1318, 'Hyderabad'),
  ananya: person('Ananya Shah', 'AS', 1254, 'Hyderabad'),
  arjun: person('Arjun Varma', 'AV', 1301, null),
  raghav: person('Raghav Iyer', 'RI', null, 'Hyderabad'),
  meera: person('Meera Joshi', 'MJ', 1190, 'Hyderabad'),
  dev: person('Dev Menon', 'DM', null, null),
  ira: person('Ira Kapoor', 'IK', 1540, 'Hyderabad'),
  kabir: person('Kabir Nair', 'KN', 1222, null),
  neha: person('Neha Reddy', 'NR', null, 'Hyderabad'),
})

export type MockOpponentKey = keyof typeof MOCK_OPPONENTS

/** People met (M03): opponents played most. Screen 22 shows 4, 3 and 2 games. */
export const MOCK_PEOPLE: readonly { identity: PublicIdentity; games: number }[] = deepFreeze([
  { identity: MOCK_OPPONENTS.aarav, games: 4 },
  { identity: MOCK_OPPONENTS.ananya, games: 3 },
  { identity: MOCK_OPPONENTS.meera, games: 2 },
])
