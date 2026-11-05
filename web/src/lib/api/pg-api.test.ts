import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { PgAdminApi } from '@/lib/api/pg-admin-api'
import type { PgApi, PgPublicApi } from '@/lib/api/pg-api'
import type { StepUpOpts } from '@/lib/api/pg-admin-api'
import type { StepUpToken } from '@/lib/api/types/admin/common'
import type { SecretLikeSettingsKeys, SettingsHasNoSecrets } from '@/lib/api/types/admin/settings'
import type { IdempotencyKey } from '@/lib/api/types/primitives'
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
  authResponses,
  eventRoomResponses,
  meResponses,
  profileResponses,
  publicResponses,
  ratingResponses,
  registrationResponses,
} from '@/lib/api/types/response-schemas'
import type { Slug } from '@/lib/api/types/primitives'

// Type-level conformance: every PgApi method resolves to exactly `z.infer` of the schema registered for it in
// response-schemas.ts. If an interface return type or a schema changes alone, `npm run typecheck` fails here.
// The runtime assertions only check that the schema registry has an entry for every method (no method left unvalidated).

type Resolved<F> = F extends (...args: never[]) => Promise<infer R> ? R : never
type Infer<S> = S extends z.ZodType ? z.infer<S> : never

type Public = PgApi['public']
type Player = PgApi['player']

describe('PgApi return types match the response schemas (type level)', () => {
  it('public reads', () => {
    expectTypeOf<Resolved<Public['getUpcomingEvents']>>().toEqualTypeOf<
      Infer<typeof publicResponses.getUpcomingEvents>
    >()
    expectTypeOf<Resolved<Public['getEventBySlug']>>().toEqualTypeOf<Infer<
      typeof publicResponses.getEventBySlug
    > | null>()
    expectTypeOf<Resolved<Public['getEventAvailability']>>().toEqualTypeOf<
      Infer<typeof publicResponses.getEventAvailability>
    >()
    expectTypeOf<Resolved<Public['getPastEvents']>>().toEqualTypeOf<Infer<typeof publicResponses.getPastEvents>>()
    expectTypeOf<Resolved<Public['getStories']>>().toEqualTypeOf<Infer<typeof publicResponses.getStories>>()
    expectTypeOf<Resolved<Public['getStoryBySlug']>>().toEqualTypeOf<Infer<
      typeof publicResponses.getStoryBySlug
    > | null>()
    expectTypeOf<Resolved<Public['getTestimonials']>>().toEqualTypeOf<Infer<typeof publicResponses.getTestimonials>>()
    expectTypeOf<Resolved<Public['getLegalPage']>>().toEqualTypeOf<Infer<typeof publicResponses.getLegalPage>>()
    expectTypeOf<Resolved<Public['getSitemapEntries']>>().toEqualTypeOf<
      Infer<typeof publicResponses.getSitemapEntries>
    >()
    expectTypeOf<Resolved<Public['getPublicSettings']>>().toEqualTypeOf<
      Infer<typeof publicResponses.getPublicSettings>
    >()
    expectTypeOf<Resolved<Public['submitContact']>>().toEqualTypeOf<void>()
  })

  it('site content resolves per section key', () => {
    // Type-level only: the stub is never called.
    const call = (api: PgPublicApi) => api.getSiteContent('nav')
    type Section = Infer<typeof publicResponses.getSiteContent>
    expectTypeOf(call).returns.toEqualTypeOf<Promise<Extract<Section, { key: 'nav' }>>>()
    expectTypeOf<Awaited<ReturnType<typeof call>>['content']>().toHaveProperty('primary')
  })

  it('auth', () => {
    expectTypeOf<Resolved<Player['auth']['login']>>().toEqualTypeOf<Infer<typeof authResponses.login>>()
    expectTypeOf<Resolved<Player['auth']['register']>>().toEqualTypeOf<Infer<typeof authResponses.register>>()
    expectTypeOf<Resolved<Player['auth']['refresh']>>().toEqualTypeOf<Infer<typeof authResponses.refresh>>()
    expectTypeOf<Resolved<Player['auth']['getMe']>>().toEqualTypeOf<Infer<typeof authResponses.getMe>>()
    expectTypeOf<Resolved<Player['auth']['stepUp']>>().toEqualTypeOf<Infer<typeof authResponses.stepUp>>()
    expectTypeOf<Resolved<Player['auth']['startGoogleSignIn']>>().toEqualTypeOf<
      Infer<typeof authResponses.startGoogleSignIn>
    >()
    expectTypeOf<Resolved<Player['auth']['exchangeOAuthCode']>>().toEqualTypeOf<
      Infer<typeof authResponses.exchangeOAuthCode>
    >()
    expectTypeOf<Resolved<Player['auth']['logout']>>().toEqualTypeOf<void>()
    expectTypeOf<Resolved<Player['auth']['requestPasswordReset']>>().toEqualTypeOf<void>()
    expectTypeOf<Resolved<Player['auth']['confirmPasswordReset']>>().toEqualTypeOf<void>()
  })

  it('me', () => {
    expectTypeOf<Resolved<Player['me']['getNextUp']>>().toEqualTypeOf<Infer<typeof meResponses.getNextUp> | null>()
    expectTypeOf<Resolved<Player['me']['getRecentGames']>>().toEqualTypeOf<Infer<typeof meResponses.getRecentGames>>()
    expectTypeOf<Resolved<Player['me']['getPeople']>>().toEqualTypeOf<Infer<typeof meResponses.getPeople>>()
    expectTypeOf<Resolved<Player['me']['getMyEvents']>>().toEqualTypeOf<Infer<typeof meResponses.getMyEvents>>()
  })

  it('registration and payments', () => {
    expectTypeOf<Resolved<Player['registration']['getRegistrationState']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.getRegistrationState>
    >()
    expectTypeOf<Resolved<Player['registration']['reserve']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.reserve>
    >()
    expectTypeOf<Resolved<Player['registration']['joinWaitlist']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.joinWaitlist>
    >()
    expectTypeOf<Resolved<Player['registration']['createPaymentOrder']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.createPaymentOrder>
    >()
    expectTypeOf<Resolved<Player['registration']['verifyPayment']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.verifyPayment>
    >()
    expectTypeOf<Resolved<Player['registration']['getRegistration']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.getRegistration>
    >()
    expectTypeOf<Resolved<Player['registration']['cancelRegistration']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.cancelRegistration>
    >()
    expectTypeOf<Resolved<Player['registration']['acceptWaitlistOffer']>>().toEqualTypeOf<
      Infer<typeof registrationResponses.acceptWaitlistOffer>
    >()
  })

  it('event room', () => {
    expectTypeOf<Resolved<Player['eventRoom']['getSnapshot']>>().toEqualTypeOf<
      Infer<typeof eventRoomResponses.getSnapshot>
    >()
    expectTypeOf<Resolved<Player['eventRoom']['checkIn']>>().toEqualTypeOf<Infer<typeof eventRoomResponses.checkIn>>()
    expectTypeOf<Resolved<Player['eventRoom']['submitResult']>>().toEqualTypeOf<
      Infer<typeof eventRoomResponses.submitResult>
    >()
    expectTypeOf<Resolved<Player['eventRoom']['confirmResult']>>().toEqualTypeOf<
      Infer<typeof eventRoomResponses.confirmResult>
    >()
    expectTypeOf<Resolved<Player['eventRoom']['disputeResult']>>().toEqualTypeOf<
      Infer<typeof eventRoomResponses.disputeResult>
    >()
  })

  it('ratings and profile', () => {
    expectTypeOf<Resolved<Player['rating']['getRatings']>>().toEqualTypeOf<Infer<typeof ratingResponses.getRatings>>()
    expectTypeOf<Resolved<Player['rating']['getLedger']>>().toEqualTypeOf<Infer<typeof ratingResponses.getLedger>>()
    expectTypeOf<Resolved<Player['rating']['getTrend']>>().toEqualTypeOf<Infer<typeof ratingResponses.getTrend>>()
    expectTypeOf<Resolved<Player['profile']['getProfile']>>().toEqualTypeOf<Infer<typeof profileResponses.getProfile>>()
    expectTypeOf<Resolved<Player['profile']['updateProfile']>>().toEqualTypeOf<
      Infer<typeof profileResponses.updateProfile>
    >()
    expectTypeOf<Resolved<Player['profile']['updatePublicIdentity']>>().toEqualTypeOf<
      Infer<typeof profileResponses.updatePublicIdentity>
    >()
    expectTypeOf<Resolved<Player['profile']['savePreferences']>>().toEqualTypeOf<
      Infer<typeof profileResponses.savePreferences>
    >()
  })

  it('slug reads take the branded Slug, not a raw string', () => {
    expectTypeOf<Parameters<Public['getEventBySlug']>[0]>().toEqualTypeOf<Slug>()
    expectTypeOf<string>().not.toMatchTypeOf<Slug>()
  })

  it('exposes the admin sub-interface', () => {
    expectTypeOf<PgApi['admin']>().toEqualTypeOf<PgAdminApi>()
  })
})

// ---------- Admin (TASK-017) ----------
// For each group: every method that returns a payload resolves to exactly `z.infer` of its registered schema.
// `Matches<Group, Registry>` is `true` only when, for every key of the registry, the method's resolved type equals the
// schema's inferred type. A key missing from either side, or a drifted type, makes the assertion fail to compile.

type Admin = PgApi['admin']

type Matches<Group, Registry> = {
  [K in keyof Registry]: K extends keyof Group
    ? Group[K] extends (...args: never[]) => Promise<infer R>
      ? [R] extends [Infer<Registry[K]>]
        ? [Infer<Registry[K]>] extends [R]
          ? true
          : `drifted: ${K & string}`
        : `drifted: ${K & string}`
      : `not async: ${K & string}`
    : `missing method: ${K & string}`
}[keyof Registry]

/** Methods of a group that have NO registry entry must be void/Blob on purpose. */
type Unregistered<Group, Registry> = Exclude<keyof Group, keyof Registry>

describe('PgAdminApi return types match the response schemas (type level)', () => {
  it('every registered admin method resolves to its schema type', () => {
    expectTypeOf<Matches<Admin['dashboard'], typeof adminDashboardResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['events'], typeof adminEventsResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['control'], typeof adminControlResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['cms'], typeof adminCmsResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['media'], typeof adminMediaResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['stories'], typeof adminStoriesResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['testimonials'], typeof adminTestimonialsResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['preview'], typeof adminPreviewResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['players'], typeof adminPlayersResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['payments'], typeof adminPaymentsResponses>>().toEqualTypeOf<true>()
    expectTypeOf<Matches<Admin['settings'], typeof adminSettingsResponses>>().toEqualTypeOf<true>()
  })

  it('only the void and Blob methods are left out of the registry', () => {
    expectTypeOf<Unregistered<Admin['media'], typeof adminMediaResponses>>().toEqualTypeOf<'deleteAsset'>()
    expectTypeOf<Unregistered<Admin['control'], typeof adminControlResponses>>().toEqualTypeOf<'exportAudit'>()
    expectTypeOf<Unregistered<Admin['events'], typeof adminEventsResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Unregistered<Admin['cms'], typeof adminCmsResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Unregistered<Admin['stories'], typeof adminStoriesResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Unregistered<Admin['testimonials'], typeof adminTestimonialsResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Unregistered<Admin['players'], typeof adminPlayersResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Unregistered<Admin['payments'], typeof adminPaymentsResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Unregistered<Admin['settings'], typeof adminSettingsResponses>>().toEqualTypeOf<never>()
    expectTypeOf<Resolved<Admin['media']['deleteAsset']>>().toEqualTypeOf<void>()
    expectTypeOf<Resolved<Admin['control']['exportAudit']>>().toEqualTypeOf<Blob>()
  })

  it('sensitive operations require a step-up token and an idempotency key', () => {
    expectTypeOf<Parameters<Admin['payments']['refund']>[2]>().toEqualTypeOf<IdempotencyKey>()
    expectTypeOf<Parameters<Admin['payments']['refund']>[3]>().toEqualTypeOf<StepUpOpts>()
    expectTypeOf<Parameters<Admin['players']['changeRole']>[3]>().toEqualTypeOf<StepUpOpts>()
    expectTypeOf<Parameters<Admin['control']['exportAudit']>[2]>().toEqualTypeOf<StepUpOpts>()
    expectTypeOf<Parameters<Admin['events']['publishEvent']>[1]>().toEqualTypeOf<IdempotencyKey>()
    expectTypeOf<Parameters<Admin['control']['finaliseRound']>[3]>().toEqualTypeOf<IdempotencyKey>()
    expectTypeOf<Parameters<Admin['control']['sendMessage']>[2]>().toEqualTypeOf<IdempotencyKey>()
    // A plain string is not a step-up token.
    expectTypeOf<string>().not.toMatchTypeOf<StepUpToken>()
  })

  it('settings types contain no secret-looking key', () => {
    expectTypeOf<SettingsHasNoSecrets>().toEqualTypeOf<true>()
    expectTypeOf<SecretLikeSettingsKeys>().toEqualTypeOf<never>()
  })
})

function countMethods(registry: Record<string, unknown>): number {
  return Object.keys(registry).length
}

describe('admin schema registry covers every method (runtime)', () => {
  const methodsOf = (keys: Record<string, unknown>) => Object.keys(keys).sort()

  it('has the expected entries per group', () => {
    expect(methodsOf(adminDashboardResponses)).toEqual(['getDashboard'])
    expect(methodsOf(adminPreviewResponses)).toEqual(['createPreviewLink'])
    expect(methodsOf(adminEventsResponses)).toEqual(
      [
        'cancelEvent',
        'checkSlug',
        'closeRegistrations',
        'completeEvent',
        'createDraft',
        'deleteEvent',
        'getEvent',
        'getEventTypes',
        'listEvents',
        'openRegistrations',
        'publishEvent',
        'unpublishEvent',
        'updateEvent',
      ].sort(),
    )
    expect(methodsOf(adminPaymentsResponses)).toEqual(['listLedger', 'reconcile', 'refund'])
    expect(methodsOf(adminPlayersResponses)).toEqual(['changeRole', 'getPlayer', 'listPlayers'])
    expect(methodsOf(adminSettingsResponses)).toEqual(['getSettings', 'updateSettings'])
  })

  it('counts the registered payload methods (plus deleteAsset and exportAudit without payload = 72 methods)', () => {
    const registered =
      countMethods(adminDashboardResponses) +
      countMethods(adminEventsResponses) +
      countMethods(adminControlResponses) +
      countMethods(adminCmsResponses) +
      countMethods(adminMediaResponses) +
      countMethods(adminStoriesResponses) +
      countMethods(adminTestimonialsResponses) +
      countMethods(adminPreviewResponses) +
      countMethods(adminPlayersResponses) +
      countMethods(adminPaymentsResponses) +
      countMethods(adminSettingsResponses)
    expect(registered + 2).toBe(72)
  })
})

describe('schema registry covers every method (runtime)', () => {
  const methodsOf = (keys: Record<string, unknown>) => Object.keys(keys).sort()

  it('has an entry per public and player method that returns a payload', () => {
    expect(methodsOf(publicResponses)).toEqual(
      [
        'getEventAvailability',
        'getEventBySlug',
        'getLegalPage',
        'getPastEvents',
        'getPlayerProfile',
        'getPublicSettings',
        'getSiteContent',
        'getSitemapEntries',
        'getStories',
        'getStoryBySlug',
        'getTestimonials',
        'getUpcomingEvents',
      ].sort(),
    )
    expect(methodsOf(authResponses)).toEqual(
      ['exchangeOAuthCode', 'getMe', 'login', 'refresh', 'register', 'startGoogleSignIn', 'stepUp'].sort(),
    )
    expect(methodsOf(eventRoomResponses)).toEqual([
      'checkIn',
      'confirmResult',
      'disputeResult',
      'getSnapshot',
      'submitResult',
    ])
  })
})
