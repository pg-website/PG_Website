import { BoardCard } from '@/components/domain/BoardCard'
import { eventStatusLabel, eventStatusTone } from '@/components/domain/eventLabels'
import { Button } from '@/components/ui/Button'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Surface } from '@/components/ui/Surface'
import { Text } from '@/components/ui/Text'
import { Board } from '@/components/ui/icons/Board'
import { MapPin } from '@/components/ui/icons/MapPin'
import type { PublicEventStatus } from '@/lib/api/types/event-state'
import type { NextUpDto } from '@/lib/api/types/my-events'
import { formatEventDateTime } from '@/lib/format/date'
import { eventRoomHref } from '@/features/player/shared/links'

/** The page statuses a player can see on an event link; `draft` never reaches a player DTO. */
function publicStatus(status: NextUpDto['event']['status']): PublicEventStatus | undefined {
  return status === 'draft' ? undefined : status
}

export function NextUpCard({ nextUp }: { nextUp: NextUpDto }) {
  const { event, pairing } = nextUp
  const status = publicStatus(event.status)
  return (
    <Surface as="article" aria-labelledby="next-up-title" padding="lg" className="flex flex-col gap-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Eyebrow>Next up</Eyebrow>
        {status === undefined ? null : (
          <StatusBadge tone={eventStatusTone(status)}>{eventStatusLabel(status)}</StatusBadge>
        )}
      </div>
      <div className="min-w-0">
        <Heading level={3} size="panel" id="next-up-title">
          {event.title}
        </Heading>
        <p className="mt-2 flex min-w-0 items-start gap-2 text-body wrap-break-word text-muted">
          <MapPin size="sm" className="mt-1 shrink-0" />
          <span>
            {nextUp.venue} · {event.area}
            <br />
            {formatEventDateTime(event.startsAt)}
          </span>
        </p>
      </div>
      {pairing === null ? (
        <p className="border-l-4 border-copper-dark bg-sand/40 p-4 text-body wrap-break-word">
          <strong className="font-strong">What to do: </strong>
          {nextUp.nextAction}
        </p>
      ) : (
        <>
          <BoardCard
            pairing={{
              board: pairing.board,
              colour: pairing.colour,
              round: pairing.round,
              // The next-up DTO carries no time control (DTO gap); BoardCard shows an em dash.
              timeControl: '',
              opponent: {
                displayName: pairing.opponent.displayName,
                initials: pairing.opponent.initials,
                publicId: pairing.opponent.publicId,
                rating: pairing.opponent.rating?.value ?? null,
              },
            }}
          />
          <Text variant="small">{nextUp.nextAction}</Text>
        </>
      )}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        <Button href={eventRoomHref(event.id)} size="lg" icon={<Board size="sm" />}>
          Open event room
        </Button>
      </div>
    </Surface>
  )
}
