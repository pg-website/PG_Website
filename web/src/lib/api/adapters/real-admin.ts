import type { AdminOptionalKeyOpts, AdminRequestOpts, PgAdminApi, StepUpOpts } from '@/lib/api/pg-admin-api'
import type { ApiRequester, RequestSpec } from '@/lib/api/requester'
import { seg } from '@/lib/api/url'
import {
  adminCmsResponses,
  adminControlResponses,
  adminDashboardResponses,
  adminEventsResponses,
  adminMediaResponses,
  adminPaymentsResponses,
  adminPlayersResponses,
  adminPreviewResponses,
  adminSettingsResponses,
  adminStoriesResponses,
  adminTestimonialsResponses,
} from '@/lib/api/types/response-schemas'
import { DEFAULT_PAGE_SIZE } from '@/lib/api/types/pagination'
import type { IdempotencyKey } from '@/lib/api/types/primitives'
import type { QueryParams, QueryValue } from '@/lib/api/url'

// The real PgAdminApi adapter (FE-12 revised, owner decision 2026-10-28: no admin mocks, admin always talks to the real
// backend). Endpoint ids and paths follow docs/architecture/pgapi-contract/ENDPOINTS-IMPLEMENTED.md. Like adapters/real.ts
// it describes WHAT to call; the browser requester decides HOW (bearer, 401 refresh, timeout) and imports nothing from
// lib/api/browser, so this file stays out of the (public) import graph. Admin code is only reachable from `useApi()`.
//
// Conventions:
//   - every call is `auth: true`; the role is re-read by the server from the database (ADMIN_REQUIRED), never trusted here;
//   - Idempotency-Key is sent as given (required on publish, finalise, cancel, refund, role change, message send);
//   - step-up: refund, role change and audit export carry `opts.stepUp` as `X-Step-Up-Token`. Event update, event cancel and
//     registration actions need one only conditionally, so they run through `hooks.withConditionalStepUp`, which retries once
//     after the step-up dialog when the server answers STEP_UP_REQUIRED;
//   - VERSION_CONFLICT (409/422) surfaces unchanged as ApiError('VERSION_CONFLICT'); the caller re-reads the resource and
//     shows `lastChange`;
//   - lists page by `page` / `pageSize`; bodies are intent only (no price, amount, currency, user id).

export interface RealAdminHooks {
  /**
   * Runs `run(token)`. `token` is a cached single-use grant or `undefined`. On STEP_UP_REQUIRED the implementation asks
   * the admin for their password, then calls `run` once more with the fresh grant.
   */
  withConditionalStepUp: <T>(run: (stepUpToken: string | undefined) => Promise<T>) => Promise<T>
}

/**
 * CMS draft bodies send each image slot as `media: { assetIds, autoplay, intervalMs }` (S03, PLAN-010). A slot is any
 * object with an `items` array plus `mode`; everything else passes through unchanged.
 */
function toDraftContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toDraftContent)
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if (Array.isArray(record.items) && 'mode' in record && 'autoplay' in record) {
    return {
      ...(Array.isArray(record.assetIds) ? { assetIds: record.assetIds } : {}),
      autoplay: record.autoplay,
      intervalMs: record.intervalMs,
    }
  }
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, toDraftContent(v)]))
}

/** Admin writes and reads: bearer from the token manager, refresh on 401. */
function spec(
  method: RequestSpec['method'],
  path: string,
  opts: AdminRequestOpts | undefined,
  rest: Partial<RequestSpec> = {},
): RequestSpec {
  return { method, path, auth: true, signal: opts?.signal, ...rest }
}

function optionalKey(opts: AdminOptionalKeyOpts | undefined): IdempotencyKey | undefined {
  return opts?.idempotencyKey
}

/** Query objects of the admin types hold only scalars; this keeps the strict object types assignable to `QueryParams`. */
function scalars(query: object | undefined): QueryParams | undefined {
  if (query === undefined) return undefined
  const out: Record<string, QueryValue> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

function paged(query: { page?: number | undefined; pageSize?: number | undefined } | undefined): Partial<RequestSpec> {
  return {
    query: scalars(query),
    legacyPage: { page: query?.page ?? 1, pageSize: query?.pageSize ?? DEFAULT_PAGE_SIZE },
  }
}

const ev = (eventId: string): string => `/admin/events/${seg(eventId)}`
const round = (eventId: string, roundId: string): string => `${ev(eventId)}/rounds/${seg(roundId)}`

export function createRealAdminApi(http: ApiRequester, hooks: RealAdminHooks): PgAdminApi {
  const { withConditionalStepUp } = hooks
  const stepped = (opts: StepUpOpts, rest: Partial<RequestSpec>): Partial<RequestSpec> => ({
    ...rest,
    stepUpToken: opts.stepUp,
  })

  return {
    dashboard: {
      getDashboard: (opts) => http.json(spec('GET', '/admin/dashboard', opts), adminDashboardResponses.getDashboard),
    },

    events: {
      listEvents: (query, opts) =>
        http.json(spec('GET', '/admin/events', opts, paged(query)), adminEventsResponses.listEvents),
      createDraft: (input, opts) =>
        http.json(
          spec('POST', '/admin/events', opts, { body: input, idempotencyKey: optionalKey(opts) }),
          adminEventsResponses.createDraft,
        ),
      getEvent: (eventId, opts) => http.json(spec('GET', ev(eventId), opts), adminEventsResponses.getEvent),
      updateEvent: (eventId, input, opts) =>
        withConditionalStepUp((stepUpToken) =>
          http.json(spec('PATCH', ev(eventId), opts, { body: input, stepUpToken }), adminEventsResponses.updateEvent),
        ),
      checkSlug: (query, opts) =>
        http.json(spec('GET', '/admin/slugs/check', opts, { query: scalars(query) }), adminEventsResponses.checkSlug),
      getEventTypes: (opts) => http.json(spec('GET', '/admin/event-types', opts), adminEventsResponses.getEventTypes),
      publishEvent: (eventId, key, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/publish`, opts, { idempotencyKey: key }),
          adminEventsResponses.publishEvent,
        ),
      unpublishEvent: (eventId, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/unpublish`, opts, { idempotencyKey: optionalKey(opts) }),
          adminEventsResponses.unpublishEvent,
        ),
      openRegistrations: (eventId, key, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/open-registration`, opts, { idempotencyKey: key }),
          adminEventsResponses.openRegistrations,
        ),
      closeRegistrations: (eventId, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/close-registration`, opts),
          adminEventsResponses.closeRegistrations,
        ),
      deleteEvent: (eventId, opts) =>
        http.json(
          spec('DELETE', `${ev(eventId)}/delete`, opts, {}),
          adminEventsResponses.deleteEvent,
        ),
      cancelEvent: (eventId, input, key, opts) =>
        withConditionalStepUp((stepUpToken) =>
          http.json(
            spec('POST', `${ev(eventId)}/cancel`, opts, { body: input, idempotencyKey: key, stepUpToken }),
            adminEventsResponses.cancelEvent,
          ),
        ),
      completeEvent: (eventId, input, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/complete`, opts, { body: input, idempotencyKey: optionalKey(opts) }),
          adminEventsResponses.completeEvent,
        ),
    },

    control: {
      getOverview: (eventId, opts) =>
        http.json(spec('GET', `${ev(eventId)}/overview`, opts), adminControlResponses.getOverview),
      listRegistrations: (eventId, query, opts) =>
        http.json(
          spec('GET', `${ev(eventId)}/registrations`, opts, paged(query)),
          adminControlResponses.listRegistrations,
        ),
      actOnRegistration: (eventId, registrationId, input, opts) =>
        withConditionalStepUp((stepUpToken) =>
          http.json(
            spec('POST', `${ev(eventId)}/registrations/${seg(registrationId)}/actions`, opts, {
              body: input,
              idempotencyKey: optionalKey(opts),
              stepUpToken,
            }),
            adminControlResponses.actOnRegistration,
          ),
        ),
      cashRegisterPlayer: (eventId, body, key, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/registrations/cash`, opts, { body, idempotencyKey: key }),
          adminControlResponses.cashRegisterPlayer,
        ),
      getCheckInDesk: (eventId, query, opts) =>
        http.json(
          spec('GET', `${ev(eventId)}/check-in`, opts, { query: scalars(query) }),
          adminControlResponses.getCheckInDesk,
        ),
      setCheckIn: (eventId, input, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/check-in`, opts, { body: input, idempotencyKey: optionalKey(opts) }),
          adminControlResponses.setCheckIn,
        ),
      checkInAll: (eventId, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/check-in/all`, opts, { idempotencyKey: optionalKey(opts) }),
          adminControlResponses.checkInAll,
        ),
      listRounds: (eventId, opts) =>
        http.json(spec('GET', `${ev(eventId)}/rounds`, opts), adminControlResponses.listRounds),
      generateRound: (eventId, input, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/rounds/generate`, opts, { body: input, idempotencyKey: optionalKey(opts) }),
          adminControlResponses.generateRound,
        ),
      editPairings: (eventId, roundId, input, opts) =>
        http.json(
          spec('PATCH', `${round(eventId, roundId)}/pairings`, opts, { body: input }),
          adminControlResponses.editPairings,
        ),
      publishRound: (eventId, roundId, version, key, opts) =>
        http.json(
          spec('POST', `${round(eventId, roundId)}/publish`, opts, { body: { version }, idempotencyKey: key }),
          adminControlResponses.publishRound,
        ),
      startRound: (eventId, roundId, version, opts) =>
        http.json(
          spec('POST', `${round(eventId, roundId)}/start`, opts, {
            body: { version },
            idempotencyKey: optionalKey(opts),
          }),
          adminControlResponses.startRound,
        ),
      recordResult: (eventId, roundId, pairingId, input, opts) =>
        http.json(
          spec('PUT', `${round(eventId, roundId)}/pairings/${seg(pairingId)}/result`, opts, {
            body: input,
            idempotencyKey: optionalKey(opts),
          }),
          adminControlResponses.recordResult,
        ),
      finaliseRound: (eventId, roundId, version, key, opts) =>
        http.json(
          spec('POST', `${round(eventId, roundId)}/finalise`, opts, { body: { version }, idempotencyKey: key }),
          adminControlResponses.finaliseRound,
        ),
      listEventPayments: (eventId, query, opts) =>
        http.json(spec('GET', `${ev(eventId)}/payments`, opts, paged(query)), adminControlResponses.listEventPayments),
      listMessages: (eventId, opts) =>
        http.json(spec('GET', `${ev(eventId)}/messages`, opts), adminControlResponses.listMessages),
      getMessage: (eventId, messageId, opts) =>
        http.json(spec('GET', `${ev(eventId)}/messages/${seg(messageId)}`, opts), adminControlResponses.getMessage),
      sendMessage: (eventId, input, key, opts) =>
        http.json(
          spec('POST', `${ev(eventId)}/messages`, opts, { body: input, idempotencyKey: key }),
          adminControlResponses.sendMessage,
        ),
      getCommunications: (eventId, opts) =>
        http.json(spec('GET', `${ev(eventId)}/communications`, opts), adminControlResponses.getCommunications),
      updateCommunications: (eventId, input, opts) =>
        http.json(
          spec('PATCH', `${ev(eventId)}/communications`, opts, { body: input }),
          adminControlResponses.updateCommunications,
        ),
      getRecap: (eventId, opts) => http.json(spec('GET', `${ev(eventId)}/recap`, opts), adminControlResponses.getRecap),
      updateRecap: (eventId, input, opts) =>
        http.json(spec('PATCH', `${ev(eventId)}/recap`, opts, { body: input }), adminControlResponses.updateRecap),
      listAudit: (eventId, query, opts) =>
        http.json(spec('GET', `${ev(eventId)}/audit`, opts, paged(query)), adminControlResponses.listAudit),
      // The CSV answer has no envelope and ApiRequester has no raw-body method yet (open item, see the FE-12 report).
      exportAudit: () => Promise.reject(new Error('Audit CSV export is not wired yet (needs a raw-body requester).')),
    },

    cms: {
      listSections: (opts) => http.json(spec('GET', '/admin/cms/sections', opts), adminCmsResponses.listSections),
      getSection: (key, opts) =>
        http.json(spec('GET', `/admin/cms/sections/${seg(key)}`, opts), adminCmsResponses.getSection),
      saveSectionDraft: (input, opts) =>
        http.json(
          spec('PUT', `/admin/cms/sections/${seg(input.key)}/draft`, opts, {
            body: { version: input.version, content: toDraftContent(input.content) },
          }),
          adminCmsResponses.saveSectionDraft,
        ),
      publishSection: (key, version, idempotencyKey, opts) =>
        http.json(
          spec('POST', `/admin/cms/sections/${seg(key)}/publish`, opts, { body: { version }, idempotencyKey }),
          adminCmsResponses.publishSection,
        ),
      listSectionVersions: (key, opts) =>
        http.json(
          spec('GET', `/admin/cms/sections/${seg(key)}/versions`, opts, {
            legacyPage: { page: 1, pageSize: DEFAULT_PAGE_SIZE },
          }),
          adminCmsResponses.listSectionVersions,
        ),
      getLegalPage: (page, opts) =>
        http.json(spec('GET', `/admin/legal/${seg(page)}`, opts), adminCmsResponses.getLegalPage),
      saveLegalDraft: (page, input, opts) =>
        http.json(spec('PUT', `/admin/legal/${seg(page)}`, opts, { body: input }), adminCmsResponses.saveLegalDraft),
      publishLegalPage: (page, version, key, opts) =>
        http.json(
          spec('POST', `/admin/legal/${seg(page)}/publish`, opts, { body: { version }, idempotencyKey: key }),
          adminCmsResponses.publishLegalPage,
        ),
    },

    media: {
      requestUpload: (input, opts) =>
        http.json(spec('POST', '/admin/media/uploads', opts, { body: input }), adminMediaResponses.requestUpload),
      completeUpload: (assetId, opts) =>
        http.json(
          spec('POST', `/admin/media/assets/${seg(assetId)}/complete`, opts),
          adminMediaResponses.completeUpload,
        ),
      listAssets: (query, opts) =>
        http.json(spec('GET', '/admin/media/assets', opts, paged(query)), adminMediaResponses.listAssets),
      updateAsset: (assetId, input, opts) =>
        http.json(
          spec('PATCH', `/admin/media/assets/${seg(assetId)}`, opts, { body: input }),
          adminMediaResponses.updateAsset,
        ),
      deleteAsset: (assetId, opts) => http.empty(spec('DELETE', `/admin/media/assets/${seg(assetId)}`, opts)),
    },

    stories: {
      listStories: (query, opts) =>
        http.json(spec('GET', '/admin/stories', opts, paged(query)), adminStoriesResponses.listStories),
      createStory: (input, opts) =>
        http.json(spec('POST', '/admin/stories', opts, { body: input }), adminStoriesResponses.createStory),
      getStory: (id, opts) => http.json(spec('GET', `/admin/stories/${seg(id)}`, opts), adminStoriesResponses.getStory),
      updateStory: (id, input, opts) =>
        http.json(spec('PATCH', `/admin/stories/${seg(id)}`, opts, { body: input }), adminStoriesResponses.updateStory),
      publishStory: (id, key, opts) =>
        http.json(
          spec('POST', `/admin/stories/${seg(id)}/publish`, opts, { idempotencyKey: key }),
          adminStoriesResponses.publishStory,
        ),
      unpublishStory: (id, opts) =>
        http.json(
          spec('POST', `/admin/stories/${seg(id)}/unpublish`, opts, { idempotencyKey: optionalKey(opts) }),
          adminStoriesResponses.unpublishStory,
        ),
    },

    testimonials: {
      listTestimonials: (query, opts) =>
        http.json(spec('GET', '/admin/testimonials', opts, paged(query)), adminTestimonialsResponses.listTestimonials),
      createTestimonial: (input, opts) =>
        http.json(
          spec('POST', '/admin/testimonials', opts, { body: input }),
          adminTestimonialsResponses.createTestimonial,
        ),
      getTestimonial: (id, opts) =>
        http.json(spec('GET', `/admin/testimonials/${seg(id)}`, opts), adminTestimonialsResponses.getTestimonial),
      updateTestimonial: (id, input, opts) =>
        http.json(
          spec('PATCH', `/admin/testimonials/${seg(id)}`, opts, { body: input }),
          adminTestimonialsResponses.updateTestimonial,
        ),
      // S16 publish: the contract table says Idempotency-Key is required. The interface leaves the key optional, so it is
      // forwarded when supplied; callers should always pass one.
      publishTestimonial: (id, opts) =>
        http.json(
          spec('POST', `/admin/testimonials/${seg(id)}/publish`, opts, { idempotencyKey: optionalKey(opts) }),
          adminTestimonialsResponses.publishTestimonial,
        ),
      unpublishTestimonial: (id, opts) =>
        http.json(
          spec('POST', `/admin/testimonials/${seg(id)}/unpublish`, opts, { idempotencyKey: optionalKey(opts) }),
          adminTestimonialsResponses.unpublishTestimonial,
        ),
    },

    preview: {
      createPreviewLink: (input, opts) =>
        http.json(spec('POST', '/admin/preview-link', opts, { body: input }), adminPreviewResponses.createPreviewLink),
    },

    players: {
      listPlayers: (query, opts) =>
        http.json(spec('GET', '/admin/players', opts, paged(query)), adminPlayersResponses.listPlayers),
      getPlayer: (id, opts) =>
        http.json(spec('GET', `/admin/players/${seg(id)}`, opts), adminPlayersResponses.getPlayer),
      changeRole: (id, input, key, opts) =>
        http.json(
          spec('PUT', `/admin/players/${seg(id)}/role`, opts, stepped(opts, { body: input, idempotencyKey: key })),
          adminPlayersResponses.changeRole,
        ),
    },

    payments: {
      listLedger: (query, opts) =>
        http.json(spec('GET', '/admin/payments', opts, paged(query)), adminPaymentsResponses.listLedger),
      refund: (paymentId, input, key, opts) =>
        http.json(
          spec(
            'POST',
            `/admin/payments/${seg(paymentId)}/refund`,
            opts,
            stepped(opts, { body: input, idempotencyKey: key }),
          ),
          adminPaymentsResponses.refund,
        ),
      reconcile: (input, opts) =>
        http.json(
          spec('POST', '/admin/payments/reconcile', opts, { body: input, idempotencyKey: optionalKey(opts) }),
          adminPaymentsResponses.reconcile,
        ),
    },

    settings: {
      getSettings: (opts) => http.json(spec('GET', '/admin/settings', opts), adminSettingsResponses.getSettings),
      updateSettings: (input, opts) =>
        http.json(spec('PATCH', '/admin/settings', opts, { body: input }), adminSettingsResponses.updateSettings),
    },
  }
}
