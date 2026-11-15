"""Standings order and tie-breaks. Pure functions: no database, no clock.

Order: points, then Buchholz, then Sonneborn-Berger, then wins, then the caller's name order.
  * Buchholz            sum of the final scores of the opponents a player faced.
  * Sonneborn-Berger    for each opponent: a win adds their score, a draw adds half of it, a loss adds nothing.
  * Wins                games won, a bye counts as a win.
A bye counts as a full point and a win. For Buchholz and Sonneborn-Berger it is a virtual opponent on the player's own
final score (the usual convention), so a bye neither helps nor hurts the player's tie-breaks more than a real game would.
Only final results are passed in.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Game:
    white: object
    black: object          # None for a bye
    outcome: str | None    # 'white' | 'black' | 'draw'; ignored for a bye


@dataclass(frozen=True)
class TieBreaks:
    buchholz: float
    sonneborn_berger: float
    wins: int

    def key(self):
        """Sort key part: higher is better on every field."""
        return (-self.buchholz, -self.sonneborn_berger, -self.wins)


def score_of(games, players) -> dict:
    points = {p: 0.0 for p in players}
    for g in games:
        if g.black is None:
            points[g.white] += 1
        elif g.outcome == 'white':
            points[g.white] += 1
        elif g.outcome == 'black':
            points[g.black] += 1
        else:
            points[g.white] += 0.5
            points[g.black] += 0.5
    return points


def compute(games, players) -> dict:
    """Maps every player id in `players` to its TieBreaks, from the final `games`."""
    points = score_of(games, players)
    buchholz = {p: 0.0 for p in players}
    sonneborn = {p: 0.0 for p in players}
    wins = {p: 0 for p in players}

    for g in games:
        if g.black is None:
            wins[g.white] += 1
            buchholz[g.white] += points[g.white]
            sonneborn[g.white] += points[g.white]
            continue
        for me, opp, mine in ((g.white, g.black, 'white'), (g.black, g.white, 'black')):
            buchholz[me] += points[opp]
            if g.outcome == mine:
                wins[me] += 1
                sonneborn[me] += points[opp]
            elif g.outcome == 'draw':
                sonneborn[me] += points[opp] / 2

    return {p: TieBreaks(buchholz[p], sonneborn[p], wins[p]) for p in players}


def place_numbers(ordered, points, tiebreaks) -> list:
    """Place per row of `ordered`: shared only when points and every tie-break are equal."""
    places, last, last_place = [], None, 0
    for index, p in enumerate(ordered, start=1):
        signature = (points[p], tiebreaks[p])
        place = last_place if signature == last else index
        last, last_place = signature, place
        places.append(place)
    return places
