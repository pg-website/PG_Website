import type { EventDetailDto } from '@/lib/api/types/event'
import type { AvailabilityDto } from '@/lib/api/types/event-state'
import { homeImage, mockCollection, mockImage } from '@/lib/mock/seeds/media'
import { deepFreeze } from '@/lib/mock/seeds/freeze'
import { MOCK_NOW, mockIstAt } from '@/lib/mock/seeds/clock'
import { mockSlug } from '@/lib/mock/seeds/slug'

// Event seeds (fictional people and venues only; representative of the reference, not production data).
// Immutable: built once at module load from literals, deep-frozen, never written afterwards.

const venue = {
  area: 'Jubilee Hills',
  city: 'Hyderabad',
  venueName: 'The Open Board Cafe',
  address: '12 Sample Road, Jubilee Hills, Hyderabad',
}

const experience = {
  eyebrow: 'First time?',
  heading: 'You bring the curiosity. We will take care of the rest.',
  body: 'Someone from PG greets you at the door, finds you a good first game and introduces you around.',
  highlights: [
    { title: 'A real welcome', body: 'A host knows you are new and makes the first hello easy.' },
    { title: 'A thoughtful pairing', body: 'We match for the game you want, not only a number.' },
  ],
}

const faq = [
  { question: 'Do I need to be a member?', answer: 'No. Walk in, play, and decide later.' },
  { question: 'Can I come alone?', answer: 'Yes. Most people do. We will find you a game.' },
]

const logistics = ['Doors open 30 minutes before the start.', 'Boards and clocks are provided.']

const base = {
  venue,
  experience,
  faq,
  logistics,
  atAGlance: { format: 'Social chess', timeControl: '15+10', membershipRequired: false, hostedArrival: true },
  pairingMode: 'social_balanced',
  cancelled: null,
  archive: null,
  version: 1,
  archivePublished: false,
  area: venue.area,
  city: venue.city,
} as const

const cover = (alt: string) => mockImage('4x3', alt)

// Home card covers (HOME-01): one distinct local file per card, alt describes the photo (not the title), explicit
// focal point. Upcoming dates are relative to MOCK_NOW (Friday): Saturday +1, Sunday +2, Wednesday +5.
const saturdayCover = homeImage('card1', 'Two friends mid-game at a sunny cafe table, coffee cups beside the board', {
  x: 0.5,
  y: 0.42,
})
const beginnerCover = homeImage('card2', 'A host leaning in to show a new player a move on a wooden board', {
  x: 0.45,
  y: 0.38,
})
const blitzCover = homeImage('card3', 'A hand pressing a chess clock during a fast evening game', { x: 0.6, y: 0.55 })

const saturdaySocial: EventDetailDto = {
  ...base,
  slug: mockSlug('saturday-social'),
  title: 'Saturday Social',
  promise: 'Easy games. Good coffee. Stay for another.',
  description: 'A relaxed afternoon of friendly chess for every level. Come alone, leave with a new rival.',
  type: 'social',
  audience: 'all_levels',
  status: 'registration_open',
  startsAt: mockIstAt(1, '17:00'),
  endsAt: mockIstAt(1, '20:30'),
  format: 'Social chess',
  price: { pricePaise: 0, currency: 'INR' },
  rated: false,
  rating: { rated: false },
  firstTimerCount: 7,
  placesLeftHint: 12,
  cover: saturdayCover,
  media: mockCollection([saturdayCover]),
  registration: { opensAt: mockIstAt(-13, '10:00'), closesAt: mockIstAt(1, '15:00'), waitlistEnabled: true },
  updatedAt: mockIstAt(-3, '12:00'),
}

const beginnerCircle: EventDetailDto = {
  ...base,
  slug: mockSlug('beginner-circle'),
  title: 'Beginner Circle',
  promise: 'Your first over-the-board game, minus the awkward bit.',
  description: 'A guided morning for new players: a short warm-up, hosted games and no pressure.',
  type: 'workshop',
  audience: 'beginner',
  status: 'registration_open',
  startsAt: mockIstAt(2, '11:00'),
  endsAt: mockIstAt(2, '14:00'),
  format: 'Guided beginner games',
  price: { pricePaise: 20000, currency: 'INR' },
  rated: false,
  rating: { rated: false },
  pairingMode: 'none',
  firstTimerCount: 11,
  placesLeftHint: 6,
  cover: beginnerCover,
  media: mockCollection([beginnerCover]),
  registration: { opensAt: mockIstAt(-13, '10:00'), closesAt: mockIstAt(2, '09:00'), waitlistEnabled: true },
  updatedAt: mockIstAt(-3, '12:00'),
}

const afterWorkBlitz: EventDetailDto = {
  ...base,
  slug: mockSlug('after-work-blitz'),
  title: 'After Work Blitz',
  promise: 'Clock on. Work off.',
  description: 'Fast, friendly 5+2 blitz after the working day. Rated games, loud clocks.',
  type: 'rated_tournament',
  audience: 'all_levels',
  status: 'sold_out',
  startsAt: mockIstAt(5, '19:30'),
  endsAt: mockIstAt(5, '22:30'),
  format: '5+2 Blitz',
  price: { pricePaise: 30000, currency: 'INR' },
  rated: true,
  rating: { rated: true, pool: 'blitz' },
  atAGlance: { format: '5+2 Blitz', timeControl: '5+2', membershipRequired: false, hostedArrival: true },
  pairingMode: 'swiss',
  firstTimerCount: 3,
  placesLeftHint: 0,
  cover: blitzCover,
  media: mockCollection([blitzCover]),
  registration: { opensAt: mockIstAt(-11, '10:00'), closesAt: mockIstAt(5, '17:00'), waitlistEnabled: true },
  updatedAt: mockIstAt(-2, '12:00'),
}

const monsoonOpen: EventDetailDto = {
  ...base,
  slug: mockSlug('monsoon-open'),
  title: 'Monsoon Open',
  promise: 'Nine rounds, one room, plenty to argue about afterwards.',
  description: 'A nine-round open that closed the monsoon season. Final standings and recap below.',
  type: 'rated_tournament',
  audience: 'all_levels',
  status: 'completed',
  startsAt: '2026-09-13T10:00:00+05:30',
  endsAt: '2026-09-13T19:00:00+05:30',
  format: 'Swiss, 9 rounds',
  price: { pricePaise: 50000, currency: 'INR' },
  rated: true,
  rating: { rated: true, pool: 'rapid' },
  atAGlance: { format: 'Swiss, 9 rounds', timeControl: '15+5', membershipRequired: false, hostedArrival: true },
  pairingMode: 'swiss',
  firstTimerCount: 0,
  placesLeftHint: null,
  archivePublished: true,
  cover: cover('Players studying boards during the Monsoon Open'),
  media: mockCollection([cover('Players studying boards during the Monsoon Open')]),
  registration: { opensAt: '2026-08-20T10:00:00+05:30', closesAt: '2026-09-12T18:00:00+05:30', waitlistEnabled: false },
  archive: {
    recap: 'Thirty-two players, nine rounds and a final-round decider that kept the room watching.',
    winner: {
      publicId: null,
      displayName: 'Asha Rao',
      initials: 'AR',
      rating: { pool: 'rapid', value: 1720 },
      cityChapter: 'Hyderabad',
    },
    standings: [
      {
        place: 1,
        identity: {
          publicId: null,
          displayName: 'Asha Rao',
          initials: 'AR',
          rating: { pool: 'rapid', value: 1720 },
          cityChapter: 'Hyderabad',
        },
        score: 8,
        rounds: 9,
        rating: { pool: 'rapid', value: 1720 },
      },
      {
        place: 2,
        identity: { publicId: null, displayName: 'Dev Menon', initials: 'DM', rating: null, cityChapter: null },
        score: 7.5,
        rounds: 9,
        rating: null,
      },
      {
        place: 3,
        identity: {
          publicId: null,
          displayName: 'Ira Kapoor',
          initials: 'IK',
          rating: { pool: 'rapid', value: 1540 },
          cityChapter: 'Hyderabad',
        },
        score: 7,
        rounds: 9,
        rating: { pool: 'rapid', value: 1540 },
      },
    ],
    gallery: mockCollection([mockImage('3x2', 'The playing hall during round six')]),
    roundsPlayed: 9,
  },
  updatedAt: '2026-09-15T12:00:00+05:30',
}

export const MOCK_EVENTS: readonly EventDetailDto[] = deepFreeze([
  saturdaySocial,
  beginnerCircle,
  afterWorkBlitz,
  monsoonOpen,
])

/** Availability per slug at MOCK_NOW. Pure data; the adapter picks by slug. */
export const MOCK_AVAILABILITY: Readonly<Record<string, AvailabilityDto>> = deepFreeze({
  'saturday-social': { state: 'open', placesLeft: 12, waitlistOpen: false, serverNow: MOCK_NOW },
  'beginner-circle': { state: 'open', placesLeft: 6, waitlistOpen: false, serverNow: MOCK_NOW },
  'after-work-blitz': { state: 'full_waitlist', placesLeft: 0, waitlistOpen: true, serverNow: MOCK_NOW },
  'monsoon-open': { state: 'completed', placesLeft: 0, waitlistOpen: false, serverNow: MOCK_NOW },
} satisfies Record<string, AvailabilityDto>)
