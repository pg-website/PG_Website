"""Completing an event (E10): the standings built from the finalised rounds are stored on the event and must pass the
model's stored-standings check. Regression: the standings rows gained a `buchholz` key and completing failed with
"standings[0].buchholz: unknown field".
"""
from datetime import timedelta

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import timezone

from accounts.models import User
from content import validation as v
from content.models import Event
from core.errors import ValidationFailed
from registrations.models import Pairing, Round

from . import event_service as svc

IDENTITY = {'displayName': 'Alice', 'initials': 'A', 'rating': None, 'cityChapter': None}


def row(**overrides):
    base = {'place': 1, 'identity': IDENTITY, 'score': 1.5, 'rounds': 2, 'rating': None}
    base.update(overrides)
    return base


class StoredStandingsCheckTests(SimpleTestCase):
    def test_a_row_with_buchholz_is_accepted(self):
        v.check_standings([row(buchholz=3.5)], 'standings')

    def test_a_row_without_buchholz_is_still_accepted(self):
        v.check_standings([row()], 'standings')

    def test_buchholz_must_be_a_non_negative_number(self):
        for bad in (-1, 'high', None, True):
            with self.subTest(buchholz=bad), self.assertRaises(v.ContentError):
                v.check_standings([row(buchholz=bad)], 'standings')

    def test_other_unknown_fields_are_still_rejected(self):
        with self.assertRaises(v.ContentError) as raised:
            v.check_standings([row(sonnebornBerger=2)], 'standings')
        self.assertEqual(raised.exception.messages, ['standings[0].sonnebornBerger: unknown field'])


class CompleteEventTests(TestCase):
    def setUp(self):
        started = timezone.now() - timedelta(hours=4)
        self.event = Event.objects.create(
            title='Saturday Rapid', slug='saturday-rapid', type='rated_tournament', status='ongoing',
            starts_at=started, ends_at=started + timedelta(hours=3), time_control='10+5', pairing_mode='swiss',
            experience={'eyebrow': '', 'heading': 'Saturday Rapid', 'body': '', 'highlights': []},
            at_a_glance={'membershipRequired': False, 'hostedArrival': True},
        )
        self.admin = User.objects.create_user(email='admin@example.com', password='test-pass-1', name='Admin')
        self.admin.role = 'admin'
        self.admin.save(update_fields=['role'])
        names = ('Alice', 'Bob', 'Carol', 'Dave', 'Erin')
        self.users = {
            n: User.objects.create_user(email=f'{n.lower()}@example.com', password='test-pass-1', name=n) for n in names
        }
        self.request = RequestFactory().post('/api/admin/events/x/complete')
        self.request.user = self.admin

    def _round(self, number, games, byes=()):
        rnd = Round.objects.create(event=self.event, number=number, state='completed')
        board = 0
        for white, black, outcome in games:
            board += 1
            Pairing.objects.create(round=rnd, board=board, white=self.users[white], black=self.users[black],
                                   result_state='final', outcome=outcome)
        for player in byes:
            board += 1
            Pairing.objects.create(round=rnd, board=board, white=self.users[player], black=None, is_bye=True,
                                   result_state='final', outcome='white')
        return rnd

    def test_completing_an_event_with_finished_rounds_stores_standings_with_buchholz(self):
        self._round(1, [('Alice', 'Bob', 'white'), ('Carol', 'Dave', 'draw')], byes=['Erin'])
        self._round(2, [('Alice', 'Carol', 'white'), ('Bob', 'Erin', 'black')], byes=['Dave'])

        event, _ = svc.complete(self.request, str(self.event.pk), publish_archive=None)

        event.refresh_from_db()
        self.assertEqual(event.status, 'completed')
        self.assertEqual(event.rounds_played, 2)
        self.assertEqual(len(event.standings), 5)
        # Erin and Alice both finish on 2 points; Erin's opponents scored more (Buchholz 2.0 against 0.5).
        table = [(r['identity']['displayName'], r['place'], r['score'], r['buchholz']) for r in event.standings]
        self.assertEqual(table, [('Erin', 1, 2.0, 2.0), ('Alice', 2, 2.0, 0.5), ('Dave', 3, 1.5, 2.0),
                                 ('Carol', 4, 0.5, 3.5), ('Bob', 5, 0.0, 4.0)])
        self.assertEqual(event.winner, event.standings[0]['identity'])

    def test_stored_standings_are_public_rows_without_internal_keys(self):
        self._round(1, [('Alice', 'Bob', 'white')], byes=['Carol'])

        event, _ = svc.complete(self.request, str(self.event.pk), publish_archive=None)

        for r in event.standings:
            self.assertFalse([k for k in r if k.startswith('_')])

    def test_completing_an_event_without_rounds_still_works(self):
        event, _ = svc.complete(self.request, str(self.event.pk), publish_archive=None)

        self.assertEqual(event.status, 'completed')
        self.assertEqual(event.standings, [])

    def test_an_event_that_has_not_started_cannot_be_completed(self):
        self.event.starts_at = timezone.now() + timedelta(days=1)
        self.event.ends_at = self.event.starts_at + timedelta(hours=3)
        self.event.save()  # setUp's save already passed model validation, so this does too

        with self.assertRaises(ValidationFailed):
            svc.complete(self.request, str(self.event.pk), publish_archive=None)
