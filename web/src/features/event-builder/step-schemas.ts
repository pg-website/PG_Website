import type { ZodType } from 'zod'
import {
  basicsStepSchema,
  communicationsStepSchema,
  experienceStepSchema,
  gameSystemStepSchema,
  mediaStepSchema,
  paymentStepSchema,
  registrationStepSchema,
  updateBuilderDraftSchema,
} from '@/lib/api/types/admin/event-builder'
import type { StepDataKey } from '@/features/event-builder/types'

// Zod schemas per step, kept apart from the step registry so step components can import them without a cycle.
// FORM schemas validate read-shape values (what the step form edits). PATCH schemas validate the write shape that travels.

// Publish-required rules (mirror backend `readiness`). Drafts may stay blank (the PATCH schemas allow it), but the
// form schema reports these inline on Continue and keeps the step marked incomplete until they are filled.
const REQUIRED = 'This is required.'
const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === ''

const basicsForm = basicsStepSchema.superRefine((v, ctx) => {
  if (blank(v.title)) ctx.addIssue({ code: 'custom', path: ['title'], message: REQUIRED })
  if (v.startsAt === null) ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'Set when the event starts.' })
  if (v.endsAt === null) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Set when the event ends.' })
  else if (v.startsAt !== null && Date.parse(v.endsAt) <= Date.parse(v.startsAt))
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end must be after the start.' })
})

const registrationForm = registrationStepSchema.superRefine((v, ctx) => {
  if (v.opensAt !== null && v.closesAt !== null && Date.parse(v.closesAt) <= Date.parse(v.opensAt))
    ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'Registration must close after it opens.' })
})

const gameSystemForm = gameSystemStepSchema.superRefine((v, ctx) => {
  if (blank(v.timeControl)) ctx.addIssue({ code: 'custom', path: ['timeControl'], message: REQUIRED })
  if ((v.pairingMode === 'swiss' || v.pairingMode === 'round_robin') && v.rounds === null)
    ctx.addIssue({ code: 'custom', path: ['rounds'], message: 'Set the number of rounds.' })
})

export const STEP_FORM_SCHEMAS: Readonly<Record<StepDataKey, ZodType>> = {
  basics: basicsForm,
  experience: experienceStepSchema,
  registration: registrationForm,
  payment: paymentStepSchema,
  gameSystem: gameSystemForm,
  media: mediaStepSchema,
  communications: communicationsStepSchema,
}

/** Partial, strict write schema of one step (E04). Used to keep half-typed invalid values out of the autosave. */
export function patchSchemaFor(key: StepDataKey): ZodType {
  return updateBuilderDraftSchema.shape[key].unwrap() as unknown as ZodType
}
