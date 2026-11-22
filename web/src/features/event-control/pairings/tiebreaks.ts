// Standings tie-breaks, mirror of backend registrations/tiebreaks.py. Pure, final results only.
// Order: points, Buchholz, Buchholz cut 1, Buchholz cut 2, Sonneborn-Berger, then the caller's name order.

export interface FinalGame {
  white: string
  /** null for a bye. */
  black: string | null
  outcome: 'white' | 'black' | 'draw' | null
}

export interface TieBreaks {
  buchholz: number
  buchholzCut1: number
  buchholzCut2: number
  sonnebornBerger: number
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
  const opponentScores = new Map<string, number[]>()
  const sonnebornBerger = new Map<string, number>()
  
  for (const p of points.keys()) {
    opponentScores.set(p, [])
    sonnebornBerger.set(p, 0)
  }
  
  const pts = (id: string): number => points.get(id) ?? 0

  for (const g of games) {
    if (g.black === null) {
      // Bye: virtual opponent on player's own score
      opponentScores.get(g.white)!.push(pts(g.white))
      sonnebornBerger.set(g.white, (sonnebornBerger.get(g.white) ?? 0) + pts(g.white))
      continue
    }
    const sides = [
      { me: g.white, opp: g.black, mine: 'white' },
      { me: g.black, opp: g.white, mine: 'black' },
    ] as const
    for (const { me, opp, mine } of sides) {
      opponentScores.get(me)!.push(pts(opp))
      if (g.outcome === mine) {
        sonnebornBerger.set(me, (sonnebornBerger.get(me) ?? 0) + pts(opp))
      } else if (g.outcome === 'draw') {
        sonnebornBerger.set(me, (sonnebornBerger.get(me) ?? 0) + pts(opp) / 2)
      }
    }
  }
  
  const out = new Map<string, TieBreaks>()
  for (const p of points.keys()) {
    const oppScores = opponentScores.get(p)!.sort((a, b) => a - b)
    const buchholz = oppScores.reduce((sum, s) => sum + s, 0)
    const buchholzCut1 = oppScores.length > 0 ? oppScores.slice(1).reduce((sum, s) => sum + s, 0) : 0
    const buchholzCut2 = oppScores.length > 1 ? oppScores.slice(2).reduce((sum, s) => sum + s, 0) : 0
    out.set(p, {
      buchholz,
      buchholzCut1,
      buchholzCut2,
      sonnebornBerger: sonnebornBerger.get(p) ?? 0,
    })
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
    b.tb.buchholzCut1 - a.tb.buchholzCut1 ||
    b.tb.buchholzCut2 - a.tb.buchholzCut2 ||
    b.tb.sonnebornBerger - a.tb.sonnebornBerger
  )
}
