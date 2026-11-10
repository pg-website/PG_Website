import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import type {
  EventsQuery,
  PastEventsQuery,
  OptionalKeyOpts,
  PgPlayerApi,
  PgPublicApi,
  ReadOpts,
  RequestOpts,
} from '@/lib/api/pg-api'
import type { ApiRequester, RequestSpec } from '@/lib/api/requester'
import { seg } from '@/lib/api/url'
import {
  authResponses,
  eventRoomResponses,
  meResponses,
  profileResponses,
  publicResponses,
  ratingResponses,
  registrationResponses,
} from '@/lib/api/types/response-schemas'
import { authResultWireSchema, type AuthResult, type ChangePasswordInput } from '@/lib/api/types/auth'
import { nextUpSchema } from '@/lib/api/types/my-events'
import { DEFAULT_PAGE_SIZE, type PageQuery } from '@/lib/api/types/pagination'
import type { IdempotencyKey } from '@/lib/api/types/primitives'
import type { SiteSection, SiteSectionDto } from '@/lib/api/types/site-content'
import { isHttpsUrl } from '@/lib/api/types/primitives'

// The real PgApi adapter for the PUBLIC and PLAYER groups (ARCH-001 11.3; endpoint ids from the backend contract, section 3).
// It describes WHAT to call; an `ApiRequester` (server/fetch.ts or browser/client.ts) decides HOW. This file imports
// nothing from lib/api/browser or lib/api/server, so (public) code can reach it through getPublicApi() without pulling in
// token code (M3, SEC-001 F-04), and the same adapter runs on both sides.
// ADMIN (PgAdminApi, 71 methods) is NOT implemented here: it is a follow-up. See useApi.browser.ts for the stub.
//
// Conventions:
//   - public reads pass `tags`/`revalidate` through; the server requester forwards them to the Next data cache, the
//     browser requester ignores them;
//   - a slug read (`getEventBySlug`, `getStoryBySlug`) resolves `null` on a 404 and throws on every other failure;
//   - every method that creates or settles something takes the Idempotency-Key and sends it as given;
//   - paging is by page number only (`page`, `page_size`); no response URL is ever followed (F-16);
//   - bodies are intent only (AC-35): no price, amount, currency, user id or role.

export interface RealPlayerHooks {
  /** Cookie mode: headers the refresh/logout endpoints need (`X-CSRF-Token`). `undefined` in body mode. */
  csrfHeaders: () => Readonly<Record<string, string>> | undefined
}

/** Hosts a backend-supplied OAuth start URL may point to (F-16). One place to extend when the provider list grows. */
export const OAUTH_REDIRECT_HOSTS: readonly string[] = ['accounts.google.com']

const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['EVENT_NOT_FOUND', 'NOT_FOUND', 'HTTP_404'])

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && NOT_FOUND_CODES.has(error.code)
}

function readSpec(path: string, opts: ReadOpts | undefined, rest: Partial<RequestSpec> = {}): RequestSpec {
  const preview = opts?.previewKey === undefined ? {} : { headers: { 'X-Preview-Key': opts.previewKey } }
  return {
    method: 'GET',
    path,
    signal: opts?.signal,
    tags: opts?.tags,
    revalidate: opts?.revalidate,
    ...preview,
    ...rest,
  }
}

/**
 * Draft preview only (FE-04): the backend serves an unpublished event with status: 'draft', which the public schema refuses
 * on purpose (draft never appears on a public DTO). A previewer sees it as published; the published path never uses this.
 */
const previewEventSchema = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'draft'
      ? { ...value, status: 'published' }
      : value,
  publicResponses.getEventBySlug,
)

function pageHint(query: PageQuery | undefined): { page: number; pageSize: number } {
  return { page: query?.page ?? 1, pageSize: query?.pageSize ?? DEFAULT_PAGE_SIZE }
}

function pageParams(query: PageQuery | undefined): { page: number | undefined; pageSize: number | undefined } {
  return { page: query?.page, pageSize: query?.pageSize }
}

// ---------- public ----------

export function createRealPublicApi(http: ApiRequester): PgPublicApi {
  return {
    async getSiteContent<K extends SiteSection>(section: K, opts?: ReadOpts) {
      const dto = await http.json(readSpec(`/site/${seg(section)}`, opts), publicResponses.getSiteContent)
      if (dto.key !== section) throw new ApiError('BAD_RESPONSE', { status: 200 }) // a different section came back
      return dto as Extract<SiteSectionDto, { key: K }>
    },

    getUpcomingEvents(query?: EventsQuery, opts?: ReadOpts) {
      return http.json(
        readSpec('/events', opts, {
          query: {
            ...pageParams(query),
            q: query?.q,
            type: query?.type,
            audience: query?.audience,
            free: query?.free,
            city: query?.city,
          },
          legacyPage: pageHint(query),
        }),
        publicResponses.getUpcomingEvents,
      )
    },

    async getEventBySlug(slug, opts) {
      try {
        return await http.json(
          readSpec(`/events/${seg(slug)}`, opts),
          opts?.previewKey === undefined ? publicResponses.getEventBySlug : previewEventSchema,
        )
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    getEventAvailability(slug, opts) {
      // P04 is no-store: the availability island polls it.
      return http.json(
        readSpec(`/events/${seg(slug)}/availability`, opts, { revalidate: 0 }),
        publicResponses.getEventAvailability,
      )
    },

    getPastEvents(query?: PastEventsQuery, opts?: ReadOpts) {
      return http.json(
        readSpec('/past-events', opts, {
          query: { ...pageParams(query), q: query?.q, type: query?.type },
          legacyPage: pageHint(query),
        }),
        publicResponses.getPastEvents,
      )
    },

    getStories(query, opts) {
      return http.json(
        readSpec('/stories', opts, { query: pageParams(query), legacyPage: pageHint(query) }),
        publicResponses.getStories,
      )
    },

    async getStoryBySlug(slug, opts) {
      try {
        return await http.json(readSpec(`/stories/${seg(slug)}`, opts), publicResponses.getStoryBySlug)
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    getTestimonials(opts) {
      return http.json(readSpec('/testimonials', opts), publicResponses.getTestimonials)
    },

    getLegalPage(page, opts) {
      return http.json(readSpec(`/legal/${seg(page)}`, opts), publicResponses.getLegalPage)
    },

    getSitemapEntries(query, opts) {
      return http.json(
        readSpec('/sitemap-entries', opts, { query: pageParams(query), legacyPage: pageHint(query) }),
        publicResponses.getSitemapEntries,
      )
    },

    getPublicSettings(opts) {
      return http.json(readSpec('/settings/public', opts), publicResponses.getPublicSettings)
    },

    async getPlayerProfile(publicId, opts) {
      try {
        return await http.json(readSpec(`/players/${seg(publicId)}`, opts), publicResponses.getPlayerProfile)
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    submitContact(input, key, opts) {
      return http.empty({
        method: 'POST',
        path: '/contact',
        body: input,
        idempotencyKey: key,
        signal: opts?.signal,
      })
    },
  }
}

// ---------- player ----------

function authed(path: string, opts: RequestOpts | undefined, rest: Partial<RequestSpec> = {}): RequestSpec {
  return { method: 'GET', path, auth: true, signal: opts?.signal, ...rest }
}

function command(
  path: string,
  opts: RequestOpts | undefined,
  body?: unknown,
  key?: IdempotencyKey,
  method: RequestSpec['method'] = 'POST',
): RequestSpec {
  return { method, path, auth: true, signal: opts?.signal, body, idempotencyKey: key }
}

function optionalKey(opts: OptionalKeyOpts | undefined): IdempotencyKey | undefined {
  return opts?.idempotencyKey
}

/** Folds the wire shape (`tokens` next to `user`) into `AuthResult`. Strict union: body mode, then cookie mode. */
function foldAuthResult(wire: z.output<typeof authResultWireSchema>): AuthResult {
  const { user, ...tokens } = wire
  return { user, tokens }
}

function assertOauthHost(url: string): void {
  if (!isHttpsUrl(url) || !OAUTH_REDIRECT_HOSTS.includes(new URL(url).hostname)) {
    throw new ApiError('BAD_RESPONSE', { status: 200 }) // never redirect the browser to a host we do not know (F-16)
  }
}

export function createRealPlayerApi(http: ApiRequester, hooks: RealPlayerHooks): PgPlayerApi {
  return {
    auth: {
      async login(input, opts) {
        const wire = await http.json(
          { method: 'POST', path: '/auth/login', body: input, signal: opts?.signal },
          authResultWireSchema,
        )
        return foldAuthResult(wire)
      },

      async register(input, opts) {
        const wire = await http.json(
          { method: 'POST', path: '/auth/register', body: input, signal: opts?.signal },
          authResultWireSchema,
        )
        return foldAuthResult(wire)
      },

      /**
       * RAW endpoint call (A03), for conformance and the mock. The app refreshes through `TokenManager.refresh()`, which
       * stores the rotated pair; calling this directly would rotate the refresh token without storing it.
       */
      refresh(input, opts) {
        return http.json(
          {
            method: 'POST',
            path: '/auth/refresh',
            body: input,
            headers: hooks.csrfHeaders(),
            signal: opts?.signal,
          },
          authResponses.refresh,
        )
      },

      /** RAW endpoint call (A04). The app signs out through `TokenManager.logout()`, which also clears local state. */
      logout(input, opts) {
        return http.empty({
          method: 'POST',
          path: '/auth/logout',
          body: input,
          headers: hooks.csrfHeaders(),
          signal: opts?.signal,
        })
      },

      getMe(opts) {
        return http.json(authed('/auth/me', opts), authResponses.getMe)
      },

      requestPasswordReset(input, opts) {
        return http.empty({ method: 'POST', path: '/auth/password-reset', body: input, signal: opts?.signal })
      },

      confirmPasswordReset(input, opts) {
        return http.empty({ method: 'POST', path: '/auth/password-reset/confirm', body: input, signal: opts?.signal })
      },

      stepUp(input, opts) {
        return http.json(command('/auth/step-up', opts, input), authResponses.stepUp)
      },

      async startGoogleSignIn(opts) {
        const start = await http.json(
          { method: 'GET', path: '/auth/oauth/google/start', signal: opts?.signal },
          authResponses.startGoogleSignIn,
        )
        assertOauthHost(start.url)
        return start
      },

      exchangeOAuthCode(input, opts) {
        return http.json(
          { method: 'POST', path: '/auth/oauth/exchange', body: input, signal: opts?.signal },
          authResponses.exchangeOAuthCode,
        )
      },
    },

    me: {
      getNextUp(opts) {
        return http.json(authed('/me/next-up', opts), nextUpSchema.nullable())
      },
      getRecentGames(query, opts) {
        return http.json(
          authed('/me/recent-games', opts, { query: pageParams(query), legacyPage: pageHint(query) }),
          meResponses.getRecentGames,
        )
      },
      getPeople(opts) {
        return http.json(authed('/me/people', opts), meResponses.getPeople)
      },
      getMyEvents(query, opts) {
        return http.json(
          authed('/me/registrations', opts, {
            query: { scope: query.scope, ...pageParams(query) },
            legacyPage: pageHint(query),
          }),
          meResponses.getMyEvents,
        )
      },
      changePassword(input: ChangePasswordInput, opts) {
        return http.empty(command('/me/password', opts, input, undefined, 'PATCH'))
      },
    },

    registration: {
      getRegistrationState(slug, opts) {
        return http.json(authed(`/events/${seg(slug)}/registration`, opts), registrationResponses.getRegistrationState)
      },
      reserve(input, key, opts) {
        return http.json(command('/registrations', opts, input, key), registrationResponses.reserve)
      },
      joinWaitlist(input, key, opts) {
        return http.json(command('/registrations/waitlist', opts, input, key), registrationResponses.joinWaitlist)
      },
      createPaymentOrder(input, key, opts) {
        return http.json(command('/payments/orders', opts, input, key), registrationResponses.createPaymentOrder)
      },
      verifyPayment(input, key, opts) {
        return http.json(command('/payments/verify', opts, input, key), registrationResponses.verifyPayment)
      },
      getRegistration(registrationId, opts) {
        return http.json(authed(`/registrations/${seg(registrationId)}`, opts), registrationResponses.getRegistration)
      },
      cancelRegistration(registrationId, opts) {
        return http.json(
          command(`/registrations/${seg(registrationId)}/cancel`, opts, undefined, optionalKey(opts)),
          registrationResponses.cancelRegistration,
        )
      },
      acceptWaitlistOffer(registrationId, key, opts) {
        return http.json(
          command(`/registrations/${seg(registrationId)}/accept-offer`, opts, undefined, key),
          registrationResponses.acceptWaitlistOffer,
        )
      },
    },

    eventRoom: {
      getSnapshot(eventId, opts) {
        return http.json(authed(`/me/events/${seg(eventId)}/room`, opts), eventRoomResponses.getSnapshot)
      },
      checkIn(eventId, opts) {
        return http.json(
          command(`/me/events/${seg(eventId)}/check-in`, opts, undefined, optionalKey(opts)),
          eventRoomResponses.checkIn,
        )
      },
      submitResult(eventId, input, key, opts) {
        return http.json(
          command(`/me/events/${seg(eventId)}/results`, opts, input, key),
          eventRoomResponses.submitResult,
        )
      },
      confirmResult(eventId, pairingId, opts) {
        return http.json(
          command(`/me/events/${seg(eventId)}/results/${seg(pairingId)}/confirm`, opts, undefined, optionalKey(opts)),
          eventRoomResponses.confirmResult,
        )
      },
      disputeResult(eventId, pairingId, input, opts) {
        return http.json(
          command(`/me/events/${seg(eventId)}/results/${seg(pairingId)}/dispute`, opts, input, optionalKey(opts)),
          eventRoomResponses.disputeResult,
        )
      },
    },

    rating: {
      getRatings(opts) {
        return http.json(authed('/me/ratings', opts), ratingResponses.getRatings)
      },
      getLedger(pool, query, opts) {
        return http.json(
          authed(`/me/ratings/${seg(pool)}/ledger`, opts, { query: pageParams(query), legacyPage: pageHint(query) }),
          ratingResponses.getLedger,
        )
      },
      getTrend(pool, query, opts) {
        return http.json(
          authed(`/me/ratings/${seg(pool)}/trend`, opts, { query: { days: query?.days } }),
          ratingResponses.getTrend,
        )
      },
    },

    profile: {
      getProfile(opts) {
        return http.json(authed('/me/profile', opts), profileResponses.getProfile)
      },
      updateProfile(input, opts) {
        return http.json(command('/me/profile', opts, input, undefined, 'PATCH'), profileResponses.updateProfile)
      },
      updatePublicIdentity(input, opts) {
        return http.json(
          command('/me/public-identity', opts, input, undefined, 'PATCH'),
          profileResponses.updatePublicIdentity,
        )
      },
      savePreferences(input, opts) {
        return http.json(command('/me/preferences', opts, input, undefined, 'PATCH'), profileResponses.savePreferences)
      },
    },
  }
}
