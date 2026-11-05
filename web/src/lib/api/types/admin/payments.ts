import { z } from 'zod'
import { capabilityFlagSchema } from '@/lib/api/types/admin/common'
import {
  paymentOrderStateSchema,
  razorpayOrderIdSchema,
  razorpayPaymentIdSchema,
  refundStateSchema,
} from '@/lib/api/types/payment'
import {
  countSchema,
  currencySchema,
  isoDateSchema,
  isoInstantSchema,
  paiseSchema,
  plainText,
  slugSchema,
  uuidSchema,
  versionSchema,
} from '@/lib/api/types/primitives'

// Admin payments (contract C13, G04 to G06; screens 50 and 55; PAYMENTS.md; STATE-MACHINES "Payment order").
// The ledger is read-only. State changes only through refund (G05) and reconcile (G06); there is no free-form status
// patch (DEC-B04). Mismatches are SHOWN, never silently fixed. Refund needs a step-up token (contract 2.4) and an
// Idempotency-Key. Money is integer paise; the browser sends only an optional paise amount and a reason, never a currency.

/** Why the provider and PG state disagree (PAYMENT_MISMATCH details). */
export const MISMATCH_KINDS = [
  'amount',
  'currency',
  'status',
  'order_id',
  'missing_at_provider',
  'missing_at_pg',
] as const
export const mismatchKindSchema = z.enum(MISMATCH_KINDS)
export type MismatchKind = z.infer<typeof mismatchKindSchema>

/** Mismatch flag as a union: a clean row has no kind, a mismatched row always names it. */
export const mismatchSchema = z.discriminatedUnion('mismatch', [
  z.object({ mismatch: z.literal(false) }),
  z.object({
    mismatch: z.literal(true),
    kind: mismatchKindSchema,
    detail: plainText(300),
    detectedAt: isoInstantSchema,
  }),
])
export type MismatchDto = z.infer<typeof mismatchSchema>

const ledgerBase = {
  id: uuidSchema,
  registrationId: uuidSchema,
  playerName: plainText(80),
  amountPaise: paiseSchema,
  currency: currencySchema,
  state: paymentOrderStateSchema,
  refundState: refundStateSchema,
  /** Provider ids are visible to admins only (never on a player DTO). */
  providerOrderId: razorpayOrderIdSchema,
  providerPaymentId: razorpayPaymentIdSchema.nullable(),
  refundedPaise: paiseSchema,
  updatedAt: isoInstantSchema,
  capabilities: z.object({ canRefund: capabilityFlagSchema }),
  version: versionSchema,
  /** FEAT-002: 'cash' for cash-registered payments; absent on older servers (treat as razorpay). */
  paymentMethod: z.enum(['razorpay', 'cash']).optional(),
  /** FEAT-002: display name of the admin who cash-registered; null/absent for Razorpay payments. */
  actorName: z.string().max(80).nullable().optional(),
}

/** `GET /admin/events/{id}/payments` row (C13): the event is implied by the route. */
export const adminPaymentRowSchema = z.object({ ...ledgerBase, mismatch: mismatchSchema })
export type AdminPaymentRowDto = z.infer<typeof adminPaymentRowSchema>

/** `GET /admin/payments` row (G04): adds the event. */
export const adminLedgerRowSchema = z.object({
  ...ledgerBase,
  eventId: uuidSchema,
  eventSlug: slugSchema,
  eventTitle: plainText(120),
  mismatch: mismatchSchema,
})
export type AdminLedgerRowDto = z.infer<typeof adminLedgerRowSchema>

/** `GET /admin/events/{id}/payments` and `GET /admin/payments` queries. */
export const eventPaymentsQuerySchema = z.strictObject({
  status: paymentOrderStateSchema.optional(),
  mismatch: z.boolean().optional(),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).max(100).optional(),
})
export type EventPaymentsQuery = z.infer<typeof eventPaymentsQuerySchema>

export const ledgerQuerySchema = eventPaymentsQuerySchema.extend({
  eventId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>

/**
 * `POST /admin/payments/{id}/refund` (G05). IK + step-up. Full refund by default; `amountPaise` is a partial refund in
 * paise and may not be 0. Strict: no currency, no registration state, no provider id.
 */
export const refundRequestSchema = z.strictObject({
  amountPaise: paiseSchema.min(1).optional(),
  reason: z.string().trim().min(1).max(500),
})
export type RefundRequest = z.infer<typeof refundRequestSchema>

/** G05 response. Refund stays `pending` until the provider event confirms; payment and registration change together. */
export const refundResultSchema = z.object({
  paymentId: uuidSchema,
  refundState: z.enum(['pending', 'refunded']),
  refundedPaise: paiseSchema,
  currency: currencySchema,
  requestedAt: isoInstantSchema,
})
export type RefundResult = z.infer<typeof refundResultSchema>

/** `POST /admin/payments/reconcile` (G06). Optional event scope. */
export const reconcileRequestSchema = z.strictObject({ eventId: uuidSchema.optional() })
export type ReconcileRequest = z.infer<typeof reconcileRequestSchema>

/** G06 response: counts only. Mismatches are listed through the ledger filter, never auto-fixed. */
export const reconcileResultSchema = z.object({
  checked: countSchema,
  mismatches: countSchema,
  newMismatches: countSchema,
  ranAt: isoInstantSchema,
})
export type ReconcileResult = z.infer<typeof reconcileResultSchema>
