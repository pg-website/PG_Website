"""Standings order and tie-breaks. Pure functions: no database, no clock.

Order: points, then Buchholz, then Buchholz cut 1, then Buchholz cut 2, then Sonneborn-Berger, then the caller's name order.
  * Buchholz            sum of the final scores of the opponents a player faced.
  * Buchholz cut 1      Buchholz with the lowest opponent score removed.
  * Buchholz cut 2      Buchholz with the two lowest opponent scores removed.
  * Sonneborn-Berger    for each opponent: a win adds their score, a draw adds half of it, a loss adds nothing.
A bye counts as a full point. For Buchholz and Sonneborn-Berger it is a virtual opponent on the player's own
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
    buchholz_cut1: float
    buchholz_cut2: float
    sonneborn_berger: float

    def key(self):
        """Sort key part: higher is better on every field."""
        return (-self.buchholz, -self.buchholz_cut1, -self.buchholz_cut2, -self.sonneborn_berger)


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
    opponent_scores = {p: [] for p in players}
    sonneborn = {p: 0.0 for p in players}

    for g in games:
        if g.black is None:
            # Bye: virtual opponent on player's own score
            opponent_scores[g.white].append(points[g.white])
            sonneborn[g.white] += points[g.white]
            continue
        for me, opp, mine in ((g.white, g.black, 'white'), (g.black, g.white, 'black')):
            opponent_scores[me].append(points[opp])
            if g.outcome == mine:
                sonneborn[me] += points[opp]
            elif g.outcome == 'draw':
                sonneborn[me] += points[opp] / 2

    result = {}
    for p in players:
        opp_scores = sorted(opponent_scores[p])
        buchholz = sum(opp_scores)
        buchholz_cut1 = sum(opp_scores[1:]) if len(opp_scores) > 0 else 0.0
        buchholz_cut2 = sum(opp_scores[2:]) if len(opp_scores) > 1 else 0.0
        result[p] = TieBreaks(buchholz, buchholz_cut1, buchholz_cut2, sonneborn[p])
    
    return result


def place_numbers(ordered, points, tiebreaks) -> list:
    """Place per row of `ordered`: shared only when points and every tie-break are equal."""
    places, last, last_place = [], None, 0
    for index, p in enumerate(ordered, start=1):
        signature = (points[p], tiebreaks[p])
        place = last_place if signature == last else index
        last, last_place = signature, place
        places.append(place)
    return places
