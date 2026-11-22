"""Rating processing (ratings/services.py) and the append-only ledger (ratings/models.py).

`process_round` is the only path that moves ratings, so these tests pin its contract: rate once per round, one
pre-round snapshot, ledger before PoolRating, and unrated rounds that never touch a rating.
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from accounts.models import User
from ratings.models import AppendOnlyError, PoolRating, RatingLedgerEntry, RatingRun
from ratings.services import InvalidRound, append_ledger_entry, process_round

PLAYED_AT = datetime(2026, 11, 10, 18, 0, tzinfo=dt_timezone.utc)
EVENT_ID = uuid.UUID('b6f0f3a8-1f2e-4a3f-9b7c-2f4c0d5e6a11')


class RoundTestCase(TestCase):
    def setUp(self):
        self.alice = self._user('alice@example.com', 'Alice')
        self.bob = self._user('bob@example.com', 'Bob')
        self.carol = self._user('carol@example.com', 'Carol')
        self.round_id = uuid.uuid4()

    @staticmethod
    def _user(email, name):
        return User.objects.create_user(email=email, password='test-pass-1', name=name)

    def payload(self, *, score=1.0, rated=True, pool='rapid', pairings=None, **overrides):
        data = {
            'event': {'id': str(EVENT_ID), 'slug': 'saturday-social', 'title': 'Saturday Social'},
            'pool': pool,
            'rated': rated,
            'played_at': PLAYED_AT.isoformat(),
            'pairings': pairings if pairings is not None else [
                {'player1_id': str(self.alice.pk), 'player2_id': str(self.bob.pk), 'score': score},
            ],
        }
        data.update(overrides)
        return data

    def rating_of(self, user, pool='rapid'):
        return PoolRating.objects.get(user=user, pool=pool)


class RatedRoundTests(RoundTestCase):
    def test_a_rated_round_moves_both_players_and_writes_both_ledger_rows(self):
        outcome = process_round(self.round_id, self.payload())

        self.assertEqual((outcome.rated, outcome.players, outcome.ledger_rows), (True, 2, 2))
        self.assertFalse(outcome.already_processed)
        self.assertGreater(self.rating_of(self.alice).rating, 1500)
        self.assertLess(self.rating_of(self.bob).rating, 1500)
        self.assertEqual(self.rating_of(self.alice).games, 1)
        self.assertEqual(self.rating_of(self.bob).games, 1)
        self.assertEqual(self.rating_of(self.alice).last_updated, PLAYED_AT)

    def test_the_ledger_records_outcome_arithmetic_and_the_opponent(self):
        process_round(self.round_id, self.payload())
        won = RatingLedgerEntry.objects.get(user=self.alice, pool='rapid')
        lost = RatingLedgerEntry.objects.get(user=self.bob, pool='rapid')

        self.assertEqual((won.outcome, lost.outcome), ('win', 'loss'))
        self.assertEqual((won.before, lost.before), (1500, 1500))
        self.assertEqual(won.after, round(self.rating_of(self.alice).rating))
        self.assertEqual(won.delta, won.after - won.before)
        self.assertTrue(won.rated)
        self.assertEqual((won.opponent_id, lost.opponent_id), (self.bob.pk, self.alice.pk))
        self.assertEqual((won.event_id, won.event_slug, won.event_title),
                         (EVENT_ID, 'saturday-social', 'Saturday Social'))
        self.assertEqual(won.round_id, self.round_id)
        self.assertEqual(won.created, PLAYED_AT)

    def test_a_draw_hands_out_half_a_point_to_each_side(self):
        process_round(self.round_id, self.payload(score=0.5))
        self.assertEqual([e.outcome for e in RatingLedgerEntry.objects.filter(pool='rapid')], ['draw', 'draw'])

    def test_a_black_win_is_the_second_players_win(self):
        process_round(self.round_id, self.payload(score=0.0))
        self.assertEqual(RatingLedgerEntry.objects.get(user=self.alice).outcome, 'loss')
        self.assertEqual(RatingLedgerEntry.objects.get(user=self.bob).outcome, 'win')

    def test_both_players_are_rated_from_the_same_pre_round_snapshot(self):
        PoolRating.objects.create(user=self.alice, pool='rapid', rating=1700, rd=60)
        PoolRating.objects.create(user=self.bob, pool='rapid', rating=1300, rd=60)
        process_round(self.round_id, self.payload())
        # Alice was the favourite: a win moves her less than 1700 - 1500 would from equal footing, and the pair's
        # deltas still mirror each other because neither saw the other's new value.
        entries = {e.user_id: e for e in RatingLedgerEntry.objects.filter(pool='rapid')}
        self.assertEqual(entries[self.alice.pk].before, 1700)
        self.assertEqual(entries[self.bob.pk].before, 1300)
        self.assertEqual(entries[self.alice.pk].delta, -entries[self.bob.pk].delta)

    def test_ratings_are_clamped_to_the_published_range(self):
        PoolRating.objects.create(user=self.alice, pool='rapid', rating=4000, rd=30)
        PoolRating.objects.create(user=self.bob, pool='rapid', rating=0, rd=30)
        process_round(self.round_id, self.payload())
        self.assertLessEqual(self.rating_of(self.alice).rating, 4000)
        self.assertGreaterEqual(self.rating_of(self.bob).rating, 0)
        for entry in RatingLedgerEntry.objects.filter(pool='rapid'):
            self.assertEqual(entry.after, entry.before + entry.delta)

    def test_pools_are_rated_independently(self):
        process_round(self.round_id, self.payload(pool='rapid'))
        self.assertEqual(self.rating_of(self.alice, 'rapid').games, 1)
        self.assertFalse(PoolRating.objects.filter(user=self.alice, pool='blitz').exists())


class IdempotencyTests(RoundTestCase):
    def test_a_second_call_returns_the_first_outcome_and_changes_nothing(self):
        first = process_round(self.round_id, self.payload())
        rows = RatingLedgerEntry.objects.count()
        ratings = {pr.user_id: (pr.rating, pr.rd, pr.volatility) for pr in PoolRating.objects.all()}

        second = process_round(self.round_id, self.payload(score=0.0))

        self.assertTrue(second.already_processed)
        self.assertEqual((second.rated, second.players, second.ledger_rows),
                         (first.rated, first.players, first.ledger_rows))
        self.assertEqual(RatingLedgerEntry.objects.count(), rows)
        self.assertEqual(RatingRun.objects.count(), 1)
        self.assertEqual({pr.user_id: (pr.rating, pr.rd, pr.volatility) for pr in PoolRating.objects.all()}, ratings)

    def test_a_different_round_id_is_a_new_round(self):
        process_round(self.round_id, self.payload())
        process_round(uuid.uuid4(), self.payload())
        self.assertEqual(RatingLedgerEntry.objects.count(), 4)
        self.assertEqual(self.rating_of(self.alice).games, 2)


class UnratedRoundTests(RoundTestCase):
    def test_an_unrated_round_writes_ledger_rows_without_any_rating_movement(self):
        outcome = process_round(self.round_id, self.payload(rated=False))

        self.assertFalse(outcome.rated)
        self.assertEqual(outcome.ledger_rows, 2)
        self.assertFalse(PoolRating.objects.exists())
        for entry in RatingLedgerEntry.objects.all():
            self.assertFalse(entry.rated)
            self.assertEqual((entry.before, entry.after, entry.delta), (None, None, None))

    def test_an_unrated_round_leaves_an_existing_rating_untouched(self):
        PoolRating.objects.create(user=self.alice, pool='rapid', rating=1600, rd=90, games=5)
        process_round(self.round_id, self.payload(rated=False))
        rating = self.rating_of(self.alice)
        self.assertEqual((rating.rating, rating.rd, rating.games), (1600, 90, 5))


class PlayerSelectionTests(RoundTestCase):
    def test_a_player_who_sat_out_is_not_rated_and_gets_no_ledger_row(self):
        process_round(self.round_id, self.payload())
        self.assertFalse(PoolRating.objects.filter(user=self.carol).exists())
        self.assertFalse(RatingLedgerEntry.objects.filter(user=self.carol).exists())

    def test_two_pairings_are_rated_in_the_same_period(self):
        dave = self._user('dave@example.com', 'Dave')
        outcome = process_round(self.round_id, self.payload(pairings=[
            {'player1_id': str(self.alice.pk), 'player2_id': str(self.bob.pk), 'score': 1.0},
            {'player1_id': str(self.carol.pk), 'player2_id': str(dave.pk), 'score': 1.0},
        ]))
        self.assertEqual((outcome.players, outcome.ledger_rows), (4, 4))
        self.assertEqual(PoolRating.objects.count(), 4)
        self.assertEqual(PoolRating.objects.filter(games=1).count(), 4)

    def test_an_unknown_player_aborts_the_whole_round(self):
        stranger = uuid.uuid4()
        payload = self.payload(pairings=[
            {'player1_id': str(self.alice.pk), 'player2_id': str(self.bob.pk), 'score': 1.0},
            {'player1_id': str(self.carol.pk), 'player2_id': str(stranger), 'score': 1.0},
        ])
        with self.assertRaises(InvalidRound):
            process_round(self.round_id, payload)
        self.assertFalse(RatingRun.objects.exists())
        self.assertFalse(RatingLedgerEntry.objects.exists())
        self.assertFalse(PoolRating.objects.exists())


class InvalidPayloadTests(RoundTestCase):
    def assertInvalid(self, payload, message):
        with self.assertRaises(InvalidRound) as caught:
            process_round(self.round_id, payload)
        self.assertEqual(str(caught.exception), message)
        self.assertFalse(RatingRun.objects.exists())

    def test_the_payload_must_be_an_object(self):
        self.assertInvalid(['rapid'], 'The round must be an object.')

    def test_pool_must_be_a_known_pool(self):
        self.assertInvalid(self.payload(pool='ultra'), 'pool must be blitz, rapid or classical.')

    def test_rated_must_be_a_boolean(self):
        self.assertInvalid(self.payload(rated='yes'), 'rated must be true or false.')

    def test_the_event_is_required(self):
        payload = self.payload()
        del payload['event']
        self.assertInvalid(payload, 'event is required.')

    def test_event_identity_fields_are_validated(self):
        self.assertInvalid(self.payload(event={'id': 'nope', 'slug': 'saturday-social', 'title': 'Saturday Social'}),
                           'event.id must be a UUID.')
        self.assertInvalid(self.payload(event={'id': str(EVENT_ID), 'slug': 'Bad Slug', 'title': 'Saturday Social'}),
                           'event.slug is invalid.')
        self.assertInvalid(self.payload(event={'id': str(EVENT_ID), 'slug': 'saturday-social', 'title': '   '}),
                           'event.title is invalid.')

    def test_pairings_must_be_a_non_empty_list(self):
        self.assertInvalid(self.payload(pairings=[]), 'pairings must be a non-empty list.')

    def test_a_pairing_must_be_an_object(self):
        self.assertInvalid(self.payload(pairings=['alice vs bob']), 'Each pairing must be an object.')

    def test_scores_are_limited_to_one_half_and_zero(self):
        for score in (0.7, 2, -1, True):
            with self.subTest(score=score):
                self.assertInvalid(self.payload(score=score), 'score must be 1, 0.5 or 0.')

    def test_a_player_cannot_play_themselves(self):
        self.assertInvalid(self.payload(pairings=[
            {'player1_id': str(self.alice.pk), 'player2_id': str(self.alice.pk), 'score': 1.0}]),
            'A player cannot play themselves.')

    def test_a_player_can_appear_only_once_per_round(self):
        self.assertInvalid(self.payload(pairings=[
            {'player1_id': str(self.alice.pk), 'player2_id': str(self.bob.pk), 'score': 1.0},
            {'player1_id': str(self.alice.pk), 'player2_id': str(self.carol.pk), 'score': 0.0},
        ]), 'A player can appear only once per round.')

    def test_played_at_must_parse_when_given(self):
        self.assertInvalid(self.payload(played_at='last tuesday'), 'played_at must be an ISO datetime.')

    def test_played_at_defaults_to_now(self):
        payload = self.payload()
        del payload['played_at']
        process_round(self.round_id, payload)
        self.assertLess(abs(RatingLedgerEntry.objects.get(user=self.alice).created - datetime.now(dt_timezone.utc)),
                        timedelta(minutes=1))


class AppendOnlyLedgerTests(RoundTestCase):
    def setUp(self):
        super().setUp()
        process_round(self.round_id, self.payload())
        self.entry = RatingLedgerEntry.objects.get(user=self.alice, pool='rapid')

    def test_an_existing_row_cannot_be_saved_again(self):
        self.entry.delta = 999
        with self.assertRaises(AppendOnlyError):
            self.entry.save()

    def test_a_row_cannot_be_deleted(self):
        with self.assertRaises(AppendOnlyError):
            self.entry.delete()

    def test_the_queryset_cannot_update_or_delete(self):
        with self.assertRaises(AppendOnlyError):
            RatingLedgerEntry.objects.filter(pk=self.entry.pk).update(delta=0)
        with self.assertRaises(AppendOnlyError):
            RatingLedgerEntry.objects.filter(pk=self.entry.pk).delete()

    def test_the_append_helper_validates_arithmetic_and_rated_rows(self):
        with self.assertRaises(ValidationError):
            append_ledger_entry(user=self.alice, pool='rapid', event_id=EVENT_ID, event_slug='saturday-social',
                                event_title='Saturday Social', outcome='win', rated=True,
                                before=1500, after=1500, delta=10)

    def test_the_database_itself_rejects_arithmetic_that_does_not_add_up(self):
        # A raw insert skips full_clean, so this is the check constraint, not the model.
        with transaction.atomic(), self.assertRaises(IntegrityError):
            RatingLedgerEntry.objects.create(user=self.alice, pool='rapid', event_id=EVENT_ID,
                                             event_slug='saturday-social', event_title='Saturday Social',
                                             outcome='win', rated=True, before=1500, after=1500, delta=10)

    def test_manual_entries_may_repeat_because_their_round_id_is_null(self):
        for _ in range(2):
            append_ledger_entry(user=self.alice, pool='rapid', event_id=EVENT_ID, event_slug='saturday-social',
                                event_title='Saturday Social', outcome='win', rated=True,
                                before=1500, after=1516, delta=16)
        self.assertEqual(RatingLedgerEntry.objects.filter(user=self.alice, round_id__isnull=True).count(), 2)

    def test_a_round_is_recorded_once_per_player_and_pool(self):
        fields = dict(user=self.alice, pool='rapid', event_id=EVENT_ID, event_slug='saturday-social',
                      event_title='Saturday Social', round_id=self.round_id, outcome='win', rated=True,
                      before=1500, after=1516, delta=16)
        with self.assertRaises(ValidationError):
            append_ledger_entry(**fields)
        with transaction.atomic(), self.assertRaises(IntegrityError):
            RatingLedgerEntry.objects.create(**fields)
