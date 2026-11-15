import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import type { AdminRoundsDto } from '@/lib/api/types/admin/control-rounds'
import { NO_VALUE } from '@/lib/format/placeholder'
import {
  compareStanding,
  computeTieBreaks,
  scoresOf,
  type FinalGame,
  type TieBreaks,
} from '@/features/event-control/pairings/tiebreaks'

interface StandingRow {
  uid: string
  name: string
  rating: number | null
  score: number
  played: number
  place: number
  buchholz: number
}

/** Compute standings from final pairings in all rounds. Only final results count. Order: points, then tie-breaks. */
function computeStandings(data: AdminRoundsDto): StandingRow[] {
  const played: Map<string, number> = new Map()
  const names: Map<string, string> = new Map()
  const ratings: Map<string, number | null> = new Map()
  const finals: FinalGame[] = []

  const seen = (id: string, name: string, rating: number | null) => {
    names.set(id, name)
    ratings.set(id, rating)
    played.set(id, played.get(id) ?? 0)
  }

  for (const round of data.rounds) {
    if (round.state === 'void') continue
    for (const pairing of round.pairings) {
      if (pairing.kind === 'bye') {
        const uid = pairing.player.registrationId
        seen(uid, pairing.player.name, pairing.player.rating)
        played.set(uid, (played.get(uid) ?? 0) + 1)
        finals.push({ white: uid, black: null, outcome: null })
        continue
      }
      const { white, black, result } = pairing
      seen(white.registrationId, white.name, white.rating)
      seen(black.registrationId, black.name, black.rating)
      if (result.state !== 'final') continue
      played.set(white.registrationId, (played.get(white.registrationId) ?? 0) + 1)
      played.set(black.registrationId, (played.get(black.registrationId) ?? 0) + 1)
      finals.push({ white: white.registrationId, black: black.registrationId, outcome: result.outcome })
    }
  }

  if (played.size === 0) return []

  const points = scoresOf(finals, played.keys())
  const breaks = computeTieBreaks(finals, points)
  const tbOf = (id: string): TieBreaks => breaks.get(id) ?? { buchholz: 0, sonnebornBerger: 0, wins: 0 }

  const sorted = [...played.keys()].sort(
    (a, b) =>
      compareStanding({ score: points.get(a) ?? 0, tb: tbOf(a) }, { score: points.get(b) ?? 0, tb: tbOf(b) }) ||
      (names.get(a) ?? '').localeCompare(names.get(b) ?? ''),
  )

  const rows: StandingRow[] = []
  let last: string | null = null
  let lastPlace = 0
  sorted.forEach((uid, index) => {
    const score = points.get(uid) ?? 0
    const tb = tbOf(uid)
    const signature = `${String(score)}|${String(tb.buchholz)}|${String(tb.sonnebornBerger)}|${String(tb.wins)}`
    const place = signature === last ? lastPlace : index + 1
    last = signature
    lastPlace = place
    rows.push({
      uid,
      name: names.get(uid) ?? uid,
      rating: ratings.get(uid) ?? null,
      score,
      played: played.get(uid) ?? 0,
      place,
      buchholz: tb.buchholz,
    })
  })
  return rows
}

function scoreText(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

interface Props {
  data: AdminRoundsDto
}

/**
 * Live standings computed from finalised results in the admin rounds payload.
 * Updates as results are entered — no separate fetch needed.
 */
export function StandingsSection({ data }: Props) {
  const standings = computeStandings(data)

  const completedRounds = data.rounds.filter((r) => r.state === 'completed').length
  const anyFinal = standings.some((r) => r.played > 0)

  const columns: TableColumn<StandingRow>[] = [
    { id: 'place', header: '#', cell: (row) => row.place, align: 'end', priority: 'primary' },
    { id: 'name', header: 'Player', cell: (row) => row.name, rowHeader: true },
    {
      id: 'score',
      header: 'Score',
      cell: (row) => `${scoreText(row.score)} / ${row.played}`,
      align: 'end',
      priority: 'primary',
    },
    {
      id: 'buchholz',
      header: 'Buchholz',
      cell: (row) => scoreText(row.buchholz),
      align: 'end',
    },
    {
      id: 'rating',
      header: 'Rating',
      cell: (row) => (row.rating === null ? NO_VALUE : String(row.rating)),
      align: 'end',
    },
  ]

  const heading =
    completedRounds > 0
      ? `After ${completedRounds} ${completedRounds === 1 ? 'round' : 'rounds'}`
      : 'In progress'

  return (
    <section aria-labelledby="admin-standings-title" className="min-w-0">
      <Eyebrow>Standings</Eyebrow>
      <Heading level={2} size="card" id="admin-standings-title" className="mt-1 mb-4">
        {heading}
      </Heading>
      {anyFinal ? (
        <ResponsiveTable
          caption="Current standings"
          columns={columns}
          rows={standings}
          getRowId={(row) => row.uid}
          empty={<EmptyState title="No results yet" framed={false}>No final results recorded.</EmptyState>}
        />
      ) : (
        <EmptyState title="No final results yet" framed={false}>
          Standings appear once the first result is finalised.
        </EmptyState>
      )}
    </section>
  )
}
