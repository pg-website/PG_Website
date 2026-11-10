import { ApiError } from '@/lib/api/errors'
import type { PgMeApi, PgRegistrationApi } from '@/lib/api/pg-api'
import type { MyRegistrationDto } from '@/lib/api/types/my-events'
import type { PaymentOrderDto } from '@/lib/api/types/payment'
import type { RegistrationDto, RegistrationStateDto } from '@/lib/api/types/registration'
import { isProfileComplete } from '@/lib/mock/auth/accounts'
import { fieldFailure } from '@/lib/mock/auth/errors'
import { MOCK_NOW } from '@/lib/mock/seeds/clock'
import { notFound, toIso, type PlayerContext, type PlayerRunner } from '@/lib/mock/player/context'
import { ACTIVE, ref, registrationsOf, type Bearer } from '@/lib/mock/player/regs'
import { effectiveRoom } from '@/lib/mock/player/room'
import { isResolverVariant } from '@/lib/mock/scenario'
import { paginate } from '@/lib/mock/paginate'
import { eventRefById, ROOM_EVENT_SLUG, type MockEventRef } from '@/lib/mock/seeds/player-events'
import { MOCK_GAMES } from '@/lib/mock/seeds/player-ratings'
import { MOCK_PEOPLE } from '@/lib/mock/seeds/player-people'
import { HOLD_MINUTES, paidSummary } from '@/lib/mock/seeds/player-registrations'
import { MOCK_PAIRING } from '@/lib/mock/seeds/player-room'

// player.me and player.registration over the frozen seeds plus the session changes (TASK-019). Pure functions of
// (seeds, player state, clock); every change goes through `runner.write`.

const CANCEL_CUTOFF_MS = 24 * 3_600_000
const MOCK_NOW_MS = Date.parse(MOCK_NOW)
const MOCK_KEY_ID = 'rzp_test_mockkey0001'

const orderIdFor = (registrationId: string) => `order_${registrationId.replaceAll('-', '').slice(-16)}`

function save(ctx: PlayerContext, registration: RegistrationDto): void {
  const rest = ctx.state.regs.filter((entry) => entry.registration.id !== registration.id)
  ctx.state.regs = [...rest, { accountId: ctx.account.id, registration }]
}

function nextId(ctx: PlayerContext): string {
  ctx.state.seq += 1
  return `f5e1d000-0000-4000-8000-0000000002${String(ctx.state.seq).padStart(2, '0')}`
}

function findOwn(ctx: PlayerContext, id: string): RegistrationDto {
  const found = registrationsOf(ctx).find((reg) => reg.id === id)
  if (found === undefined) throw notFound()
  return found
}

function isOver(event: MockEventRef): boolean {
  return event.status === 'completed' || event.status === 'cancelled'
}

function cancelPolicy(reg: RegistrationDto, event: MockEventRef): { ok: boolean; reason: string | null } {
  if (!ACTIVE.has(reg.status) || isOver(event)) return { ok: false, reason: null }
  if (Date.parse(event.startsAt) - MOCK_NOW_MS < CANCEL_CUTOFF_MS) {
    return { ok: false, reason: 'Cancellation closes 24 hours before the start.' }
  }
  return { ok: true, reason: null }
}

// ---------- R01 state resolver ----------

function resolve(ctx: PlayerContext, event: MockEventRef): RegistrationStateDto {
  const incomplete = !isProfileComplete(ctx.account.profile)
  const common = {
    requiredProfileFields: incomplete ? (['city', 'phone'] as ('city' | 'phone')[]) : [],
    serverNow: toIso(ctx.nowMs),
  }
  const priced = { pricePaise: event.pricePaise, currency: 'INR' as const }
  const forced = ctx.state.scenario.reg
  if (isResolverVariant(forced)) {
    switch (forced) {
      case 'open_free':
        return { state: 'open_free', ...common, pricePaise: 0, currency: 'INR' }
      case 'open_paid':
        return {
          state: 'open_paid',
          ...common,
          pricePaise: Math.max(event.pricePaise, 20000),
          currency: 'INR',
          holdMinutes: HOLD_MINUTES,
        }
      case 'full_waitlist':
        return { state: 'full_waitlist', ...common, ...priced, waitlistPosition: 4 }
      case 'sold_out':
      case 'closed':
        return { state: forced, ...common, ...priced }
      case 'not_yet_open':
        return { state: 'not_yet_open', ...common, ...priced, opensAt: toIso(MOCK_NOW_MS + 3 * 86_400_000) }
      case 'ineligible':
        return { state: 'ineligible', ...common, ...priced, reason: 'profile_incomplete' }
      case 'already_registered': {
        const reg = registrationsOf(ctx).find((item) => item.eventSlug === event.slug && ACTIVE.has(item.status))
        if (reg !== undefined) return { state: 'already_registered', ...common, ...priced, registration: reg }
        break
      }
    }
  }
  const existing = registrationsOf(ctx).find((item) => item.eventSlug === event.slug && ACTIVE.has(item.status))
  if (existing !== undefined) return { state: 'already_registered', ...common, ...priced, registration: existing }
  if (isOver(event) || (event.window.closesAt !== null && Date.parse(event.window.closesAt) < MOCK_NOW_MS)) {
    return { state: 'closed', ...common, ...priced }
  }
  if (event.window.opensAt !== null && Date.parse(event.window.opensAt) > MOCK_NOW_MS) {
    return { state: 'not_yet_open', ...common, ...priced, opensAt: event.window.opensAt }
  }
  if (incomplete) return { state: 'ineligible', ...common, ...priced, reason: 'profile_incomplete' }
  if (event.status === 'sold_out') {
    return event.window.waitlistEnabled
      ? { state: 'full_waitlist', ...common, ...priced, waitlistPosition: 4 }
      : { state: 'sold_out', ...common, ...priced }
  }
  if (event.pricePaise === 0) return { state: 'open_free', ...common, pricePaise: 0, currency: 'INR' }
  return { state: 'open_paid', ...common, ...priced, pricePaise: event.pricePaise, holdMinutes: HOLD_MINUTES }
}

/** Natural resolver state for a write (a forced `reg:<resolver>` scenario only changes what R01 reads). */
function naturalState(ctx: PlayerContext, event: MockEventRef): RegistrationStateDto {
  const saved = ctx.state.scenario
  ctx.state.scenario = { ...saved, reg: undefined }
  try {
    return resolve(ctx, event)
  } finally {
    ctx.state.scenario = saved
  }
}

function refuse(state: RegistrationStateDto): ApiError {
  switch (state.state) {
    case 'full_waitlist':
    case 'sold_out':
      return new ApiError('EVENT_FULL', { status: 409 })
    case 'closed':
      return new ApiError('REGISTRATION_CLOSED', { status: 409 })
    case 'not_yet_open':
      return new ApiError('REGISTRATION_NOT_OPEN', { status: 409 })
    case 'already_registered':
      return new ApiError('ALREADY_REGISTERED', { status: 409 })
    default:
      return fieldFailure('VALIDATION_FAILED', 400, { profile: ['Complete your profile to register.'] })
  }
}

// ---------- groups ----------

export function createMeGroup(runner: PlayerRunner, bearer: Bearer): PgMeApi {
  return {
    getNextUp: (opts) =>
      bearer(opts, (token) =>
        runner.read(token, (ctx) => {
          if (ctx.state.scenario.next === 'none') return null
          const rows = registrationsOf(ctx)
            .map((registration) => ({ registration, event: eventRefById(registration.eventId) }))
            .filter(
              (row): row is { registration: RegistrationDto; event: MockEventRef } =>
                row.event !== undefined &&
                row.registration.status === 'confirmed' &&
                !isOver(row.event) &&
                Date.parse(row.event.startsAt) >= MOCK_NOW_MS,
            )
            .toSorted((a, b) => a.event.startsAt.localeCompare(b.event.startsAt))
          const first = rows[0]
          if (first === undefined) return null
          const room = effectiveRoom(ctx, first.event)
          const live = room.variant === 'live_round' || room.variant === 'awaiting_confirmation'
          return {
            registrationId: first.registration.id,
            event: eventLink(first.event),
            venue: first.event.venue,
            nextAction: room.nextAction,
            pairing:
              live && first.event.slug === ROOM_EVENT_SLUG
                ? {
                    round: MOCK_PAIRING.round,
                    board: MOCK_PAIRING.board,
                    colour: MOCK_PAIRING.colour,
                    opponent: MOCK_PAIRING.opponent,
                  }
                : null,
          }
        }),
      ),
    getRecentGames: (query, opts) =>
      bearer(opts, (token) => runner.read(token, (ctx) => paginate(ctx.isDemo ? MOCK_GAMES : [], query))),
    getPeople: (opts) => bearer(opts, (token) => runner.read(token, (ctx) => (ctx.isDemo ? [...MOCK_PEOPLE] : []))),
    getMyEvents: (query, opts) =>
      bearer(opts, (token) =>
        runner.read(token, (ctx) => {
          const rows: MyRegistrationDto[] = []
          for (const registration of registrationsOf(ctx)) {
            const event = eventRefById(registration.eventId)
            if (event === undefined) continue
            const upcoming = ACTIVE.has(registration.status) && !isOver(event)
            if ((query.scope === 'upcoming') !== upcoming) continue
            const policy = cancelPolicy(registration, event)
            rows.push({
              registration,
              event: eventLink(event),
              canCancel: policy.ok,
              cancelBlockedReason: policy.reason,
              canOpenRoom: registration.status === 'confirmed' && event.status !== 'cancelled',
            })
          }
          const key = (row: MyRegistrationDto) => row.event.startsAt
          rows.sort((a, b) =>
            query.scope === 'upcoming' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)),
          )
          return paginate(rows, query)
        }),
      ),
    // PLAN-012: mock stubs out changePassword — the gate never shows in mock mode.
    changePassword: () => Promise.resolve(),
  }
}

export function createRegistrationGroup(runner: PlayerRunner, bearer: Bearer): PgRegistrationApi {
  return {
    getRegistrationState: (slug, opts) => bearer(opts, (token) => runner.read(token, (ctx) => resolve(ctx, ref(slug)))),

    reserve: (input, _key, opts) =>
      bearer(opts, (token) =>
        runner.write(token, (ctx) => {
          const event = ref(input.eventSlug)
          const state = naturalState(ctx, event)
          if (state.state !== 'open_free' && state.state !== 'open_paid') throw refuse(state)
          const base = { id: nextId(ctx), eventId: event.id, eventSlug: event.slug, createdAt: toIso(ctx.nowMs) }
          if (state.state === 'open_free') {
            const registration = { ...base, status: 'confirmed' as const, payment: null }
            save(ctx, registration)
            return { status: 'confirmed' as const, registration }
          }
          const holdExpiresAt = toIso(ctx.nowMs + HOLD_MINUTES * 60_000)
          const serverNow = toIso(ctx.nowMs)
          const registration = {
            ...base,
            status: 'pending' as const,
            holdExpiresAt,
            serverNow,
            payment: null,
          }
          save(ctx, registration)
          return { status: 'pending' as const, registration, holdExpiresAt, serverNow }
        }),
      ),

    joinWaitlist: (input, _key, opts) =>
      bearer(opts, (token) =>
        runner.write(token, (ctx) => {
          const event = ref(input.eventSlug)
          const state = naturalState(ctx, event)
          if (state.state !== 'full_waitlist') throw refuse(state)
          const registration = {
            id: nextId(ctx),
            eventId: event.id,
            eventSlug: event.slug,
            createdAt: toIso(ctx.nowMs),
            status: 'waitlist' as const,
            position: state.waitlistPosition,
            offer: null,
          }
          save(ctx, registration)
          return { registration, position: state.waitlistPosition }
        }),
      ),

    createPaymentOrder: (input, _key, opts) =>
      bearer(opts, (token) =>
        runner.write(token, (ctx) => {
          const reg = findOwn(ctx, input.registrationId)
          if (reg.status !== 'pending') {
            throw new ApiError(reg.status === 'confirmed' ? 'ALREADY_REGISTERED' : 'HOLD_EXPIRED', { status: 409 })
          }
          const event = eventRefById(reg.eventId)
          const order: PaymentOrderDto = {
            orderId: orderIdFor(reg.id),
            amountPaise: Math.max(event?.pricePaise ?? 0, 100),
            currency: 'INR',
            keyId: MOCK_KEY_ID,
            holdExpiresAt: reg.holdExpiresAt,
            serverNow: toIso(ctx.nowMs),
          }
          save(ctx, {
            ...reg,
            payment: { orderState: 'created', refundState: 'none', amountPaise: order.amountPaise, currency: 'INR' },
          })
          return order
        }),
      ),

    verifyPayment: (input, _key, opts) =>
      bearer(opts, (token) =>
        runner.write(token, (ctx) => {
          const reg = registrationsOf(ctx).find(
            (item) => item.status === 'pending' && orderIdFor(item.id) === input.razorpay_order_id,
          )
          if (reg === undefined) throw new ApiError('PAYMENT_MISMATCH', { status: 409 })
          const event = eventRefById(reg.eventId)
          const registration = {
            id: reg.id,
            eventId: reg.eventId,
            eventSlug: reg.eventSlug,
            createdAt: reg.createdAt,
            status: 'confirmed' as const,
            payment: paidSummary(Math.max(event?.pricePaise ?? 0, 100)),
          }
          save(ctx, registration)
          return { registration }
        }),
      ),

    getRegistration: (id, opts) => bearer(opts, (token) => runner.read(token, (ctx) => findOwn(ctx, id))),

    cancelRegistration: (id, opts) =>
      bearer(opts, (token) =>
        runner.write(token, (ctx) => {
          const reg = findOwn(ctx, id)
          const event = eventRefById(reg.eventId)
          if (event === undefined || !cancelPolicy(reg, event).ok) {
            throw new ApiError('CANCELLATION_NOT_ALLOWED', { status: 409 })
          }
          const paid = 'payment' in reg && reg.payment !== null && reg.payment.orderState === 'paid'
          const registration = {
            id: reg.id,
            eventId: reg.eventId,
            eventSlug: reg.eventSlug,
            createdAt: reg.createdAt,
            status: 'cancelled' as const,
            cancelledAt: toIso(ctx.nowMs),
            payment: paid
              ? {
                  orderState: 'paid' as const,
                  refundState: 'pending' as const,
                  amountPaise: event.pricePaise,
                  currency: 'INR' as const,
                }
              : null,
          }
          save(ctx, registration)
          return { registration }
        }),
      ),

    acceptWaitlistOffer: (id, _key, opts) =>
      bearer(opts, (token) =>
        runner.write(token, (ctx) => {
          const reg = findOwn(ctx, id)
          if (reg.status !== 'waitlist' || reg.offer === null) throw new ApiError('EVENT_FULL', { status: 409 })
          const event = eventRefById(reg.eventId)
          const base = { id: reg.id, eventId: reg.eventId, eventSlug: reg.eventSlug, createdAt: reg.createdAt }
          const registration: RegistrationDto =
            event === undefined || event.pricePaise === 0
              ? { ...base, status: 'confirmed', payment: null }
              : {
                  ...base,
                  status: 'pending',
                  holdExpiresAt: toIso(ctx.nowMs + HOLD_MINUTES * 60_000),
                  serverNow: toIso(ctx.nowMs),
                  payment: null,
                }
          save(ctx, registration)
          return { registration }
        }),
      ),
  }
}

function eventLink(event: MockEventRef) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    startsAt: event.startsAt,
    area: event.area,
    status: event.status,
    cover: event.cover,
  }
}
