"""Glicko-2 maths (ratings/glicko2.py). Pure functions: no database, no Django models."""
from django.test import SimpleTestCase

from ratings.glicko2 import (DEFAULT_RD, DEFAULT_RATING, GameResult, Rating, compute_period, games_from_pairs,
                             update_rating)


class WorkedExampleTests(SimpleTestCase):
    """Glickman, "Example of the Glicko-2 system", steps 1-8. The paper prints 1464.06 / 151.52 / 0.05999; the
    implementation avoids the paper's rounded intermediates, so the tolerance is 1 decimal on rating and RD."""

    def setUp(self):
        self.after = update_rating(
            Rating(1500.0, 200.0, 0.06),
            [GameResult(1400.0, 30.0, 1.0), GameResult(1550.0, 100.0, 0.0), GameResult(1700.0, 300.0, 0.0)],
            tau=0.5,
        )

    def test_rating_matches_the_paper(self):
        self.assertAlmostEqual(self.after.rating, 1464.06, places=1)

    def test_rating_deviation_matches_the_paper(self):
        self.assertAlmostEqual(self.after.rd, 151.52, places=1)

    def test_volatility_matches_the_paper(self):
        self.assertAlmostEqual(self.after.volatility, 0.05999, places=4)


class DirectionTests(SimpleTestCase):
    def test_a_win_raises_and_a_loss_lowers_rating_against_an_equal_opponent(self):
        win = update_rating(Rating(), [GameResult(DEFAULT_RATING, DEFAULT_RD, 1.0)])
        loss = update_rating(Rating(), [GameResult(DEFAULT_RATING, DEFAULT_RD, 0.0)])
        self.assertGreater(win.rating, DEFAULT_RATING)
        self.assertLess(loss.rating, DEFAULT_RATING)
        self.assertLess(win.rd, DEFAULT_RD)
        self.assertLess(loss.rd, DEFAULT_RD)

    def test_a_draw_against_an_equal_opponent_leaves_the_rating_alone(self):
        draw = update_rating(Rating(), [GameResult(DEFAULT_RATING, DEFAULT_RD, 0.5)])
        self.assertAlmostEqual(draw.rating, DEFAULT_RATING, places=9)
        self.assertLess(draw.rd, DEFAULT_RD)  # the result still carries information

    def test_beating_a_stronger_opponent_gains_more_than_beating_a_weaker_one(self):
        strong = update_rating(Rating(), [GameResult(1800.0, 100.0, 1.0)])
        weak = update_rating(Rating(), [GameResult(1200.0, 100.0, 1.0)])
        self.assertGreater(strong.rating, weak.rating)

    def test_an_uncertain_player_moves_further_than_an_established_one(self):
        newcomer = update_rating(Rating(1500.0, 350.0, 0.06), [GameResult(1500.0, 350.0, 1.0)])
        settled = update_rating(Rating(1500.0, 50.0, 0.06), [GameResult(1500.0, 350.0, 1.0)])
        self.assertGreater(newcomer.rating - 1500.0, settled.rating - 1500.0)


class IdlePeriodTests(SimpleTestCase):
    def test_no_games_leaves_the_rating_and_volatility_alone_but_grows_the_rd(self):
        idle = update_rating(Rating(1500.0, 200.0, 0.06), [])
        self.assertEqual(idle.rating, 1500.0)
        self.assertAlmostEqual(idle.rd, 200.28, places=1)  # sqrt((200/SCALE)^2 + 0.06^2) * SCALE
        self.assertEqual(idle.volatility, 0.06)

    def test_an_idle_period_never_shrinks_the_rd(self):
        idle = update_rating(Rating(), [])
        self.assertGreater(idle.rd, DEFAULT_RD)


class GamesFromPairsTests(SimpleTestCase):
    def test_each_side_sees_the_pre_period_opponent_and_the_mirrored_score(self):
        snapshot = {'A': Rating(), 'B': Rating(1700.0, 40.0, 0.05)}
        games = games_from_pairs(snapshot, [('A', 'B', 1.0)])
        self.assertEqual(games['A'], [GameResult(1700.0, 40.0, 1.0)])
        self.assertEqual(games['B'], [GameResult(DEFAULT_RATING, DEFAULT_RD, 0.0)])

    def test_a_draw_hands_both_sides_half_a_point(self):
        snapshot = {'A': Rating(), 'B': Rating()}
        games = games_from_pairs(snapshot, [('A', 'B', 0.5)])
        self.assertEqual([g.score for g in games['A']], [0.5])
        self.assertEqual([g.score for g in games['B']], [0.5])


class ComputePeriodTests(SimpleTestCase):
    def test_the_snapshot_is_not_mutated(self):
        snapshot = {'A': Rating(), 'B': Rating()}
        before = dict(snapshot)
        compute_period(snapshot, games_from_pairs(snapshot, [('A', 'B', 1.0)]))
        self.assertEqual(snapshot, before)

    def test_both_players_are_rated_from_the_same_pre_period_values(self):
        snapshot = {'A': Rating(), 'B': Rating()}
        new = compute_period(snapshot, games_from_pairs(snapshot, [('A', 'B', 1.0)]))
        self.assertAlmostEqual(new['A'].rating - 1500.0, 1500.0 - new['B'].rating, places=6)

    def test_a_player_without_results_only_gets_a_looser_rd(self):
        snapshot = {'A': Rating(), 'B': Rating(), 'C': Rating()}
        new = compute_period(snapshot, games_from_pairs(snapshot, [('A', 'B', 1.0)]))
        self.assertEqual(new['C'].rating, DEFAULT_RATING)
        self.assertGreater(new['C'].rd, DEFAULT_RD)
        self.assertLess(new['A'].rd, DEFAULT_RD)

    def test_every_snapshot_key_is_returned(self):
        snapshot = {'A': Rating(), 'B': Rating(), 'C': Rating()}
        self.assertEqual(set(compute_period(snapshot, {})), {'A', 'B', 'C'})
