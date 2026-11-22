'use client'

import { Controller } from 'react-hook-form'
import { Switch } from '@/components/ui/form/Switch'
import { Heading } from '@/components/ui/Heading'
import { useStepForm } from '@/features/event-builder/context'
import type { BuilderStepProps } from '@/features/event-builder/types'
import {
  MESSAGE_TRIGGERS,
  type CommunicationsStep as CommunicationsValues,
  type MessageTrigger,
} from '@/lib/api/types/admin/event-builder'
import { controlIdFor } from '@/lib/forms/ids'

// Builder step 7 (FE-29): which state-triggered emails go out for this event (C15, also part of the builder resource, so
// the store's autosave and version handling apply). Email is the only channel at launch.

const TRIGGER_COPY: Readonly<Record<MessageTrigger, { label: string; description: string }>> = {
  confirmation: { label: 'Booking confirmation', description: 'Sent when a place is confirmed.' },
  reminder_24h: { label: 'Reminder, 24 hours before', description: 'Sent to confirmed players the day before.' },
  checkin_open: { label: 'Check-in is open', description: 'Sent when check-in opens at the venue.' },
  pairing_published: { label: 'Pairings published', description: 'Sent when a round is published.' },
  post_event: { label: 'After the event', description: 'A thank-you and recap once the event is complete.' },
}

export function CommunicationsStep({ dataKey }: BuilderStepProps) {
  const form = useStepForm<CommunicationsValues>(dataKey ?? 'communications')
  const { control } = form

  return (
    <section aria-labelledby="comms-triggers" className="grid min-w-0 gap-4">
      <Heading level={2} size="card" id="comms-triggers">
        Automatic emails
      </Heading>
      <p className="text-sm text-muted">
        Choose which emails players get for this event. Messages are sent by email only. Each change saves on its own.
      </p>
      <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
        {MESSAGE_TRIGGERS.map((trigger) => (
          <li key={trigger} className="min-w-0">
            <Controller
              control={control}
              name={`triggers.${trigger}`}
              render={({ field }) => (
                <Switch
                  id={controlIdFor(field.name)}
                  ref={field.ref}
                  name={field.name}
                  label={TRIGGER_COPY[trigger].label}
                  description={TRIGGER_COPY[trigger].description}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
