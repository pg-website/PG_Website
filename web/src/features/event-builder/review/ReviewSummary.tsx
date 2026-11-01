'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { Heading } from '@/components/ui/Heading'
import { useBuilderSelector } from '@/features/event-builder/context'
import { useGoToStep } from '@/features/event-builder/nav-context'
import { overlayStep } from '@/features/event-builder/patch'
import { formatEventDateTime } from '@/lib/format/date'
import { formatInr } from '@/lib/format/money'
import { MESSAGE_TRIGGERS, type BuilderDraftDto, type BuilderStep } from '@/lib/api/types/admin/event-builder'
import type { PendingPatch } from '@/features/event-builder/types'

interface SummaryRow {
  step: BuilderStep
  label: string
  facts: readonly string[]
}

const NOT_SET = 'Not set'

function filled(text: string, fallback = NOT_SET): string {
  return text.trim() === '' ? fallback : text.trim()
}

/** Plain-words facts per step from the draft with unsent edits laid over it. Pure. */
export function summarize(server: BuilderDraftDto, pending: PendingPatch): SummaryRow[] {
  const basics = overlayStep('basics', server.basics, pending.basics)
  const experience = overlayStep('experience', server.experience, pending.experience)
  const registration = overlayStep('registration', server.registration, pending.registration)
  const payment = overlayStep('payment', server.payment, pending.payment)
  const game = overlayStep('gameSystem', server.gameSystem, pending.gameSystem)
  const media = overlayStep('media', server.media, pending.media)
  const comms = overlayStep('communications', server.communications, pending.communications)
  const emailsOn = MESSAGE_TRIGGERS.filter((trigger) => comms.triggers[trigger] === true).length

  return [
    {
      step: 'basics',
      label: 'Basics',
      facts: [
        filled(basics.title, 'No title'),
        basics.startsAt === null ? 'No start time' : formatEventDateTime(basics.startsAt),
        filled(
          [basics.venueName, basics.area, basics.city].filter((part) => part.trim() !== '').join(', '),
          'No venue',
        ),
      ],
    },
    {
      step: 'experience',
      label: 'Experience',
      facts: [
        experience.description.trim() === '' ? 'No description' : 'Description added',
        `${experience.highlights.length} highlights, ${experience.faq.length} questions`,
      ],
    },
    {
      step: 'registration',
      label: 'Registration',
      facts: [
        registration.capacity === null ? 'Unlimited' : `${registration.capacity} places`,
        registration.waitlistEnabled ? 'Waitlist on' : 'Waitlist off',
        registration.opensAt === null ? 'Opens when published' : `Opens ${formatEventDateTime(registration.opensAt)}`,
      ],
    },
    {
      step: 'payment',
      label: 'Payment',
      facts: [
        formatInr(payment.pricePaise),
        payment.refundWindowHours === null ? 'No refunds' : `Refunds up to ${payment.refundWindowHours} h before`,
      ],
    },
    {
      step: 'game_system',
      label: 'Game system',
      facts: [
        game.rated ? 'Rated' : 'Not rated',
        game.pairingMode.replaceAll('_', ' '),
        game.rounds === null ? 'Rounds not set' : `${game.rounds} rounds`,
        game.timeControl.trim() === '' ? 'Time control not set' : `Time control ${game.timeControl}`,
      ],
    },
    {
      step: 'media',
      label: 'Media',
      facts:
        media.assetIds.length === 0
          ? ['No images (placeholder shown)']
          : [
              `${media.assetIds.length} image${media.assetIds.length === 1 ? '' : 's'}`,
              media.assetIds.length > 1 ? 'Carousel' : 'Static',
            ],
    },
    {
      step: 'communications',
      label: 'Communications',
      facts: [`${emailsOn} of ${MESSAGE_TRIGGERS.length} emails on`],
    },
  ]
}

/** Read-only recap of steps 1 to 7. Each row jumps back to its step. */
export function ReviewSummary({ readOnly = false }: { readOnly?: boolean }) {
  const server = useBuilderSelector((state) => state.server)
  const pending = useBuilderSelector((state) => state.pending)
  const goTo = useGoToStep()
  const rows = useMemo(() => summarize(server, pending), [server, pending])

  return (
    <section aria-labelledby="review-summary" className="grid min-w-0 gap-3">
      <Heading level={2} size="card" id="review-summary">
        Summary
      </Heading>
      <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
        {rows.map((row) => (
          <li
            key={row.step}
            className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-line pb-2"
          >
            <div className="min-w-0">
              <p className="m-0 font-strong text-ink">{row.label}</p>
              <p className="m-0 text-sm wrap-break-word text-muted">{row.facts.join(' · ')}</p>
            </div>
            {readOnly ? null : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit ${row.label}`}
                onClick={() => {
                  goTo(row.step)
                }}
              >
                Edit
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
