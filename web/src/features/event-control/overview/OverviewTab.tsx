import type { Route } from 'next'
import { Heading } from '@/components/ui/Heading'
import { Surface } from '@/components/ui/Surface'
import { Text } from '@/components/ui/Text'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/feedback/ProgressBar'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { Timeline, type TimelineItem } from '@/components/domain/Timeline'
import { InfoRow } from '@/components/ui/InfoRow'
import type { ControlTabProps } from '@/features/event-control/tabs'
import type { EventOverviewDto } from '@/lib/api/types/admin/control-overview'
import { PAIRING_MODE_LABEL, ROUND_STATE_LABEL } from '@/lib/format/event-labels'
import { formatEventDateTime } from '@/lib/format/date'

/** First open run-of-show item is "now"; done items are done; the rest are upcoming. Order and `done` come from the server. */
function toTimeline(items: EventOverviewDto['runOfShow']): TimelineItem[] {
  const currentIndex = items.findIndex((item) => !item.done)
  return items.map((item, index) => ({
    id: item.key,
    title: item.label,
    meta: item.dueAt === null ? null : formatEventDateTime(item.dueAt),
    state: item.done ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }))
}

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.min(100, Math.round((part / whole) * 100))
}

/**
 * Overview tab (screen 46, C01): the event-day picture below the header strip. The data is the shared overview already
 * loaded by the frame, so there is no second request and no loading state of its own. Server facts only; nothing derived
 * except the progress percentages. C01 carries no activity feed, so "recent activity" lives in the Audit tab.
 */
export function OverviewTab({ eventId, overview }: ControlTabProps) {
  const base = `/admin/events/${encodeURIComponent(eventId)}`
  const { arrival, pairing, runOfShow, summary } = overview
  const next = runOfShow.find((item) => !item.done)
  const welcomeLeft = Math.max(0, summary.firstTimers - arrival.welcomedFirstTimers)
  const notArrived = Math.max(0, arrival.expected - arrival.checkedIn)

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <Surface
        as="section"
        tone="admin"
        aria-label="Next up"
        className="grid min-w-0 content-start gap-3 lg:col-span-2"
      >
        <Heading level={2} size="card">
          Next up
        </Heading>
        {next === undefined ? (
          <Text>Every step of the run of show is done.</Text>
        ) : (
          <Text>
            {next.label}
            {next.dueAt === null ? '' : `, due ${formatEventDateTime(next.dueAt)}`}.
          </Text>
        )}
        <div className="flex flex-wrap gap-3">
          {welcomeLeft > 0 ? (
            <Button href={`${base}/registrations` as Route} variant="secondary">
              {welcomeLeft === 1 ? 'Welcome 1 first-timer' : `Welcome ${welcomeLeft} first-timers`}
            </Button>
          ) : null}
          {notArrived > 0 ? (
            <Button href={`${base}/check-in` as Route} variant="secondary">
              Open check-in
            </Button>
          ) : null}
          <Button href={`${base}/pairings` as Route} variant="secondary">
            Open pairings
          </Button>
        </div>
      </Surface>

      <Surface as="section" tone="admin" aria-label="Arrivals" className="grid min-w-0 content-start gap-4">
        <Heading level={2} size="card">
          Arrivals
        </Heading>
        <ProgressBar label="Checked in" value={percent(arrival.checkedIn, arrival.expected)} showValue={false} />
        <dl>
          <InfoRow label="Checked in">{`${arrival.checkedIn} of ${arrival.expected}`}</InfoRow>
          <InfoRow label="Still to arrive">{String(notArrived)}</InfoRow>
          <InfoRow label="First-timers welcomed">{`${arrival.welcomedFirstTimers} of ${summary.firstTimers}`}</InfoRow>
          <InfoRow label="Waitlist">{String(summary.waitlist)}</InfoRow>
        </dl>
      </Surface>

      <Surface as="section" tone="admin" aria-label="Pairings" className="grid min-w-0 content-start gap-4">
        <Heading level={2} size="card">
          Pairings
        </Heading>
        <dl>
          <InfoRow label="Mode">{PAIRING_MODE_LABEL[pairing.mode]}</InfoRow>
          <InfoRow label="Round">
            {pairing.currentRound === 0
              ? 'Not started'
              : `${pairing.currentRound}${pairing.roundsPlanned === null ? '' : ` of ${pairing.roundsPlanned}`}`}
          </InfoRow>
          <InfoRow label="Round status">
            {pairing.currentRoundState === null ? 'No round yet' : ROUND_STATE_LABEL[pairing.currentRoundState]}
          </InfoRow>
        </dl>
      </Surface>

      <Surface as="section" tone="admin" aria-label="Run of show" className="grid min-w-0 gap-4 lg:col-span-2">
        <Heading level={2} size="card">
          Run of show
        </Heading>
        {runOfShow.length === 0 ? (
          <EmptyState framed={false} title="No steps yet">
            The checklist appears once the event is published.
          </EmptyState>
        ) : (
          <Timeline items={toTimeline(runOfShow)} label="Run of show" />
        )}
      </Surface>
    </div>
  )
}
