"""Pairing engine (contract C07): Swiss and social-balanced pairing. Pure functions, no database or clock.

Intent under test: strongest boards first, no rematches while a perfect matching exists, byes to the player who has had
the fewest (then the lowest score, then the lowest rating), and colours that never run three in a row where avoidable.
"""
from django.test import SimpleTestCase

from registrations.pairing_engine import DEFAULT_RATING, Draft, History, Player, build_round


def P(identifier, rating=DEFAULT_RATING, score=0.0) -> Player:
    return Player(identifier, rating=rating, score=score)


def history(*, played=(), colours=None, byes=None) -> History:
    return History(
        played={frozenset(pair) for pair in played},
        colours=colours or {},
        byes=byes or {},
    )


def pair_set(draft: Draft) -> set:
    return {frozenset(board) for board in draft.boards}


FOUR = [P('A', 2000), P('B', 1900), P('C', 1800), P('D', 1700)]


class DraftShapeTests(SimpleTestCase):
    def test_no_players_is_an_empty_draft(self):
        self.assertEqual(build_round([], History(), method='swiss', round_no=1),
                         Draft(boards=[], byes=[], rematches=0))

    def test_one_player_only_gets_a_bye(self):
        draft = build_round([P('A')], History(), method='swiss', round_no=1)
        self.assertEqual((draft.boards, draft.byes), ([], ['A']))

    def test_an_unknown_method_is_refused(self):
        with self.assertRaises(ValueError):
            build_round(FOUR, History(), method='dutch', round_no=1)

    def test_the_same_input_always_builds_the_same_round(self):
        first = build_round(FOUR, history(played=[('A', 'B')]), method='swiss', round_no=2)
        second = build_round(FOUR, history(played=[('A', 'B')]), method='swiss', round_no=2)
        self.assertEqual(first, second)


class SwissFirstRoundTests(SimpleTestCase):
    def test_top_half_plays_bottom_half(self):
        draft = build_round(FOUR, History(), method='swiss', round_no=1)
        self.assertEqual(pair_set(draft), {frozenset({'A', 'C'}), frozenset({'B', 'D'})})
        self.assertEqual(draft.rematches, 0)

    def test_the_strongest_pair_is_board_one(self):
        draft = build_round(FOUR, History(), method='swiss', round_no=1)
        self.assertEqual(frozenset(draft.boards[0]), frozenset({'A', 'C'}))
        self.assertEqual(frozenset(draft.boards[1]), frozenset({'B', 'D'}))

    def test_an_odd_first_round_gives_the_lowest_rated_player_the_bye(self):
        draft = build_round(FOUR + [P('E', 1600)], History(), method='swiss', round_no=1)
        self.assertEqual(draft.byes, ['E'])
        self.assertEqual(pair_set(draft), {frozenset({'A', 'C'}), frozenset({'B', 'D'})})

    def test_scores_from_a_finished_first_round_switch_off_the_half_split(self):
        # Empty `played` but non-zero scores: treated as a later round, where equal scores pair first.
        players = [P('A', 2000, 2.0), P('B', 1900, 1.0), P('C', 1800, 1.0), P('D', 1700, 0.0)]
        self.assertEqual(pair_set(build_round(players, History(), method='swiss', round_no=2)),
                         {frozenset({'A', 'B'}), frozenset({'C', 'D'})})


class SwissLaterRoundTests(SimpleTestCase):
    def test_equal_scores_are_paired_before_different_scores(self):
        players = [P('A', 2000, 2.0), P('B', 1900, 1.0), P('C', 1800, 1.0), P('D', 1700, 0.0)]
        draft = build_round(players, History(), method='swiss', round_no=3)
        self.assertEqual(pair_set(draft), {frozenset({'A', 'B'}), frozenset({'C', 'D'})})

    def test_a_pair_that_already_met_is_avoided(self):
        draft = build_round(FOUR, history(played=[('A', 'B')]), method='swiss', round_no=2)
        self.assertEqual(draft.rematches, 0)
        for pair in pair_set(draft):
            self.assertNotEqual(pair, frozenset({'A', 'B'}))

    def test_six_players_avoid_all_first_round_rematches(self):
        players = [P(x, 2000 - index * 50) for index, x in enumerate('ABCDEF')]
        first = build_round(players, History(), method='swiss', round_no=1)
        second = build_round(players, history(played=first.boards), method='swiss', round_no=2)
        self.assertEqual(second.rematches, 0)
        self.assertEqual(len(second.boards), 3)
        self.assertTrue(pair_set(second).isdisjoint({frozenset(board) for board in first.boards}))

    def test_a_rematch_is_the_last_resort_and_is_reported(self):
        draft = build_round([P('A'), P('B')], history(played=[('A', 'B')]), method='swiss', round_no=2)
        self.assertEqual(pair_set(draft), {frozenset({'A', 'B'})})
        self.assertEqual(draft.rematches, 1)

    def test_boards_run_strongest_first(self):
        players = [P('A', 2000, 3.0), P('B', 1900, 2.0), P('C', 1800, 1.0), P('D', 1700, 0.0)]
        draft = build_round(players, History(), method='swiss', round_no=4)
        self.assertIn('A', draft.boards[0])


class ByeTests(SimpleTestCase):
    def test_the_bye_goes_to_the_player_with_the_fewest_earlier_byes(self):
        players = [P('A', 1400), P('B', 1700), P('C', 1800)]
        draft = build_round(players, history(byes={'A': 1}), method='swiss', round_no=3)
        self.assertEqual(draft.byes, ['B'])  # A is lowest rated but already had one

    def test_the_bye_goes_to_the_lowest_score_next(self):
        players = [P('A', 1400, 1.0), P('B', 1700, 0.5), P('C', 1800, 0.0)]
        draft = build_round(players, History(), method='swiss', round_no=3)
        self.assertEqual(draft.byes, ['C'])

    def test_the_bye_goes_to_the_lowest_rating_when_scores_are_level(self):
        players = [P('A', 1800), P('B', 1700), P('C', 1900)]
        draft = build_round(players, History(), method='swiss', round_no=2)
        self.assertEqual(draft.byes, ['B'])

    def test_the_bye_falls_back_to_the_id_for_a_full_tie(self):
        players = [P('b', 1700), P('a', 1700), P('c', 1700)]
        draft = build_round(players, History(), method='swiss', round_no=2)
        self.assertEqual(draft.byes, ['a'])

    def test_the_bye_player_is_not_seated_and_everyone_else_is(self):
        draft = build_round(FOUR + [P('E', 1600)], History(), method='swiss', round_no=2)
        seated = [player for board in draft.boards for player in board]
        self.assertEqual(draft.byes, ['E'])
        self.assertNotIn('E', seated)
        self.assertEqual(sorted(seated), ['A', 'B', 'C', 'D'])


class ColourTests(SimpleTestCase):
    def test_a_player_with_two_whites_gets_black(self):
        draft = build_round([P('A', 2000), P('B', 1900)], history(colours={'A': ['W', 'W']}),
                            method='swiss', round_no=3)
        self.assertEqual(draft.boards, [('B', 'A')])

    def test_a_player_with_two_blacks_gets_white(self):
        draft = build_round([P('A', 2000), P('B', 1900)], history(colours={'B': ['B', 'B']}),
                            method='swiss', round_no=3)
        self.assertEqual(draft.boards, [('B', 'A')])

    def test_the_player_with_more_blacks_than_whites_gets_white(self):
        draft = build_round([P('A', 2000), P('B', 1900)], history(colours={'A': ['B']}),
                            method='swiss', round_no=3)
        self.assertEqual(draft.boards, [('A', 'B')])

    def test_colours_alternate_for_the_same_pairing_between_rounds(self):
        one = build_round([P('A', 2000), P('B', 1900)], History(), method='swiss', round_no=1)
        two = build_round([P('A', 2000), P('B', 1900)], History(), method='swiss', round_no=2)
        self.assertNotEqual(one.boards[0], two.boards[0])
        self.assertEqual(frozenset(one.boards[0]), frozenset(two.boards[0]))


class SocialBalancedTests(SimpleTestCase):
    def test_nearest_ratings_are_paired_and_scores_are_ignored(self):
        players = [P('A', 2000, 0.0), P('B', 1500, 3.0), P('C', 1000, 1.0), P('D', 990, 0.0)]
        draft = build_round(players, History(), method='social_balanced', round_no=2)
        self.assertEqual(pair_set(draft), {frozenset({'A', 'B'}), frozenset({'C', 'D'})})

    def test_social_still_avoids_a_rematch(self):
        players = [P('A', 2000), P('B', 1950), P('C', 1000), P('D', 990)]
        draft = build_round(players, history(played=[('A', 'B')]), method='social_balanced', round_no=2)
        self.assertEqual(draft.rematches, 0)
        self.assertNotIn(frozenset({'A', 'B'}), pair_set(draft))

    def test_an_odd_social_round_gives_the_lowest_rated_player_the_bye(self):
        players = [P('A', 2000), P('B', 1900), P('C', 1300)]
        draft = build_round(players, History(), method='social_balanced', round_no=1)
        self.assertEqual(draft.byes, ['C'])
        self.assertEqual(pair_set(draft), {frozenset({'A', 'B'})})
