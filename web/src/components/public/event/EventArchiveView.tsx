import { PlayerCard } from '@/components/player/PlayerCard'
import { Shell } from '@/components/layout/Shell'
import type { EventCardDto, EventDetailDto } from '@/lib/api/types/event'
import { formatEventDate } from '@/lib/format/date'
import { NO_VALUE } from '@/lib/format/placeholder'
import { ArchiveHero } from './ArchiveHero'
import { CancelledNotice } from './CancelledNotice'
import { EventGallery } from './EventGallery'
import { EventRecap } from './EventRecap'
import { EventStandings } from './EventStandings'
import { NextEventLink } from './NextEventLink'
import { hasText } from './eventText'
import type { HeroFact } from './HeroFacts'

interface EventArchiveViewProps {
  event: EventDetailDto
  next: EventCardDto | null
}

const TITLE_ID = 'event-title'
const RESULTS_ID = 'results'

/**
 * Event detail, archive mode (screen 04) for completed events, and the cancelled page. Same permanent URL as the open
 * state. No element offers registration. Completed: recap, final standings, gallery when media exists, next game.
 * Cancelled: the notice first, then the description and the next game. Server Component.
 */
export function EventArchiveView({ event, next }: EventArchiveViewProps) {
  const cancelled = event.status === 'cancelled'
  const archive = event.archive
  const standings = archive?.standings ?? []
  const gallery = archive?.gallery ?? null
  const dateChip = formatEventDate(event.startsAt, { weekday: 'none', year: false })

  const facts: HeroFact[] = cancelled
    ? [
        { label: 'Was planned for', value: formatEventDate(event.startsAt) },
        { label: 'Where', value: hasText(event.venue.venueName) ? event.venue.venueName : NO_VALUE },
      ]
    : [
        { label: 'Players', value: standings.length > 0 ? String(standings.length) : NO_VALUE },
        { label: 'Rounds', value: archive !== null && archive.roundsPlayed > 0 ? String(archive.roundsPlayed) : NO_VALUE },
        { label: 'Format', value: hasText(event.format) ? event.format : NO_VALUE },
        { label: 'Winner', value: archive?.winner ? <PlayerCard identity={archive.winner} variant="compact" /> : NO_VALUE },
      ]

  return (
    <>
      <ArchiveHero
        titleId={TITLE_ID}
        eyebrow={cancelled ? `Cancelled · ${dateChip}` : `Past event · ${dateChip}`}
        title={event.title}
        promise={event.promise}
        facts={facts}
        resultsHref={!cancelled && standings.length > 0 ? `#${RESULTS_ID}` : null}
        media={event.cover ?? event.media.items[0] ?? null}
      />
      <div className="pb-16 sm:pb-24">
        <Shell className="grid min-w-0 gap-16 sm:gap-24">
          {cancelled ? (
            <>
              <CancelledNotice cancelled={event.cancelled} next={next} />
              <EventRecap recap={null} fallback={event.description} />
            </>
          ) : (
            <>
              <EventRecap recap={archive?.recap ?? null} fallback={event.description} />
              <EventStandings
                id={RESULTS_ID}
                standings={standings}
                roundsPlayed={archive?.roundsPlayed ?? 0}
                pool={event.rating.rated ? event.rating.pool : null}
              />
              {gallery !== null && gallery.items.length > 0 ? (
                <EventGallery title={event.title} gallery={gallery} />
              ) : null}
              <NextEventLink next={next} />
            </>
          )}
        </Shell>
      </div>
    </>
  )
}
