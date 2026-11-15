// Standings tie-breaks, mirror of backend registrations/tiebreaks.py. Pure, final results only.
// Order: points, Buchholz, Sonneborn-Berger, wins, then the caller's name order.

export interface FinalGame {
  white: string
  /** null for a bye. */
  black: string | null
  outcome: 'white' | 'black' | 'draw' | null
}

export interface TieBreaks {
  buchholz: number
  sonnebornBerger: number
  wins: number
}

export function scoresOf(games: readonly FinalGame[], players: Iterable<string>): Map<string, number> {
  const points = new Map<string, number>()
  for (const p of players) points.set(p, 0)
  const add = (id: string, value: number) => points.set(id, (points.get(id) ?? 0) + value)
  for (const g of games) {
    if (g.black === null || g.outcome === 'white') add(g.white, 1)
    else if (g.outcome === 'black') add(g.black, 1)
    else {
      add(g.white, 0.5)
      add(g.black, 0.5)
    }
  }
  return points
}

export function computeTieBreaks(
  games: readonly FinalGame[],
  points: ReadonlyMap<string, number>,
): Map<string, TieBreaks> {
  const out = new Map<string, TieBreaks>()
  for (const p of points.keys()) out.set(p, { buchholz: 0, sonnebornBerger: 0, wins: 0 })
  const of = (id: string): TieBreaks => out.get(id) as TieBreaks
  const pts = (id: string): number => points.get(id) ?? 0

  for (const g of games) {
    if (g.black === null) {
      const t = of(g.white)
      t.wins += 1
      t.buchholz += pts(g.white)
      t.sonnebornBerger += pts(g.white)
      continue
    }
    const sides = [
      { me: g.white, opp: g.black, mine: 'white' },
      { me: g.black, opp: g.white, mine: 'black' },
    ] as const
    for (const { me, opp, mine } of sides) {
      const t = of(me)
      t.buchholz += pts(opp)
      if (g.outcome === mine) {
        t.wins += 1
        t.sonnebornBerger += pts(opp)
      } else if (g.outcome === 'draw') {
        t.sonnebornBerger += pts(opp) / 2
      }
    }
  }
  return out
}

/** Negative when `a` ranks above `b` on points and tie-breaks (names are the caller's last resort). */
export function compareStanding(
  a: { score: number; tb: TieBreaks },
  b: { score: number; tb: TieBreaks },
): number {
  return (
    b.score - a.score ||
    b.tb.buchholz - a.tb.buchholz ||
    b.tb.sonnebornBerger - a.tb.sonnebornBerger ||
    b.tb.wins - a.tb.wins
  )
}
