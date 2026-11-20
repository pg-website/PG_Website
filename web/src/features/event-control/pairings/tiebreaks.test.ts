import { describe, expect, it } from 'vitest'
import {
  compareStanding,
  computeTieBreaks,
  scoresOf,
  type FinalGame,
} from '@/features/event-control/pairings/tiebreaks'

const game = (white: string, black: string | null, outcome: FinalGame['outcome']): FinalGame => ({
  white,
  black,
  outcome,
})

function rank(players: string[], games: FinalGame[]) {
  const points = scoresOf(games, players)
  const breaks = computeTieBreaks(games, points)
  const ranked = [...players].sort(
    (a, b) =>
      compareStanding(
        { score: points.get(a) ?? 0, tb: breaks.get(a)! },
        { score: points.get(b) ?? 0, tb: breaks.get(b)! },
      ) || a.localeCompare(b),
  )
  return { ranked, points, breaks }
}

// Shared with backend/registrations/test_tiebreaks.py: keep the two in step.
const FOUR_PLAYERS: FinalGame[] = [
  game('A', 'B', 'white'),
  game('C', 'D', 'draw'),
  game('A', 'C', 'draw'),
  game('B', 'D', 'white'),
  game('A', 'D', 'white'),
  game('B', 'C', 'draw'),
]
const PLAYERS = ['A', 'B', 'C', 'D']

describe('scoresOf', () => {
  it('scores wins, draws, black wins and byes', () => {
    const points = scoresOf(
      [game('A', 'B', 'white'), game('C', 'D', 'draw'), game('E', null, null), game('F', 'G', 'black')],
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    )
    expect(Object.fromEntries(points)).toEqual({ A: 1, B: 0, C: 0.5, D: 0.5, E: 1, F: 0, G: 1 })
  })
})

describe('computeTieBreaks', () => {
  it('matches the hand-worked four-player example (same numbers as the backend test)', () => {
    const { points, breaks } = rank(PLAYERS, FOUR_PLAYERS)
    expect(Object.fromEntries(points)).toEqual({ A: 2.5, B: 1.5, C: 1.5, D: 0.5 })
    const got = Object.fromEntries([...breaks].map(([p, t]) => [p, [t.buchholz, t.sonnebornBerger, t.wins]]))
    expect(got).toEqual({ A: [3.5, 2.75, 2], B: [4.5, 1.25, 1], C: [4.5, 2.25, 0], D: [5.5, 0.75, 0] })
  })

  it('breaks an equal-points, equal-Buchholz tie on Sonneborn-Berger', () => {
    expect(rank(PLAYERS, FOUR_PLAYERS).ranked).toEqual(['A', 'C', 'B', 'D'])
  })

  it('counts a bye as a win and a virtual opponent on the player own score', () => {
    const { breaks } = rank(['A', 'B', 'E'], [game('E', null, null), game('A', 'B', 'draw')])
    expect(breaks.get('E')).toEqual({ buchholz: 1, sonnebornBerger: 1, wins: 1 })
    expect(breaks.get('A')).toEqual({ buchholz: 0.5, sonnebornBerger: 0.25, wins: 0 })
  })

  it('gives a player with no final games zeros', () => {
    const { points, breaks } = rank(['A', 'B', 'Z'], [game('A', 'B', 'white')])
    expect(points.get('Z')).toBe(0)
    expect(breaks.get('Z')).toEqual({ buchholz: 0, sonnebornBerger: 0, wins: 0 })
  })
})

describe('compareStanding', () => {
  const tb = { buchholz: 4, sonnebornBerger: 2, wins: 1 }

  it('ranks higher points first, then Buchholz, then Sonneborn-Berger, then wins', () => {
    expect(compareStanding({ score: 2, tb }, { score: 1, tb })).toBeLessThan(0)
    expect(compareStanding({ score: 1, tb: { ...tb, buchholz: 5 } }, { score: 1, tb })).toBeLessThan(0)
    expect(compareStanding({ score: 1, tb: { ...tb, sonnebornBerger: 3 } }, { score: 1, tb })).toBeLessThan(0)
    expect(compareStanding({ score: 1, tb: { ...tb, wins: 2 } }, { score: 1, tb })).toBeLessThan(0)
  })

  it('returns 0 on a full tie', () => {
    expect(compareStanding({ score: 1, tb }, { score: 1, tb })).toBe(0)
  })
})
