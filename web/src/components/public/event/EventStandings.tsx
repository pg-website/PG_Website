import { PlayerCard } from '@/components/player/PlayerCard'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import type { RatingPool } from '@/lib/api/types/identity'
import type { StandingRow } from '@/lib/api/types/standings'
import { NO_VALUE } from '@/lib/format/placeholder'
import { scoreText } from './eventText'

interface EventStandingsProps {
  id: string
  standings: readonly StandingRow[]
  roundsPlayed: number
  /** Pool the event was rated in; names the rating column ("PG Rapid"). Null for unrated events. */
  pool: RatingPool | null
}

const TITLE_ID = 'event-standings-title'
const POOL_LABEL = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' } as const

const playerCell = (row: StandingRow) => <PlayerCard identity={row.identity} variant="compact" />

/**
 * Final standings (reference screen 04 `.data-table-static`) through ResponsiveTable: a real table from 720px and
 * labelled rows below, both in the raw HTML; stacked rows get `cv-auto` past the table threshold. Public identity only.
 * Empty standings show a calm empty state. Server Component.
 */
export function EventStandings({ id, standings, roundsPlayed, pool }: EventStandingsProps) {
  const columns: TableColumn<StandingRow>[] = [
    { id: 'place', header: 'Place', cell: (row) => row.place, align: 'end', priority: 'primary' },
    { id: 'player', header: 'Player', cell: playerCell, rowHeader: true },
    {
      id: 'score',
      header: 'Score',
      cell: (row) => `${scoreText(row.score)}/${row.rounds > 0 ? row.rounds : roundsPlayed}`,
      align: 'end',
      priority: 'primary',
    },
  ]
  if (pool !== null) {
    columns.push({
      id: 'rating',
      header: `PG ${POOL_LABEL[pool]}`,
      cell: (row) => (row.rating === null ? NO_VALUE : row.rating.value),
      align: 'end',
    })
  }

  const heading = roundsPlayed > 0 ? `The room after ${roundsPlayed} ${roundsPlayed === 1 ? 'round' : 'rounds'}.` : 'Final standings'

  return (
    <section id={id} aria-labelledby={TITLE_ID} className="min-w-0">
      <Eyebrow>Final standings</Eyebrow>
      <Heading level={2} size="section" id={TITLE_ID} className="mt-3 mb-6 max-w-2xl">
        {heading}
      </Heading>
      <ResponsiveTable
        caption="Final standings"
        columns={columns}
        rows={standings}
        getRowId={(row) => `${row.place}-${row.identity.displayName}`}
        empty={
          <EmptyState title="No standings for this game" framed={false} className="p-6">
            This was a social evening without a results table, or the hosts have not published it.
          </EmptyState>
        }
      />
    </section>
  )
}
