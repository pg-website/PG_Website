import { queryOptions } from '@tanstack/react-query'
import type { PgApi } from '@/lib/api/pg-api'
import type { MyEventsQuery } from '@/lib/api/types/my-events'
import type { PageQuery } from '@/lib/api/types/pagination'
import type { RatingPool } from '@/lib/api/types/identity'
import type { TrendQuery } from '@/lib/api/types/rating'
import type { Slug } from '@/lib/api/types/primitives'
import { STALE_TIME } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'

// Shared queryOptions for auth and player reads (ARCH-001 11.9). One definition used by components and prefetches, so one
// cache entry serves both (RBP client-swr-dedup). Thin on purpose: every factory takes the `PgApi` (components pass
// `useApi()`) and forwards TanStack's abort `signal`; transport, auth and validation stay in the API layer.
//
// Not here: `auth.login/register/...` (mutations, see useApiMutation) and the polled Event Room read, which is composed
// with `usePolling` (see `eventRoomQuery`: staleTime 0, the interval is chosen by the caller).

type EventId = Parameters<PgApi['player']['eventRoom']['getSnapshot']>[0]
type RegistrationId = Parameters<PgApi['player']['registration']['getRegistration']>[0]

// ---------- auth ----------

/** A05. The server's role is authoritative; refetched on mount so a role change shows up quickly. */
export const meQuery = (api: PgApi) =>
  queryOptions({
    queryKey: qk.me(),
    queryFn: ({ signal }) => api.player.auth.getMe({ signal }),
    staleTime: STALE_TIME.default,
  })

// ---------- public player profile (PLAN-007) ----------

export const playerProfileQuery = (api: PgApi, publicId: string) =>
  queryOptions({
    queryKey: qk.playerProfile(publicId),
    queryFn: ({ signal }) => api.public.getPlayerProfile(publicId, { signal }),
  })

// ---------- dashboard (M01 to M04) ----------

export const nextUpQuery = (api: PgApi) =>
  queryOptions({
    queryKey: qk.nextUp(),
    queryFn: ({ signal }) => api.player.me.getNextUp({ signal }),
  })

export const recentGamesQuery = (api: PgApi, query?: PageQuery) =>
  queryOptions({
    queryKey: qk.recentGames(query),
    queryFn: ({ signal }) => api.player.me.getRecentGames(query, { signal }),
  })

export const peopleQuery = (api: PgApi) =>
  queryOptions({
    queryKey: qk.people(),
    queryFn: ({ signal }) => api.player.me.getPeople({ signal }),
  })

export const myEventsQuery = (api: PgApi, query: MyEventsQuery) =>
  queryOptions({
    queryKey: qk.myRegistrations(query),
    queryFn: ({ signal }) => api.player.me.getMyEvents(query, { signal }),
  })

// ---------- registration (R01, R06) ----------

/** R01. A stale registration state could offer an action the server will refuse: always refetch on mount. */
export const registrationStateQuery = (api: PgApi, slug: Slug) =>
  queryOptions({
    queryKey: qk.registration(slug),
    queryFn: ({ signal }) => api.player.registration.getRegistrationState(slug, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

/**
 * P03 read in the browser for the registration frame (event title, date, venue, cancelled notice). Public data, but
 * it sits in the player cache so the frame loads it in parallel with R01. A null result means "no such event".
 */
export const registrationEventQuery = (api: PgApi, slug: Slug) =>
  queryOptions({
    queryKey: qk.registrationEvent(slug),
    queryFn: ({ signal }) => api.public.getEventBySlug(slug, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

/** P04 for the registration side panel ("12 places left"; hidden for an unlimited event). Always live. */
export const registrationAvailabilityQuery = (api: PgApi, slug: Slug) =>
  queryOptions({
    queryKey: qk.registrationAvailability(slug),
    queryFn: ({ signal }) => api.public.getEventAvailability(slug, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

/** R06. Polling-safe and no-store; compose with `usePolling` while a payment is `confirming`. */
export const registrationQuery = (api: PgApi, registrationId: RegistrationId) =>
  queryOptions({
    queryKey: qk.registrationById(registrationId),
    queryFn: ({ signal }) => api.player.registration.getRegistration(registrationId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

// ---------- event room (M05) ----------

/** M05. Snapshot: staleTime 0. Polling is added by `usePolling` at the call site (interval derived from `roomState`). */
export const eventRoomQuery = (api: PgApi, eventId: EventId) =>
  queryOptions({
    queryKey: qk.eventRoom(eventId),
    queryFn: ({ signal }) => api.player.eventRoom.getSnapshot(eventId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

// ---------- ratings (M10 to M12) ----------

export const ratingsQuery = (api: PgApi) =>
  queryOptions({
    queryKey: qk.ratings(),
    queryFn: ({ signal }) => api.player.rating.getRatings({ signal }),
  })

export const ratingLedgerQuery = (api: PgApi, pool: RatingPool, page = 1) =>
  queryOptions({
    queryKey: qk.ratingLedger(pool, page),
    queryFn: ({ signal }) => api.player.rating.getLedger(pool, { page }, { signal }),
  })

export const ratingTrendQuery = (api: PgApi, pool: RatingPool, query?: TrendQuery) =>
  queryOptions({
    queryKey: qk.ratingTrend(pool, query?.days ?? 'default'),
    queryFn: ({ signal }) => api.player.rating.getTrend(pool, query, { signal }),
  })

// ---------- profile (M13) ----------

export const profileQuery = (api: PgApi) =>
  queryOptions({
    queryKey: qk.profile(),
    queryFn: ({ signal }) => api.player.profile.getProfile({ signal }),
  })
