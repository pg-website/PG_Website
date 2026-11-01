import { queryOptions } from '@tanstack/react-query'
import type { PgAdminApi } from '@/lib/api/pg-admin-api'
import type { AuditQuery } from '@/lib/api/types/admin/control-audit'
import type { AdminCheckInQuery } from '@/lib/api/types/admin/control-checkin'
import type { AdminRegistrationsQuery } from '@/lib/api/types/admin/control-registrations'
import type { AdminEventsQuery } from '@/lib/api/types/admin/event-list'
import type { MediaAssetsQuery } from '@/lib/api/types/admin/media'
import type { EventPaymentsQuery, LedgerQuery } from '@/lib/api/types/admin/payments'
import type { AdminPlayersQuery } from '@/lib/api/types/admin/players'
import type { AdminStoriesQuery } from '@/lib/api/types/admin/stories'
import type { AdminTestimonialsQuery } from '@/lib/api/types/admin/testimonials'
import type { LegalPage } from '@/lib/api/types/legal-sitemap'
import type { SiteSection } from '@/lib/api/types/site-content'
import { STALE_TIME } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'

// Shared queryOptions for admin reads (ARCH-001 11.9; PgAdminApi groups). Same rules as player.ts: thin, take the
// `PgApi['admin']` group object (components pass `useApi().admin`), forward the abort signal, no transport logic.
// Resources that carry a `version` (builder draft, CMS section, story, settings, rounds) use staleTime 0: an editor must
// never start from a cached copy, because a stale `version` only produces VERSION_CONFLICT.

type Admin = PgAdminApi
type EventId = Parameters<Admin['events']['getEvent']>[0]
type MessageId = Parameters<Admin['control']['getMessage']>[1]
type StoryId = Parameters<Admin['stories']['getStory']>[0]
type TestimonialId = Parameters<Admin['testimonials']['getTestimonial']>[0]
type PlayerId = Parameters<Admin['players']['getPlayer']>[0]

export const adminDashboardQuery = (admin: Admin) =>
  queryOptions({
    queryKey: qk.admin.dashboard(),
    queryFn: ({ signal }) => admin.dashboard.getDashboard({ signal }),
    staleTime: STALE_TIME.snapshot,
  })

// ---------- events and builder (E01 to E06) ----------

export const adminEventsQuery = (admin: Admin, query?: AdminEventsQuery) =>
  queryOptions({
    queryKey: qk.admin.events(query),
    queryFn: ({ signal }) => admin.events.listEvents(query, { signal }),
  })

export const adminEventQuery = (admin: Admin, eventId: EventId) =>
  queryOptions({
    queryKey: qk.admin.event(eventId),
    queryFn: ({ signal }) => admin.events.getEvent(eventId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

export const adminEventTypesQuery = (admin: Admin) =>
  queryOptions({
    queryKey: qk.admin.eventTypes(),
    queryFn: ({ signal }) => admin.events.getEventTypes({ signal }),
    staleTime: STALE_TIME.reference,
  })

// ---------- event control room (C01 to C17) ----------

export const adminOverviewQuery = (admin: Admin, eventId: EventId) =>
  queryOptions({
    queryKey: qk.admin.overview(eventId),
    queryFn: ({ signal }) => admin.control.getOverview(eventId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

export const adminRegistrationsQuery = (admin: Admin, eventId: EventId, query?: AdminRegistrationsQuery) =>
  queryOptions({
    queryKey: qk.admin.registrations(eventId, query),
    queryFn: ({ signal }) => admin.control.listRegistrations(eventId, query, { signal }),
  })

export const adminCheckInQuery = (admin: Admin, eventId: EventId, query?: AdminCheckInQuery) =>
  queryOptions({
    queryKey: qk.admin.checkIn(eventId, query),
    queryFn: ({ signal }) => admin.control.getCheckInDesk(eventId, query, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

export const adminRoundsQuery = (admin: Admin, eventId: EventId) =>
  queryOptions({
    queryKey: qk.admin.rounds(eventId),
    queryFn: ({ signal }) => admin.control.listRounds(eventId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

/** C13 */
export const adminEventPaymentsQuery = (admin: Admin, eventId: EventId, query?: EventPaymentsQuery) =>
  queryOptions({
    queryKey: qk.admin.payments(eventId, query),
    queryFn: ({ signal }) => admin.control.listEventPayments(eventId, query, { signal }),
  })

/** C14 */
export const adminMessagesQuery = (admin: Admin, eventId: EventId) =>
  queryOptions({
    queryKey: qk.admin.messages(eventId),
    queryFn: ({ signal }) => admin.control.listMessages(eventId, { signal }),
  })

export const adminMessageQuery = (admin: Admin, eventId: EventId, messageId: MessageId) =>
  queryOptions({
    queryKey: qk.admin.message(eventId, messageId),
    queryFn: ({ signal }) => admin.control.getMessage(eventId, messageId, { signal }),
  })

/** C15 */
export const adminCommunicationsQuery = (admin: Admin, eventId: EventId) =>
  queryOptions({
    queryKey: qk.admin.communications(eventId),
    queryFn: ({ signal }) => admin.control.getCommunications(eventId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

/** C16 */
export const adminRecapQuery = (admin: Admin, eventId: EventId) =>
  queryOptions({
    queryKey: qk.admin.recap(eventId),
    queryFn: ({ signal }) => admin.control.getRecap(eventId, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

/** C17 list. The CSV export needs a step-up token and is a mutation-like action, not a query. */
export const adminAuditQuery = (admin: Admin, eventId: EventId, query?: AuditQuery) =>
  queryOptions({
    queryKey: qk.admin.audit(eventId, query),
    queryFn: ({ signal }) => admin.control.listAudit(eventId, query, { signal }),
  })

// ---------- CMS (S01 to S06) ----------

export const adminCmsSectionsQuery = (admin: Admin) =>
  queryOptions({
    queryKey: qk.admin.cms(),
    queryFn: ({ signal }) => admin.cms.listSections({ signal }),
    staleTime: STALE_TIME.reference,
  })

export const adminCmsSectionQuery = (admin: Admin, key: SiteSection) =>
  queryOptions({
    queryKey: qk.admin.cmsSection(key),
    queryFn: ({ signal }) => admin.cms.getSection(key, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

export const adminCmsVersionsQuery = (admin: Admin, key: SiteSection) =>
  queryOptions({
    queryKey: qk.admin.cmsVersions(key),
    queryFn: ({ signal }) => admin.cms.listSectionVersions(key, { signal }),
  })

export const adminLegalPageQuery = (admin: Admin, page: LegalPage) =>
  queryOptions({
    queryKey: qk.admin.legalPage(page),
    queryFn: ({ signal }) => admin.cms.getLegalPage(page, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

// ---------- media (S09) ----------

export const adminMediaAssetsQuery = (admin: Admin, query?: MediaAssetsQuery) =>
  queryOptions({
    queryKey: qk.admin.mediaAssets(query),
    queryFn: ({ signal }) => admin.media.listAssets(query, { signal }),
  })

// ---------- stories and testimonials ----------

export const adminStoriesQuery = (admin: Admin, query?: AdminStoriesQuery) =>
  queryOptions({
    queryKey: qk.admin.stories(query),
    queryFn: ({ signal }) => admin.stories.listStories(query, { signal }),
  })

export const adminStoryQuery = (admin: Admin, id: StoryId) =>
  queryOptions({
    queryKey: qk.admin.story(id),
    queryFn: ({ signal }) => admin.stories.getStory(id, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

export const adminTestimonialsQuery = (admin: Admin, query?: AdminTestimonialsQuery) =>
  queryOptions({
    queryKey: qk.admin.testimonials(query),
    queryFn: ({ signal }) => admin.testimonials.listTestimonials(query, { signal }),
  })

export const adminTestimonialQuery = (admin: Admin, id: TestimonialId) =>
  queryOptions({
    queryKey: qk.admin.testimonial(id),
    queryFn: ({ signal }) => admin.testimonials.getTestimonial(id, { signal }),
    staleTime: STALE_TIME.snapshot,
  })

// ---------- players, ledger, settings ----------

export const adminPlayersQuery = (admin: Admin, query?: AdminPlayersQuery) =>
  queryOptions({
    queryKey: qk.admin.players(query),
    queryFn: ({ signal }) => admin.players.listPlayers(query, { signal }),
  })

export const adminPlayerQuery = (admin: Admin, id: PlayerId) =>
  queryOptions({
    queryKey: qk.admin.player(id),
    queryFn: ({ signal }) => admin.players.getPlayer(id, { signal }),
  })

/** G04 */
export const adminLedgerQuery = (admin: Admin, query?: LedgerQuery) =>
  queryOptions({
    queryKey: qk.admin.ledger(query),
    queryFn: ({ signal }) => admin.payments.listLedger(query, { signal }),
  })

export const adminSettingsQuery = (admin: Admin) =>
  queryOptions({
    queryKey: qk.admin.settings(),
    queryFn: ({ signal }) => admin.settings.getSettings({ signal }),
    staleTime: STALE_TIME.snapshot,
  })
