"""Public standings (registrations/room.py::standings): final results only, tie-breaks, places, identity toggles.

The tie-break maths itself is covered in test_tiebreaks.py; these tests pin how a round's pairings become the public
table: what counts, what is counted for an unfinished game, and what may never be exposed.
"""
import json
from unittest.mock import patch

from django.test import TestCase

from accounts.models import User
from content.models import Event
from ratings.models import PoolRating
from registrations.dto import HIDDEN_NAME
from registrations.models import Pairing, Round
from registrations.room import public_rows, standings


class StandingsTestCase(TestCase):
    def setUp(self):
        self.event = Event.objects.create(title='Saturday Social', slug='saturday-social', type='social')
        self.users = {
            name: User.objects.create_user(email=f'{name.lower()}@example.com', password='test-pass-1', name=name)
            for name in ('Alice', 'Bob', 'Carol', 'Dave', 'Erin')
        }
        self.round1 = self._round(1)
        self.round2 = self._round(2)

    def _round(self, number):
        return Round.objects.create(event=self.event, number=number, state='completed')

    def game(self, rnd, board, white, black, outcome=None, state='final'):
        return Pairing.objects.create(
            round=rnd,
            board=board,
            white=self.users[white],
            black=self.users[black],
            result_state=state,
            outcome=outcome if state == 'final' else None,
        )

    def bye(self, rnd, board, player):
        return Pairing.objects.create(
            round=rnd, board=board, white=self.users[player], black=None, is_bye=True,
            result_state='final', outcome='white',
        )

    def table(self, *rounds):
        """(name, place, score, rounds, buchholz) per row, in table order."""
        rows = standings(self.event, list(rounds))
        return [
            (row['identity']['displayName'], row['place'], row['score'], row['rounds'], row['buchholz'])
            for row in rows
        ]

    def rows_by_user(self, *rounds):
        return {row['_uid']: row for row in standings(self.event, list(rounds))}


class ResultCountingTests(StandingsTestCase):
    def test_only_final_results_score_and_an_unfinished_game_counts_no_round(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')
        self.game(self.round1, 2, 'Carol', 'Dave', state='submitted')

        self.assertEqual(self.table(self.round1), [
            ('Alice', 1, 1.0, 1, 0.0),
            ('Bob', 2, 0.0, 1, 1.0),
            ('Carol', 3, 0.0, 0, 0.0),
            ('Dave', 3, 0.0, 0, 0.0),
        ])

    def test_a_submitted_win_is_not_scored(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'white', state='submitted')
        scores = {name: score for name, _place, score, _rounds, _bh in self.table(self.round1)}
        self.assertEqual(scores, {'Alice': 0.0, 'Bob': 0.0})

    def test_a_draw_gives_half_a_point_to_each_side(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'draw')
        self.assertEqual(self.table(self.round1), [
            ('Alice', 1, 0.5, 1, 0.5),
            ('Bob', 1, 0.5, 1, 0.5),
        ])

    def test_a_black_win_scores_the_second_player(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'black')
        scores = {name: score for name, _place, score, _rounds, _bh in self.table(self.round1)}
        self.assertEqual(scores, {'Alice': 0.0, 'Bob': 1.0})

    def test_a_bye_is_a_full_point_and_one_round(self):
        self.bye(self.round1, 1, 'Alice')
        self.assertEqual(self.table(self.round1), [('Alice', 1, 1.0, 1, 1.0)])

    def test_an_event_without_pairings_has_no_standings(self):
        self.assertEqual(standings(self.event, [self.round1]), [])


class OrderTests(StandingsTestCase):
    def test_a_true_tie_shares_the_place(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')
        self.game(self.round1, 2, 'Carol', 'Dave', 'white')
        self.assertEqual(self.table(self.round1), [
            ('Alice', 1, 1.0, 1, 0.0),
            ('Carol', 1, 1.0, 1, 0.0),
            ('Bob', 3, 0.0, 1, 1.0),
            ('Dave', 3, 0.0, 1, 1.0),
        ])

    def test_buchholz_decides_before_the_name(self):
        self.game(self.round1, 1, 'Alice', 'Dave', 'white')
        self.game(self.round1, 2, 'Carol', 'Bob', 'white')
        self.game(self.round2, 1, 'Bob', 'Erin', 'white')

        self.assertEqual(self.table(self.round1, self.round2), [
            ('Carol', 1, 1.0, 1, 1.0),
            ('Bob', 2, 1.0, 2, 1.0),
            ('Alice', 3, 1.0, 1, 0.0),
            ('Dave', 4, 0.0, 1, 1.0),
            ('Erin', 4, 0.0, 1, 1.0),
        ])

    def test_sonneborn_berger_decides_when_points_and_buchholz_are_level(self):
        # Carol and Bob both finish on 1 point with Buchholz 1. Carol beat Bob (who scored 1), so her
        # Sonneborn-Berger is 1 against Bob's 0.
        self.game(self.round1, 1, 'Carol', 'Bob', 'white')
        self.game(self.round1, 2, 'Bob', 'Erin', 'white')
        self.assertEqual(self.table(self.round1), [
            ('Carol', 1, 1.0, 1, 1.0),
            ('Bob', 2, 1.0, 2, 1.0),
            ('Erin', 3, 0.0, 1, 1.0),
        ])

    def test_only_final_results_feed_the_tie_breaks(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')
        self.game(self.round2, 1, 'Bob', 'Carol', 'white', state='submitted')

        rows = self.rows_by_user(self.round1, self.round2)
        self.assertEqual(rows[self.users['Alice'].pk]['score'], 1.0)
        self.assertEqual(rows[self.users['Alice'].pk]['buchholz'], 0.0)  # Bob's submitted win does not count
        self.assertEqual(rows[self.users['Bob'].pk]['score'], 0.0)

    def test_at_most_max_standings_rows_are_returned(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')
        self.game(self.round1, 2, 'Carol', 'Dave', 'white')
        with patch('registrations.room.MAX_STANDINGS', 2):
            self.assertEqual(len(standings(self.event, [self.round1])), 2)


class IdentityTests(StandingsTestCase):
    def test_rows_carry_no_internal_ids_publicly(self):
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')
        rows = standings(self.event, [self.round1])
        self.assertIn('_uid', rows[0])

        public = public_rows(rows)
        self.assertEqual(set(public[0]), {'place', 'identity', 'score', 'rounds', 'rating', 'buchholz'})
        serialized = json.dumps(public)
        for user in self.users.values():
            self.assertNotIn(str(user.pk), serialized)

    def test_the_rating_comes_from_the_events_pool(self):
        self.event.rating_pool = 'blitz'
        self.event.save()
        PoolRating.objects.create(user=self.users['Alice'], pool='blitz', rating=1750, games=1)
        PoolRating.objects.create(user=self.users['Alice'], pool='rapid', rating=1200, games=1)
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')

        rows = self.rows_by_user(self.round1)
        self.assertEqual(rows[self.users['Alice'].pk]['identity']['rating'], {'pool': 'blitz', 'value': 1750})

    def test_a_pool_rating_with_no_rated_games_is_ignored(self):
        self.event.rating_pool = 'rapid'
        self.event.save()
        PoolRating.objects.create(user=self.users['Alice'], pool='rapid', rating=1750, games=0)
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')

        rows = self.rows_by_user(self.round1)
        self.assertIsNone(rows[self.users['Alice'].pk]['identity']['rating'])

    def test_a_player_who_hides_ratings_shows_none(self):
        self.event.rating_pool = 'rapid'
        self.event.save()
        self.users['Bob'].show_ratings = False
        self.users['Bob'].save()
        PoolRating.objects.create(user=self.users['Bob'], pool='rapid', rating=1800, games=1)
        self.game(self.round1, 1, 'Alice', 'Bob', 'white')

        rows = self.rows_by_user(self.round1)
        self.assertIsNone(rows[self.users['Bob'].pk]['identity']['rating'])

    def test_a_player_who_hides_their_name_is_shown_as_hidden(self):
        self.game(self.round1, 1, 'Alice', 'Carol', 'white')
        self.users['Carol'].show_display_name = False
        self.users['Carol'].save()

        rows = self.rows_by_user(self.round1)
        self.assertEqual(rows[self.users['Carol'].pk]['identity']['displayName'], HIDDEN_NAME)
