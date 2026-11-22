from django.test import SimpleTestCase

from registrations.tiebreaks import Game, compute, place_numbers, score_of


def order(players, games):
    points = score_of(games, players)
    breaks = compute(games, players)
    ranked = sorted(players, key=lambda p: (-points[p], *breaks[p].key(), p))
    return ranked, points, breaks


# Shared with web/src/features/event-control/pairings/tiebreaks.test.ts: keep the two in step.
FOUR_PLAYERS = [
    Game('A', 'B', 'white'), Game('C', 'D', 'draw'),
    Game('A', 'C', 'draw'), Game('B', 'D', 'white'),
    Game('A', 'D', 'white'), Game('B', 'C', 'draw'),
]
PLAYERS = ['A', 'B', 'C', 'D']


class ScoreTests(SimpleTestCase):
    def test_win_draw_loss_and_bye_points(self):
        games = [Game('A', 'B', 'white'), Game('C', 'D', 'draw'), Game('E', None, None)]
        points = score_of(games, ['A', 'B', 'C', 'D', 'E'])
        self.assertEqual(points, {'A': 1.0, 'B': 0.0, 'C': 0.5, 'D': 0.5, 'E': 1.0})

    def test_black_win(self):
        self.assertEqual(score_of([Game('A', 'B', 'black')], ['A', 'B']), {'A': 0.0, 'B': 1.0})


class TieBreakTests(SimpleTestCase):
    def test_hand_worked_four_player_round_robin(self):
        _, points, breaks = order(PLAYERS, FOUR_PLAYERS)
        self.assertEqual(points, {'A': 2.5, 'B': 1.5, 'C': 1.5, 'D': 0.5})
        got = {p: (t.buchholz, t.buchholz_cut1, t.buchholz_cut2, t.sonneborn_berger) for p, t in breaks.items()}
        self.assertEqual(got, {'A': (3.5, 3.0, 1.5, 2.75), 'B': (4.5, 4.0, 2.5, 1.25), 'C': (4.5, 4.0, 2.5, 2.25), 'D': (5.5, 4.0, 2.5, 0.75)})

    def test_equal_points_buchholz_and_cuts_fall_to_sonneborn_berger(self):
        ranked, _, _ = order(PLAYERS, FOUR_PLAYERS)
        self.assertEqual(ranked, ['A', 'C', 'B', 'D'])  # B and C: 1.5 pts, same Buchholz (4.5), same cuts (3.0, 1.5); C wins on SB 2.25 vs 1.25

    def test_buchholz_decides_before_sonneborn_berger(self):
        # X, Y, Z all finish on 1.5. Y has the highest Buchholz (6.5) so ranks first among them; X and Z tie on Buchholz
        # (5.0) and split on Sonneborn-Berger (1.75 vs 1.25).
        games = [
            Game('S', 'X', 'white'), Game('S', 'Z', 'white'), Game('S', 'Y', 'white'), Game('Y', 'X', 'black'),
            Game('Z', 'W', 'white'), Game('Y', 'W', 'white'), Game('X', 'W', 'draw'), Game('Z', 'Y', 'draw'),
        ]
        ranked, points, breaks = order(['S', 'X', 'Y', 'Z', 'W'], games)
        self.assertEqual((points['X'], points['Y'], points['Z']), (1.5, 1.5, 1.5))
        self.assertEqual((breaks['X'].buchholz, breaks['Y'].buchholz, breaks['Z'].buchholz), (5.0, 6.5, 5.0))
        self.assertEqual((breaks['X'].sonneborn_berger, breaks['Z'].sonneborn_berger), (1.75, 1.25))
        self.assertEqual(ranked, ['S', 'Y', 'X', 'Z', 'W'])

    def test_cut_tiebreaks_decide_before_sonneborn_berger(self):
        from registrations.tiebreaks import TieBreaks
        base = TieBreaks(buchholz=4.0, buchholz_cut1=3.0, buchholz_cut2=2.0, sonneborn_berger=2.0)
        more_sb = TieBreaks(buchholz=4.0, buchholz_cut1=3.0, buchholz_cut2=2.0, sonneborn_berger=3.0)
        more_cut2 = TieBreaks(buchholz=4.0, buchholz_cut1=3.0, buchholz_cut2=2.5, sonneborn_berger=0.0)
        more_cut1 = TieBreaks(buchholz=4.0, buchholz_cut1=3.5, buchholz_cut2=0.0, sonneborn_berger=0.0)
        more_bh = TieBreaks(buchholz=5.0, buchholz_cut1=0.0, buchholz_cut2=0.0, sonneborn_berger=0.0)
        self.assertLess(more_sb.key(), base.key())
        self.assertLess(more_cut2.key(), more_sb.key())
        self.assertLess(more_cut1.key(), more_cut2.key())
        self.assertLess(more_bh.key(), more_cut1.key())

    def test_a_full_tie_falls_through_to_the_callers_final_key(self):
        games = [Game('A', 'B', 'draw'), Game('C', 'D', 'draw')]
        ranked, _, _ = order(['A', 'B', 'C', 'D'], games)
        self.assertEqual(ranked, ['A', 'B', 'C', 'D'])

    def test_bye_counts_as_a_virtual_opponent_on_own_score(self):
        games = [Game('E', None, None), Game('A', 'B', 'draw')]
        _, _, breaks = order(['A', 'B', 'E'], games)
        e = breaks['E']
        self.assertEqual((e.buchholz, e.buchholz_cut1, e.buchholz_cut2, e.sonneborn_berger), (1.0, 0.0, 0.0, 1.0))
        a = breaks['A']
        self.assertEqual((a.buchholz, a.buchholz_cut1, a.buchholz_cut2, a.sonneborn_berger), (0.5, 0.0, 0.0, 0.25))

    def test_player_with_no_final_games_scores_zero(self):
        _, points, breaks = order(['A', 'B', 'Z'], [Game('A', 'B', 'white')])
        self.assertEqual(points['Z'], 0.0)
        self.assertEqual((breaks['Z'].buchholz, breaks['Z'].buchholz_cut1, breaks['Z'].buchholz_cut2, breaks['Z'].sonneborn_berger), (0.0, 0.0, 0.0, 0.0))


class PlaceTests(SimpleTestCase):
    def test_places_are_shared_only_on_a_full_tie(self):
        ranked, points, breaks = order(PLAYERS, FOUR_PLAYERS)
        self.assertEqual(place_numbers(ranked, points, breaks), [1, 2, 3, 4])  # B and C are split by tie-breaks

    def test_a_true_tie_shares_the_place(self):
        games = [Game('A', 'B', 'draw'), Game('C', 'D', 'draw')]
        ranked, points, breaks = order(['A', 'B', 'C', 'D'], games)
        self.assertEqual(place_numbers(ranked, points, breaks), [1, 1, 1, 1])

    def test_no_players(self):
        self.assertEqual(place_numbers([], {}, {}), [])
