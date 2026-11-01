'use client'

import { useId } from 'react'
import { useController } from 'react-hook-form'
import { FormField } from '@/components/ui/form/FormField'
import { ChoiceCard } from '@/components/ui/form/ChoiceCard'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Switch } from '@/components/ui/form/Switch'
import { Textarea } from '@/components/ui/form/Textarea'
import { Heading } from '@/components/ui/Heading'
import { useStepForm } from '@/features/event-builder/context'
import { FaqEditor } from '@/features/event-builder/fields/FaqEditor'
import { HighlightsEditor } from '@/features/event-builder/fields/HighlightsEditor'
import { LogisticsEditor } from '@/features/event-builder/fields/LogisticsEditor'
import { TagsField } from '@/features/event-builder/fields/TagsField'
import { type ExperienceStep as ExperienceValues } from '@/lib/api/types/admin/event-builder'
import type { ExperienceMode } from '@/lib/api/types/admin/event-builder'

// Builder step 2, Experience (EV-09, screen 39). Adds mode choice cards (Hosted social / Competitive),
// "Arrival promise" textarea, and public tags chip input (UI-only, backend gap per PLAN-003 Q3).
// `mode` and `tags` are never sent to the backend (patch.ts filters them out).

interface ModeCardOption {
  value: ExperienceMode
  label: string
  description: string
}

const MODE_OPTIONS: readonly ModeCardOption[] = [
  {
    value: 'social',
    label: 'Hosted social',
    description: 'Introductions, thoughtful matching, easy rematches.',
  },
  {
    value: 'competitive',
    label: 'Competitive',
    description: 'Clear rounds, clocks, standings and results.',
  },
]

export function ExperienceStep() {
  const form = useStepForm<ExperienceValues>('experience')
  const { control } = form
  const groupId = useId()

  const modeController = useController({ control, name: 'mode' })
  const tagsController = useController({ control, name: 'tags' })

  return (
    <form
        noValidate
        onSubmit={(event) => event.preventDefault()}
        className="grid min-w-0 gap-6"
        aria-label="Event experience"
      >
        {/* Mode cards — screen 39 reference: Hosted social / Competitive */}
        <Field label="Event mode" group id={`${groupId}-mode`} hint="Sets the feel and format shown to players.">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {MODE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                type="radio"
                name={`${groupId}-mode`}
                value={option.value}
                label={option.label}
                description={option.description}
                checked={modeController.field.value === option.value}
                onCheckedChange={(checked) => {
                  if (checked) modeController.field.onChange(option.value)
                }}
                onBlur={modeController.field.onBlur}
              />
            ))}
          </div>
        </Field>

        {/* Arrival promise — screen 39, "Arrival promise" textarea */}
        <FormField
          control={control}
          name="arrivalPromise"
          label="Arrival promise"
          optionalLabel
          hint="A short paragraph shown on the event card and welcome panel. Leave blank to use the default."
        >
          {(field, id) => (
            <Textarea
              id={id}
              ref={field.ref}
              name={field.name}
              value={field.value}
              rows={3}
              maxLength={400}
              placeholder="Walk in alone if you like. We'll welcome you by name and make the first game easy."
              onBlur={field.onBlur}
              onChange={field.onChange}
            />
          )}
        </FormField>

        {/* Description */}
        <FormField
          control={control}
          name="description"
          label="Description"
          optionalLabel
          hint="The full story of the event, shown on its page."
        >
          {(field, id) => (
            <Textarea
              id={id}
              ref={field.ref}
              name={field.name}
              value={field.value}
              rows={6}
              maxLength={4000}
              onBlur={field.onBlur}
              onChange={field.onChange}
            />
          )}
        </FormField>

        {/* First-timer welcome section */}
        <section aria-labelledby={`${groupId}-welcome`} className="grid min-w-0 gap-4">
          <Heading level={2} size="card" id={`${groupId}-welcome`}>
            First-timer welcome
          </Heading>
          <FormField
            control={control}
            name="eyebrow"
            label="Welcome label"
            optionalLabel
            hint="A short line above the heading."
          >
            {(field, id) => (
              <Input
                id={id}
                ref={field.ref}
                name={field.name}
                value={field.value}
                maxLength={60}
                onBlur={field.onBlur}
                onChange={field.onChange}
              />
            )}
          </FormField>
          <FormField control={control} name="heading" label="Heading" optionalLabel>
            {(field, id) => (
              <Input
                id={id}
                ref={field.ref}
                name={field.name}
                value={field.value}
                maxLength={160}
                onBlur={field.onBlur}
                onChange={field.onChange}
              />
            )}
          </FormField>
          <FormField control={control} name="body" label="Welcome text" optionalLabel>
            {(field, id) => (
              <Textarea
                id={id}
                ref={field.ref}
                name={field.name}
                value={field.value}
                rows={4}
                maxLength={1200}
                onBlur={field.onBlur}
                onChange={field.onChange}
              />
            )}
          </FormField>

          <FormField control={control} name="hostedArrival" label="Hospitality" group>
            {(field, id) => (
              <Switch
                id={id}
                ref={field.ref}
                name={field.name}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                label="Hosted arrival"
                description="A host greets first-timers at the door and walks them to a table."
              />
            )}
          </FormField>
        </section>

        <HighlightsEditor control={control} />
        <LogisticsEditor control={control} />
        <FaqEditor control={control} />

        {/* Public tags — screen 39, UI-only (backend gap PLAN-003 Q3) */}
        <Field
          label="Public tags"
          id={`${groupId}-tags`}
          hint="Tags shown on the event card (e.g. ALL LEVELS, Come solo). Up to 20 tags; press Enter or comma to add each one. Stored in the browser only — the backend field is not yet available."
          optionalLabel
        >
          <TagsField
            tags={tagsController.field.value}
            onChange={tagsController.field.onChange}
            id={`${groupId}-tags`}
          />
        </Field>
    </form>
  )
}
