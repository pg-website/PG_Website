import { z } from 'zod'
import { capabilityFlagSchema } from '@/lib/api/types/admin/common'
import { paymentOrderStateSchema } from '@/lib/api/types/payment'
import { emailSchema, isoInstantSchema, plainText, uuidSchema, versionSchema } from '@/lib/api/types/primitives'
import { registrationStatusSchema } from '@/lib/api/types/registration'

// Control room registrations (contract C02, C03, screen 47). This is the ONLY place registration PII (email, phone) is
// returned, and only to admins. Registration and payment state change ONLY through the action endpoint and the refund
// endpoint, never by a free-form status patch (DEC-B04).

export const adminRegistrationsQuerySchema = z.strictObject({
  /** Name, phone or registration id. */
  q: z.string().trim().min(1).max(100).optional(),
  payment: paymentOrderStateSchema.optional(),
  status: registrationStatusSchema.optional(),
  firstTimer: z.boolean().optional(),
  page: z.int().min(1).optional(),
  pageSize: z.int().min(1).max(100).optional(),
})
export type AdminRegistrationsQuery = z.infer<typeof adminRegistrationsQuerySchema>

/** Row actions of C03. `reason` is required where a player is affected (cancel, move to waitlist). */
export const REGISTRATION_ACTIONS = [
  'cancel',
  'move_to_waitlist',
  'promote',
  'mark_welcomed',
  'set_pairing_active',
] as const
export const registrationActionSchema = z.enum(REGISTRATION_ACTIONS)
export type RegistrationAction = z.infer<typeof registrationActionSchema>

export const adminRegistrationCapabilitiesSchema = z.object({
  canCancel: capabilityFlagSchema,
  canMoveToWaitlist: capabilityFlagSchema,
  canPromote: capabilityFlagSchema,
  canMarkWelcomed: capabilityFlagSchema,
  canSetPairingActive: capabilityFlagSchema,
  /** FEAT-002: present on paid events for pending/waitlist/offer rows. Absent on older servers (treat as not allowed). */
  canCashRegister: capabilityFlagSchema.optional(),
})

/**
 * Payment method discriminator added in FEAT-002. `admin_enrolled` added in PLAN-012.
 * Absent on older server responses (treat as razorpay).
 */
const paymentMethodSchema = z.enum(['razorpay', 'cash', 'admin_enrolled'])

export const adminRegistrationSchema = z.object({
  id: uuidSchema,
  playerId: uuidSchema,
  name: plainText(80),
  email: emailSchema,
  phone: z
    .string()
    .regex(/^\+?[0-9 ()-]{7,20}$/)
    .nullable(),
  rating: z.int().min(0).max(4000).nullable(),
  firstTimer: z.boolean(),
  status: registrationStatusSchema,
  /** Null for a free event (no payment). */
  paymentState: paymentOrderStateSchema.nullable(),
  /** FEAT-002: 'cash' when confirmed via cash registration; absent on older servers. */
  paymentMethod: paymentMethodSchema.nullable().optional(),
  /** FEAT-002: display name of the admin who performed the cash registration; null otherwise. */
  actorName: z.string().max(80).nullable().optional(),
  checkedInAt: isoInstantSchema.nullable(),
  welcomed: z.boolean(),
  pairingActive: z.boolean(),
  registeredAt: isoInstantSchema,
  capabilities: adminRegistrationCapabilitiesSchema,
  version: versionSchema,
})
export type AdminRegistrationDto = z.infer<typeof adminRegistrationSchema>

/** `POST .../registrations/{regId}/actions` (C03). Strict: nothing but the action and a reason. */
export const registrationActionInputSchema = z
  .strictObject({ action: registrationActionSchema, reason: z.string().trim().min(1).max(500).optional() })
  .refine((value) => !['cancel', 'move_to_waitlist'].includes(value.action) || value.reason !== undefined, {
    message: 'A reason is required to cancel or move a player to the waitlist',
    path: ['reason'],
  })
export type RegistrationActionInput = z.infer<typeof registrationActionInputSchema>

/** `POST .../registrations/cash` (FEAT-002). The browser converts rupees to paise; the server validates the final value. */
export const cashRegisterInputSchema = z.object({
  playerId: uuidSchema,
  amountPaise: z.number().int().min(1),
})
export type CashRegisterInput = z.infer<typeof cashRegisterInputSchema>

/** `POST .../registrations/enroll` (PLAN-012). Admin-direct enrollment bypassing payment; idempotency key required. */
export const adminEnrollInputSchema = z.strictObject({
  playerId: z.string().uuid(),
})
export type AdminEnrollInput = z.infer<typeof adminEnrollInputSchema>
