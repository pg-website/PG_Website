import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import type { AdminRoundsDto } from '@/lib/api/types/admin/control-rounds'
import { NO_VALUE } from '@/lib/format/placeholder'

interface StandingRow {
  uid: string
  name: string
  rating: number | null
  score: number
  played: number
  place: number
}

/** Compute standings from final pairings in all rounds. Only final results count. */
function computeStandings(data: AdminRoundsDto): StandingRow[] {
  const scores: Map<string, number> = new Map()
  const played: Map<string, number> = new Map()
  const names: Map<string, string> = new Map()
  const ratings: Map<string, number | null> = new Map()

  for (const round of data.rounds) {
    if (round.state === 'void') continue
    for (const pairing of round.pairings) {
      if (pairing.kind === 'bye') {
        const uid = pairing.player.registrationId
        names.set(uid, pairing.player.name)
        ratings.set(uid, pairing.player.rating)
        scores.set(uid, (scores.get(uid) ?? 0) + 1)
        played.set(uid, (played.get(uid) ?? 0) + 1)
        continue
      }
      // game
      const { white, black, result } = pairing
      for (const p of [white, black]) {
        names.set(p.registrationId, p.name)
        ratings.set(p.registrationId, p.rating)
        scores.set(p.registrationId, scores.get(p.registrationId) ?? 0)
        played.set(p.registrationId, played.get(p.registrationId) ?? 0)
      }
      if (result.state !== 'final') continue
      played.set(white.registrationId, (played.get(white.registrationId) ?? 0) + 1)
      played.set(black.registrationId, (played.get(black.registrationId) ?? 0) + 1)
      if (result.outcome === 'white') {
        scores.set(white.registrationId, (scores.get(white.registrationId) ?? 0) + 1)
      } else if (result.outcome === 'black') {
        scores.set(black.registrationId, (scores.get(black.registrationId) ?? 0) + 1)
      } else {
        scores.set(white.registrationId, (scores.get(white.registrationId) ?? 0) + 0.5)
        scores.set(black.registrationId, (scores.get(black.registrationId) ?? 0) + 0.5)
      }
    }
  }

  if (scores.size === 0) return []

  const sorted = [...scores.entries()].sort(([aId, aScore], [bId, bScore]) => {
    if (bScore !== aScore) return bScore - aScore
    return (names.get(aId) ?? '').localeCompare(names.get(bId) ?? '')
  })

  const rows: StandingRow[] = []
  let lastScore: number | null = null
  let lastPlace = 0
  sorted.forEach(([uid, score], index) => {
    const place = score === lastScore ? lastPlace : index + 1
    lastScore = score
    lastPlace = place
    rows.push({ uid, name: names.get(uid) ?? uid, rating: ratings.get(uid) ?? null, score, played: played.get(uid) ?? 0, place })
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
