import { z } from 'zod'
import { capabilityFlagSchema } from '@/lib/api/types/admin/common'
import { eventStatusSchema, pairingModeSchema } from '@/lib/api/types/event-state'
import { roundStateSchema } from '@/lib/api/types/event-room'
import {
  countSchema,
  isoInstantSchema,
  plainText,
  slugSchema,
  uuidSchema,
  versionSchema,
} from '@/lib/api/types/primitives'

// Event Control Room overview (contract C01, screen 46): summary strip, run-of-show checklist, arrival metrics and the
// pairing engine summary. Each tab is its own endpoint; the shell reads `status` and `capabilities` from here.

export const CONTROL_TABS = [
  'overview',
  'registrations',
  'check-in',
  'pairings',
  'payments',
  'messages',
  'gallery',
  'audit',
] as const
export const controlTabSchema = z.enum(CONTROL_TABS)
export type ControlTab = z.infer<typeof controlTabSchema>

/** Run-of-show checklist item. `done` is server state; the UI never infers it. */
export const runOfShowItemSchema = z.object({
  key: z.string().min(1).max(64),
  label: plainText(120),
  dueAt: isoInstantSchema.nullable(),
  done: z.boolean(),
})
export type RunOfShowItem = z.infer<typeof runOfShowItemSchema>

export const pairingSummarySchema = z.object({
  mode: pairingModeSchema,
  roundsPlanned: z.int().min(0).max(20).nullable(),
  currentRound: z.int().min(0).max(100),
  currentRoundState: roundStateSchema.nullable(),
})

export const eventOverviewSchema = z.object({
  eventId: uuidSchema,
  slug: slugSchema.nullable(),
  title: plainText(120),
  status: eventStatusSchema,
  startsAt: isoInstantSchema,
  summary: z.object({
    confirmed: countSchema,
    waitlist: countSchema,
    firstTimers: countSchema,
    checkedIn: countSchema,
    capacity: z.int().min(0).max(100000).nullable(),
  }),
  arrival: z.object({ checkedIn: countSchema, expected: countSchema, welcomedFirstTimers: countSchema }),
  pairing: pairingSummarySchema,
  runOfShow: z.array(runOfShowItemSchema).max(40),
  capabilities: z.object({
    canComplete: capabilityFlagSchema,
    canCancel: capabilityFlagSchema,
    /** Additive (FE-31): lifecycle buttons of the header. Absent from an older server means "not offered". */
    canPublish: capabilityFlagSchema.optional(),
    canUnpublish: capabilityFlagSchema.optional(),
    /** Lifecycle button shown when status is published. Absent from an older server means not offered. */
    canOpenRegistration: capabilityFlagSchema.optional(),
    /** Close registrations immediately. Shown when status is registration_open. */
    canCloseRegistration: capabilityFlagSchema.optional(),
  }),
  serverNow: isoInstantSchema,
  version: versionSchema,
})
export type EventOverviewDto = z.infer<typeof eventOverviewSchema>
