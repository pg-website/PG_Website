"""Tests for the Event Builder resource (E02-E06): create/PATCH parsing, publish readiness, locked fields, lifecycle
capabilities and the draft DTO. Pure parsing runs without a database; anything that locks on registrations or reads
media galleries uses TestCase.
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from accounts.models import User
from content.models import MAX_PAISE, Event, MediaAsset, MediaCollection, MediaCollectionItem
from core.errors import EventNotFound, ValidationFailed
from payments.models import PaymentOrder
from registrations import conf as reg_conf
from registrations.models import Registration

from . import event_builder as eb

NOW = datetime(2026, 11, 16, 12, 0, tzinfo=dt_timezone.utc)


def failures(fn, *args):
    """Call fn and return its `fields` error map; fail the test if it does not raise ValidationFailed."""
    try:
        fn(*args)
    except ValidationFailed as exc:
        return exc.fields
    raise AssertionError('ValidationFailed was not raised')


def draft_fields(**overrides):
    """A draft row that is publishable as-is (no capacity cap, no description, no media)."""
    fields = {
        'title': 'Saturday Social',
        'slug': 'saturday-social',
        'type': 'social',
        'starts_at': NOW + timedelta(days=7),
        'ends_at': NOW + timedelta(days=7, hours=3),
        'time_control': '10+5',
        'pairing_mode': 'none',
    }
    fields.update(overrides)
    return fields


def draft_event(**overrides) -> Event:
    """An unsaved Event row: every function under test here is pure over the row."""
    return Event(**draft_fields(**overrides))


# ---------------------------------------------------------------- lookups

class ParseEventIdTests(SimpleTestCase):
    def test_valid_uuid_string_returns_the_uuid(self):
        raw = '3f1d7a52-9a4e-4b7e-9a51-2c8f0b7d6e10'
        self.assertEqual(eb.parse_event_id(raw), uuid.UUID(raw))

    def test_any_other_shape_is_event_not_found(self):
        for raw in ('not-a-uuid', '', None, 42, ['x']):
            with self.subTest(raw=raw), self.assertRaises(EventNotFound):
                eb.parse_event_id(raw)


# ---------------------------------------------------------------- E02 create

class ParseCreateTests(SimpleTestCase):
    def test_minimal_payload_defaults_type_and_leaves_slug_empty(self):
        self.assertEqual(eb.parse_create({'title': 'Saturday Social'}),
                         {'title': 'Saturday Social', 'type': 'social', 'slug': None})

    def test_trims_the_title_and_accepts_an_explicit_type_and_slug(self):
        out = eb.parse_create({'title': '  Saturday Social  ', 'type': 'rated_tournament', 'slug': 'saturday-social'})
        self.assertEqual(out, {'title': 'Saturday Social', 'type': 'rated_tournament', 'slug': 'saturday-social'})

    def test_a_blank_title_is_required(self):
        self.assertEqual(failures(eb.parse_create, {'title': '   '}), {'title': ['This is required.']})

    def test_a_missing_title_is_required(self):
        self.assertEqual(failures(eb.parse_create, {'type': 'social'}), {'title': ['This is required.']})

    def test_a_title_over_120_characters_is_rejected(self):
        self.assertEqual(failures(eb.parse_create, {'title': 'x' * 121}),
                         {'title': ['Use at most 120 characters.']})

    def test_html_in_the_title_is_rejected(self):
        self.assertEqual(failures(eb.parse_create, {'title': 'Chess <b>night</b>'}),
                         {'title': ['HTML is not allowed.']})

    def test_a_non_string_title_is_rejected(self):
        self.assertEqual(failures(eb.parse_create, {'title': 7}), {'title': ['Enter text.']})

    def test_an_empty_slug_means_no_slug(self):
        self.assertIsNone(eb.parse_create({'title': 'Saturday Social', 'slug': ''})['slug'])

    def test_invalid_slugs_are_rejected(self):
        for slug in ('Saturday Social', 'ab', '-leading', 'double--hyphen', 'x' * 81):
            with self.subTest(slug=slug):
                self.assertEqual(failures(eb.parse_create, {'title': 'Saturday Social', 'slug': slug}),
                                 {'slug': ['Use 3 to 80 lowercase letters, digits and single hyphens.']})

    def test_unknown_fields_cannot_be_set_on_create(self):
        self.assertEqual(failures(eb.parse_create, {'title': 'Saturday Social', 'capacity': 24}),
                         {'capacity': ['This field cannot be changed here.']})

    def test_an_unknown_type_is_rejected(self):
        self.assertEqual(failures(eb.parse_create, {'title': 'Saturday Social', 'type': 'gala'}),
                         {'type': ['Choose one of the listed options.']})

    def test_a_non_object_payload_is_a_form_error(self):
        self.assertEqual(failures(eb.parse_create, ['Saturday Social']), {'form': ['Send a JSON object.']})


# ---------------------------------------------------------------- E04 PATCH

class ParsePatchEnvelopeTests(SimpleTestCase):
    def test_the_version_you_loaded_is_required(self):
        self.assertEqual(failures(eb.parse_patch, {'basics': {'title': 'Saturday Social'}}),
                         {'version': ['Send the version you loaded.']})

    def test_the_version_must_not_be_a_boolean(self):
        self.assertEqual(failures(eb.parse_patch, {'version': True}), {'version': ['Send the version you loaded.']})

    def test_a_non_object_payload_is_a_form_error(self):
        self.assertEqual(failures(eb.parse_patch, 'basics'), {'form': ['Send a JSON object.']})

    def test_top_level_status_and_unknown_steps_cannot_be_patched(self):
        got = failures(eb.parse_patch, {'version': 3, 'status': 'published', 'readiness': {}})
        self.assertEqual(got, {'status': ['This field cannot be changed here.'],
                               'readiness': ['This field cannot be changed here.']})

    def test_unknown_fields_inside_a_step_cannot_be_patched(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'basics': {'colour': 'red'}}),
                         {'basics.colour': ['This field cannot be changed here.']})

    def test_untouched_steps_are_left_out_of_the_result(self):
        version, out = eb.parse_patch({'version': 4, 'basics': {'title': 'Saturday Social'}})
        self.assertEqual((version, out), (4, {'basics': {'title': 'Saturday Social'}}))


class ParsePatchBasicsTests(SimpleTestCase):
    def test_a_draft_may_blank_the_title(self):
        _, out = eb.parse_patch({'version': 1, 'basics': {'title': '   '}})
        self.assertEqual(out['basics']['title'], '')

    def test_an_empty_or_null_slug_clears_it(self):
        for raw in (None, ''):
            with self.subTest(raw=raw):
                _, out = eb.parse_patch({'version': 1, 'basics': {'slug': raw}})
                self.assertIsNone(out['basics']['slug'])

    def test_an_invalid_slug_is_rejected(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'basics': {'slug': 'Saturday Social'}}),
                         {'basics.slug': ['Use 3 to 80 lowercase letters, digits and single hyphens.']})

    def test_an_offset_date_time_is_parsed_to_an_instant(self):
        _, out = eb.parse_patch({'version': 1, 'basics': {'startsAt': '2026-12-01T18:00:00+05:30'}})
        self.assertEqual(out['basics']['startsAt'],
                         datetime(2026, 12, 1, 12, 30, tzinfo=dt_timezone.utc))

    def test_a_date_time_without_a_utc_offset_is_rejected(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'basics': {'startsAt': '2026-12-01T18:00:00'}}),
                         {'basics.startsAt': ['Use an ISO 8601 date-time with a UTC offset.']})

    def test_a_non_date_time_value_is_rejected(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'basics': {'endsAt': 1860000000}}),
                         {'basics.endsAt': ['Use an ISO 8601 date-time with a UTC offset.']})

    def test_type_and_audience_are_closed_to_the_listed_options(self):
        got = failures(eb.parse_patch, {'version': 1, 'basics': {'type': 'gala', 'audience': 'experts'}})
        self.assertEqual(got, {'basics.type': ['Choose one of the listed options.'],
                               'basics.audience': ['Choose one of the listed options.']})

    def test_text_limits_are_enforced_per_field(self):
        got = failures(eb.parse_patch, {'version': 1, 'basics': {'promise': 'x' * 201,
                                                                 'address': 'y' * 301}})
        self.assertEqual(got, {'basics.promise': ['Use at most 200 characters.'],
                               'basics.address': ['Use at most 300 characters.']})


class ParsePatchExperienceTests(SimpleTestCase):
    def test_mode_is_social_or_competitive(self):
        _, out = eb.parse_patch({'version': 1, 'experience': {'mode': 'competitive'}})
        self.assertEqual(out['experience'], {'mode': 'competitive'})
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'experience': {'mode': 'workshop'}}),
                         {'experience.mode': ['Choose one of the listed options.']})

    def test_blank_highlight_rows_are_dropped_silently(self):
        _, out = eb.parse_patch({'version': 1, 'experience': {'highlights': [
            {'title': '', 'body': ''},
            {'title': ' Free tea ', 'body': ' Chai served all evening '},
        ]}})
        self.assertEqual(out['experience']['highlights'],
                         [{'title': 'Free tea', 'body': 'Chai served all evening'}])

    def test_a_half_filled_highlight_is_an_error(self):
        self.assertEqual(
            failures(eb.parse_patch, {'version': 1, 'experience': {'highlights': [{'title': 'Free tea', 'body': ''}]}}),
            {'experience.highlights.0': ['Fill in both the title and the text, or remove the row.']})

    def test_a_half_filled_faq_row_is_an_error(self):
        self.assertEqual(
            failures(eb.parse_patch, {'version': 1, 'experience': {'faq': [{'question': 'Do I need a clock?',
                                                                          'answer': ' '}]}}),
            {'experience.faq.0': ['Fill in both the question and the answer, or remove the row.']})

    def test_list_limits_are_enforced(self):
        got = failures(eb.parse_patch, {'version': 1, 'experience': {
            'highlights': [{'title': 't', 'body': 'b'}] * 9,
            'logistics': ['item'] * 13,
            'faq': [{'question': 'q', 'answer': 'a'}] * 21,
        }})
        self.assertEqual(got, {'experience.highlights': ['Send a list of at most 8 items.'],
                               'experience.logistics': ['Send a list of at most 12 items.'],
                               'experience.faq': ['Send a list of at most 20 items.']})

    def test_a_blank_logistics_line_is_dropped(self):
        _, out = eb.parse_patch({'version': 1, 'experience': {'logistics': [' Bring a clock ', '', '  ']}})
        self.assertEqual(out['experience']['logistics'], ['Bring a clock'])

    def test_a_non_object_row_is_rejected(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'experience': {'highlights': ['Free tea']}}),
                         {'experience.highlights.0': ['Send an object.']})

    def test_hosted_arrival_must_be_a_boolean(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'experience': {'hostedArrival': 'yes'}}),
                         {'experience.hostedArrival': ['Choose true or false.']})


class ParsePatchRegistrationTests(SimpleTestCase):
    def test_an_empty_capacity_string_means_unlimited(self):
        _, out = eb.parse_patch({'version': 1, 'registration': {'capacity': ''}})
        self.assertIsNone(out['registration']['capacity'])

    def test_capacity_bounds_are_1_to_100000(self):
        for raw in (0, 100001):
            with self.subTest(raw=raw):
                self.assertEqual(failures(eb.parse_patch, {'version': 1, 'registration': {'capacity': raw}}),
                                 {'registration.capacity': ['Enter a whole number from 1 to 100000.']})

    def test_min_age_accepts_null_and_0_to_120(self):
        for raw, expected in ((None, None), (0, 0), (120, 120)):
            with self.subTest(raw=raw):
                _, out = eb.parse_patch({'version': 1, 'registration': {'minAge': raw}})
                self.assertEqual(out['registration']['minAge'], expected)
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'registration': {'minAge': 121}}),
                         {'registration.minAge': ['Enter a whole number from 0 to 120.']})

    def test_booleans_must_be_booleans(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'registration': {'waitlistEnabled': 1}}),
                         {'registration.waitlistEnabled': ['Choose true or false.']})


class ParsePatchPaymentTests(SimpleTestCase):
    def test_price_bounds(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'payment': {'pricePaise': -1}}),
                         {'payment.pricePaise': [f'Enter a whole number from 0 to {MAX_PAISE}.']})
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'payment': {'pricePaise': MAX_PAISE + 1}}),
                         {'payment.pricePaise': [f'Enter a whole number from 0 to {MAX_PAISE}.']})

    def test_a_null_refund_window_is_no_refunds(self):
        _, out = eb.parse_patch({'version': 1, 'payment': {'refundWindowHours': None}})
        self.assertIsNone(out['payment']['refundWindowHours'])

    def test_refund_window_and_hold_minutes_bounds(self):
        got = failures(eb.parse_patch, {'version': 1, 'payment': {'refundWindowHours': 1441,
                                                                  'holdMinutes': 61}})
        self.assertEqual(got, {'payment.refundWindowHours': ['Enter a whole number from 0 to 1440.'],
                               'payment.holdMinutes': ['Enter a whole number from 1 to 60.']})


class ParsePatchGameSystemTests(SimpleTestCase):
    def test_rated_pool_pairing_and_rounds_are_closed_to_their_options(self):
        got = failures(eb.parse_patch, {'version': 1, 'gameSystem': {'pool': 'ultra', 'pairingMode': 'knockout'}})
        self.assertEqual(got, {'gameSystem.pool': ['Choose one of the listed options.'],
                               'gameSystem.pairingMode': ['Choose one of the listed options.']})

    def test_rounds_bounds(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'gameSystem': {'rounds': 21}}),
                         {'gameSystem.rounds': ['Enter a whole number from 1 to 20.']})

    def test_rounds_can_be_cleared(self):
        _, out = eb.parse_patch({'version': 1, 'gameSystem': {'rounds': None}})
        self.assertIsNone(out['gameSystem']['rounds'])


class ParsePatchMediaTests(SimpleTestCase):
    def test_asset_ids_are_normalised_to_strings(self):
        first, second = uuid.uuid4(), uuid.uuid4()
        _, out = eb.parse_patch({'version': 1, 'media': {'assetIds': [str(first), str(second)], 'autoplay': True}})
        self.assertEqual(out['media'], {'assetIds': [str(first), str(second)], 'autoplay': True})

    def test_each_asset_can_appear_once(self):
        one = str(uuid.uuid4())
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'media': {'assetIds': [one, one]}}),
                         {'media.assetIds': ['Each asset can appear once.']})

    def test_an_invalid_asset_id_is_rejected_by_position(self):
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'media': {'assetIds': ['not-an-id']}}),
                         {'media.assetIds.0': ['Use a valid asset id.']})

    def test_at_most_fifty_assets(self):
        ids = [str(uuid.uuid4()) for _ in range(51)]
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'media': {'assetIds': ids}}),
                         {'media.assetIds': ['Send a list of at most 50 asset ids.']})

    def test_autoplay_and_interval_bounds(self):
        got = failures(eb.parse_patch, {'version': 1, 'media': {'autoplay': 'yes', 'intervalMs': 1000}})
        self.assertEqual(got, {'media.autoplay': ['Send true or false.'],
                               'media.intervalMs': ['Use 2000 to 60000 milliseconds.']})

    def test_mode_and_collection_id_are_not_write_fields(self):
        got = failures(eb.parse_patch, {'version': 1, 'media': {'mode': 'carousel', 'collectionId': 'g-1'}})
        self.assertEqual(got, {'media.mode': ['This field cannot be changed here.'],
                               'media.collectionId': ['This field cannot be changed here.']})


class ParsePatchCommunicationsTests(SimpleTestCase):
    def test_email_is_the_only_channel(self):
        _, out = eb.parse_patch({'version': 1, 'communications': {'channels': ['email']}})
        self.assertEqual(out['communications'], {})  # validated, not stored: it is the fixed launch value
        self.assertEqual(failures(eb.parse_patch, {'version': 1, 'communications': {'channels': ['sms']}}),
                         {'communications.channels': ['Email is the only channel at launch.']})

    def test_a_partial_trigger_patch_keeps_only_what_was_sent(self):
        _, out = eb.parse_patch({'version': 1, 'communications': {'triggers': {'reminder_24h': False}}})
        self.assertEqual(out['communications'], {'triggers': {'reminder_24h': False}})

    def test_unknown_triggers_and_non_booleans_are_rejected(self):
        got = failures(eb.parse_patch, {'version': 1, 'communications': {'triggers': {'push': True,
                                                                                      'confirmation': 'no'}}})
        self.assertEqual(got, {'communications.triggers.push': ['This field cannot be changed here.'],
                               'communications.triggers.confirmation': ['Choose true or false.']})


class ParsePatchCollectsEveryErrorTests(SimpleTestCase):
    def test_every_failing_field_is_reported_in_one_response(self):
        got = failures(eb.parse_patch, {
            'version': 2,
            'basics': {'title': 'x' * 121, 'startsAt': 'tomorrow'},
            'payment': {'pricePaise': -5},
            'gameSystem': {'rounds': 0},
        })
        self.assertEqual(sorted(got), ['basics.startsAt', 'basics.title', 'gameSystem.rounds', 'payment.pricePaise'])


# ---------------------------------------------------------------- readiness (publish blockers)

class ReadinessTests(SimpleTestCase):
    def test_a_complete_draft_is_ready(self):
        event = draft_event(type='social', capacity=None, description='')
        self.assertEqual(eb.readiness(event, now=NOW), {'ready': True})

    def test_a_blank_title_blocks_publish(self):
        event = draft_event(title='   ')
        self.assertEqual(eb.readiness(event, now=NOW)['blockers'],
                         [{'code': 'REQUIRED', 'reason': 'The title is required.', 'field': 'basics.title'}])

    def test_a_missing_slug_blocks_publish(self):
        self.assertEqual(eb.readiness(draft_event(slug=None), now=NOW)['blockers'],
                         [{'code': 'REQUIRED', 'reason': 'Choose a slug for the event page.',
                           'field': 'basics.slug'}])

    def test_a_missing_or_past_start_blocks_publish(self):
        self.assertEqual(eb.readiness(draft_event(starts_at=None), now=NOW)['blockers'],
                         [{'code': 'REQUIRED', 'reason': 'Set when the event starts.',
                           'field': 'basics.startsAt'}])
        self.assertEqual(eb.readiness(draft_event(starts_at=NOW), now=NOW)['blockers'],
                         [{'code': 'STARTS_IN_PAST', 'reason': 'The start time must be in the future.',
                           'field': 'basics.startsAt'}])

    def test_a_missing_or_early_end_blocks_publish(self):
        self.assertEqual(eb.readiness(draft_event(ends_at=None), now=NOW)['blockers'],
                         [{'code': 'REQUIRED', 'reason': 'Set when the event ends.', 'field': 'basics.endsAt'}])
        start = NOW + timedelta(days=2)
        self.assertEqual(eb.readiness(draft_event(starts_at=start, ends_at=start), now=NOW)['blockers'],
                         [{'code': 'INVALID', 'reason': 'The end must be after the start.',
                           'field': 'basics.endsAt'}])

    def test_the_time_control_is_required(self):
        self.assertEqual(eb.readiness(draft_event(time_control=''), now=NOW)['blockers'],
                         [{'code': 'REQUIRED', 'reason': 'The time control is required.',
                           'field': 'gameSystem.timeControl'}])

    def test_a_rated_event_needs_a_pool(self):
        self.assertEqual(eb.readiness(draft_event(rated=True, rating_pool=''), now=NOW)['blockers'],
                         [{'code': 'REQUIRED', 'reason': 'Choose the rating pool for a rated event.',
                           'field': 'gameSystem.pool'}])

    def test_swiss_and_round_robin_need_rounds(self):
        for mode in ('swiss', 'round_robin'):
            with self.subTest(mode=mode):
                self.assertEqual(eb.readiness(draft_event(pairing_mode=mode, rounds_planned=None), now=NOW)['blockers'],
                                 [{'code': 'REQUIRED', 'reason': 'Set the number of rounds.',
                                   'field': 'gameSystem.rounds'}])
        self.assertEqual(eb.readiness(draft_event(pairing_mode='social_balanced', rounds_planned=None), now=NOW),
                         {'ready': True})

    def test_the_registration_window_must_close_after_it_opens_and_by_the_start(self):
        start = NOW + timedelta(days=7)
        opens = NOW + timedelta(days=1)
        self.assertEqual(
            eb.readiness(draft_event(starts_at=start, ends_at=start + timedelta(hours=2),
                                     registration_opens_at=opens, registration_closes_at=opens), now=NOW)['blockers'],
            [{'code': 'INVALID', 'reason': 'Registration must close after it opens.',
              'field': 'registration.closesAt'}])
        self.assertEqual(
            eb.readiness(draft_event(starts_at=start, ends_at=start + timedelta(hours=2),
                                     registration_closes_at=start + timedelta(minutes=1)), now=NOW)['blockers'],
            [{'code': 'INVALID', 'reason': 'Registration must close no later than the event starts.',
              'field': 'registration.closesAt'}])

    def test_a_paid_event_without_a_refund_window_is_ready(self):
        # null refundWindowHours is the explicit "no refunds" choice, not a missing value.
        self.assertEqual(eb.readiness(draft_event(price_paise=50000, refund_window_hours=None), now=NOW),
                         {'ready': True})

    def test_an_unlimited_capacity_and_empty_description_are_ready(self):
        self.assertEqual(eb.readiness(draft_event(capacity=None, description=''), now=NOW), {'ready': True})

    def test_every_blocker_is_reported_at_once(self):
        blockers = eb.readiness(Event(), now=NOW)['blockers']
        self.assertEqual([(b['code'], b['field']) for b in blockers],
                         [('REQUIRED', 'basics.title'), ('REQUIRED', 'basics.slug'), ('REQUIRED', 'basics.startsAt'),
                          ('REQUIRED', 'basics.endsAt'), ('REQUIRED', 'gameSystem.timeControl')])


class ReadinessMediaTests(TestCase):
    def setUp(self):
        self.collection = MediaCollection.objects.create(key='event-gallery')

    def _asset(self, *, alt='', decorative=False):
        asset = MediaAsset.objects.create(src='/media/table.jpg', alt=alt, decorative=decorative,
                                          width=1200, height=800)
        MediaCollectionItem.objects.create(collection=self.collection, asset=asset, order=0)
        return asset

    def _readiness_for(self):
        event = draft_event()
        event.media = self.collection
        return eb.readiness(event, now=NOW)

    def test_an_image_without_alt_text_blocks_publish(self):
        self._asset(alt='')
        self.assertEqual(self._readiness_for()['blockers'],
                         [{'code': 'INVALID', 'reason': 'Every image needs alt text (or must be marked decorative).',
                           'field': 'media.assetIds'}])

    def test_alt_text_unblocks_publish(self):
        self._asset(alt='Two players mid-game at a cafe table')
        self.assertEqual(self._readiness_for(), {'ready': True})

    def test_a_decorative_image_needs_no_alt_text(self):
        self._asset(alt='', decorative=True)
        self.assertEqual(self._readiness_for(), {'ready': True})


# ---------------------------------------------------------------- locked fields

class LockedFieldsTests(TestCase):
    def setUp(self):
        self.event = Event.objects.create(**draft_fields())
        self.player = User.objects.create_user(email='player@example.com', password='test-pass-1', name='Player')

    def _register(self, status, **extra):
        return Registration.objects.create(user=self.player, event=self.event, status=status, **extra)

    def test_an_empty_draft_locks_nothing(self):
        self.assertEqual(eb.locked_fields(self.event), [])

    def test_a_confirmed_registration_locks_price_capacity_and_game_system(self):
        self._register('confirmed')
        self.assertEqual(eb.locked_fields(self.event),
                         ['pricePaise', 'capacity', 'pairingMode', 'rated', 'pool'])

    def test_a_live_capacity_hold_locks_the_same_fields(self):
        self._register('pending', hold_expires_at=timezone.now() + timedelta(minutes=10))
        self.assertEqual(eb.locked_fields(self.event),
                         ['pricePaise', 'capacity', 'pairingMode', 'rated', 'pool'])

    def test_an_expired_unpaid_hold_does_not_lock(self):
        self._register('pending', hold_expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(eb.locked_fields(self.event), [])

    def test_an_expired_hold_with_an_attempted_payment_locks(self):
        self._register('pending', hold_expires_at=timezone.now() - timedelta(minutes=1),
                       payment_order_state='attempted')
        self.assertIn('pricePaise', eb.locked_fields(self.event))

    def test_waitlist_and_refunded_registrations_lock(self):
        self._register('waitlist')
        self.assertTrue(eb.has_commitments(self.event))
        self.event.player_registrations.all().delete()
        self._register('refunded')
        self.assertTrue(eb.has_commitments(self.event))

    def test_a_cancelled_registration_with_no_order_does_not_lock(self):
        self._register('cancelled')
        self.assertFalse(eb.has_commitments(self.event))

    def test_a_payment_order_locks_even_when_its_registration_is_cancelled(self):
        registration = self._register('cancelled')
        PaymentOrder.objects.create(registration=registration, user=self.player, provider_order_id='order_1',
                                    amount_paise=50000, state='paid')
        self.assertTrue(eb.has_commitments(self.event))
        self.assertIn('pricePaise', eb.locked_fields(self.event))

    def test_the_slug_locks_after_the_first_publish(self):
        self.event.first_published_at = NOW - timedelta(days=1)
        self.assertEqual(eb.locked_fields(self.event), ['slug'])

    def test_the_slug_lock_is_added_after_the_registration_locks(self):
        self._register('confirmed')
        self.event.first_published_at = NOW - timedelta(days=1)
        self.assertEqual(eb.locked_fields(self.event),
                         ['pricePaise', 'capacity', 'pairingMode', 'rated', 'pool', 'slug'])

    def test_every_lockable_field_has_a_reason_and_a_patch_path(self):
        self.assertEqual(set(eb.LOCK_REASONS), {'pricePaise', 'capacity', 'pairingMode', 'rated', 'pool', 'slug'})
        self.assertEqual(sorted(eb.LOCKABLE_PATHS.values()),
                         ['capacity', 'pairingMode', 'pool', 'pricePaise', 'rated'])
        for lock in eb.LOCKABLE_PATHS.values():
            self.assertTrue(eb.LOCK_REASONS[lock])


# ---------------------------------------------------------------- capabilities

class UnpublishBlockersTests(TestCase):
    def setUp(self):
        self.event = Event.objects.create(**draft_fields())
        self.player = User.objects.create_user(email='player@example.com', password='test-pass-1', name='Player')

    def test_a_draft_cannot_be_unpublished(self):
        self.assertEqual(eb.unpublish_blockers(self.event),
                         [{'code': 'NOT_PUBLISHED', 'reason': 'Only a published event can be unpublished.'}])

    def test_a_clean_published_event_has_no_blockers(self):
        self.event.status = 'published'
        self.assertEqual(eb.unpublish_blockers(self.event), [])

    def test_confirmed_players_block_unpublish(self):
        self.event.status = 'published'
        self.event.confirmed_count = 2
        self.assertEqual(eb.unpublish_blockers(self.event),
                         [{'code': 'HAS_CONFIRMED',
                           'reason': 'Players are confirmed for this event. Cancel the event instead.'}])

    def test_a_payment_in_flight_blocks_unpublish(self):
        self.event.status = 'published'
        Registration.objects.create(user=self.player, event=self.event, status='pending',
                                    payment_order_state='attempted')
        self.assertEqual(eb.unpublish_blockers(self.event),
                         [{'code': 'PAYMENT_IN_FLIGHT', 'reason': 'A payment is in progress for this event.'}])

    def test_a_confirming_registration_blocks_unpublish(self):
        self.event.status = 'published'
        Registration.objects.create(user=self.player, event=self.event, status='confirming')
        self.assertEqual([b['code'] for b in eb.unpublish_blockers(self.event)], ['PAYMENT_IN_FLIGHT'])

    def test_the_caller_can_supply_the_payment_answer(self):
        self.event.status = 'published'
        Registration.objects.create(user=self.player, event=self.event, status='confirming')
        self.assertEqual(eb.unpublish_blockers(self.event, confirming=False), [])


class CapabilitiesTests(TestCase):
    def setUp(self):
        # capabilities() reads the real clock, so the draft must start in the real future (not the frozen NOW).
        start = timezone.now() + timedelta(days=7)
        self.event = Event.objects.create(**draft_fields(starts_at=start, ends_at=start + timedelta(hours=3)))
        self.player = User.objects.create_user(email='player@example.com', password='test-pass-1', name='Player')

    def _caps(self, status, **extra):
        self.event.status = status
        for key, value in extra.items():
            setattr(self.event, key, value)
        return eb.capabilities(self.event)

    def test_a_ready_draft_may_be_published_edited_and_deleted(self):
        caps = self._caps('draft')
        self.assertEqual(caps['canPublish'], {'allowed': True})
        self.assertEqual(caps['canEdit'], {'allowed': True})
        self.assertEqual(caps['canDelete'], {'allowed': True})
        self.assertEqual(caps['canCancel'], {'allowed': False,
                                             'reason': 'A draft is not cancelled. Delete or leave it as a draft.'})
        self.assertEqual(caps['canUnpublish'], {'allowed': False,
                                               'reason': 'Only a published event can be unpublished.',
                                               'blockers': [{'code': 'NOT_PUBLISHED',
                                                             'reason': 'Only a published event can be '
                                                                       'unpublished.'}]})
        self.assertEqual(caps['canOpenRegistration'], {'allowed': False,
                                                       'reason': 'Only a published event can open registrations.'})

    def test_an_unready_draft_is_denied_with_its_blockers(self):
        self.event.title = ''
        caps = eb.capabilities(self.event)
        self.assertFalse(caps['canPublish']['allowed'])
        self.assertEqual(caps['canPublish']['reason'], 'Finish the missing details before publishing.')
        self.assertEqual([b['field'] for b in caps['canPublish']['blockers']], ['basics.title'])

    def test_a_published_event_can_be_cancelled_unpublished_and_open_registrations(self):
        caps = self._caps('published')
        self.assertEqual(caps['canPublish'], {'allowed': False, 'reason': 'This event is already published.'})
        self.assertEqual(caps['canUnpublish'], {'allowed': True})
        self.assertEqual(caps['canCancel'], {'allowed': True})
        self.assertEqual(caps['canOpenRegistration'], {'allowed': True})
        self.assertEqual(caps['canCloseRegistration'], {'allowed': False,
                                                        'reason': 'Only an open-registration event can have '
                                                                  'registrations closed.'})
        self.assertEqual(caps['canDelete'], {'allowed': False, 'reason': 'Only a draft event can be deleted.'})

    def test_only_an_open_registration_event_can_have_registrations_closed(self):
        caps = self._caps('registration_open')
        self.assertEqual(caps['canCloseRegistration'], {'allowed': True})
        self.assertEqual(caps['canOpenRegistration'], {'allowed': False,
                                                       'reason': 'Only a published event can open registrations.'})
        self.assertEqual(caps['canEdit'], {'allowed': True})

    def test_players_who_paid_block_unpublishing(self):
        self.event.confirmed_count = 3
        caps = self._caps('published')
        self.assertFalse(caps['canUnpublish']['allowed'])
        self.assertEqual(caps['canUnpublish']['blockers'][0]['code'], 'HAS_CONFIRMED')

    def test_an_ongoing_event_can_be_neither_edited_nor_cancelled(self):
        # Event.TRANSITIONS: ongoing only goes to completed, which is why cancel is denied here too.
        caps = self._caps('ongoing')
        self.assertEqual(caps['canPublish'], {'allowed': False, 'reason': 'A ongoing event cannot be published.'})
        self.assertEqual(caps['canEdit'], {'allowed': False, 'reason': 'A ongoing event can no longer be edited.'})
        self.assertEqual(caps['canCancel'], {'allowed': False, 'reason': 'A ongoing event cannot be cancelled.'})
        self.assertEqual(caps['canDelete'], {'allowed': False, 'reason': 'Only a draft event can be deleted.'})
        self.assertEqual(caps['canOpenRegistration'], {'allowed': False,
                                                       'reason': 'Only a published event can open registrations.'})

    def test_a_completed_event_can_no_longer_be_changed(self):
        for key in ('canPublish', 'canEdit', 'canCancel', 'canDelete', 'canOpenRegistration',
                    'canCloseRegistration', 'canUnpublish'):
            with self.subTest(capability=key):
                self.assertFalse(self._caps('completed')[key]['allowed'])
        self.assertEqual(self._caps('completed')['canEdit']['reason'], 'A completed event can no longer be edited.')

    def test_a_cancelled_event_offers_no_actions(self):
        self.assertEqual(self._caps('cancelled')['canCancel'],
                         {'allowed': False, 'reason': 'A cancelled event cannot be cancelled.'})

    def test_a_sold_out_event_counts_as_already_published(self):
        caps = self._caps('sold_out')
        self.assertEqual(caps['canPublish'], {'allowed': False, 'reason': 'This event is already published.'})
        self.assertFalse(caps['canOpenRegistration']['allowed'])
        self.assertFalse(caps['canCloseRegistration']['allowed'])

    def test_readiness_can_be_passed_in_instead_of_recomputed(self):
        caps = eb.capabilities(self.event, ready={'ready': True})
        self.assertEqual(caps['canPublish'], {'allowed': True})


# ---------------------------------------------------------------- draft DTO

class DraftDtoTests(TestCase):
    def setUp(self):
        self.event = Event.objects.create(**draft_fields())

    def test_the_draft_carries_every_builder_step(self):
        dto = eb.draft_dto(self.event)
        self.assertEqual(dto['id'], str(self.event.pk))
        self.assertEqual((dto['status'], dto['version']), ('draft', 1))
        self.assertEqual(sorted(dto), ['basics', 'communications', 'createdAt', 'experience', 'gameSystem', 'id',
                                       'lastChange', 'lockedFields', 'lockedReasons', 'media', 'payment', 'readiness',
                                       'registration', 'status', 'updatedAt', 'version'])

    def test_basics_are_never_null_text(self):
        basics = eb.draft_dto(self.event)['basics']
        self.assertEqual((basics['title'], basics['promise'], basics['venueName'], basics['address'],
                          basics['city']), ('Saturday Social', '', '', '', ''))
        self.assertEqual(basics['slug'], {'lock': 'editable', 'value': 'saturday-social'})

    def test_a_published_slug_reports_its_lock_and_first_publish_time(self):
        self.event.first_published_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=dt_timezone.utc)
        self.assertEqual(eb.draft_dto(self.event)['basics']['slug'],
                         {'lock': 'locked', 'value': 'saturday-social', 'lockedAt': '2026-01-02T08:34:05+05:30'})

    def test_communications_default_every_trigger_on_and_email_only(self):
        comms = eb.draft_dto(self.event)['communications']
        self.assertEqual(comms['channels'], ['email'])
        self.assertEqual(comms['triggers'], {t: True for t in eb.TRIGGERS})

    def test_stored_trigger_choices_are_honoured(self):
        self.event.communications = {'triggers': {'reminder_24h': False}}
        comms = eb.draft_dto(self.event)['communications']['triggers']
        self.assertFalse(comms['reminder_24h'])
        self.assertTrue(comms['confirmation'])

    def test_game_system_pool_is_dropped_when_not_rated(self):
        dto = eb.draft_dto(self.event)['gameSystem']
        self.assertEqual(dto, {'rated': False, 'pairingMode': 'none', 'rounds': None, 'timeControl': '10+5'})

    def test_a_rated_event_without_a_pool_reports_rapid(self):
        self.event.rated = True
        self.event.rating_pool = ''
        self.assertEqual(eb.draft_dto(self.event)['gameSystem']['pool'], 'rapid')

    def test_an_empty_gallery_is_static_with_no_assets(self):
        self.assertEqual(eb.draft_dto(self.event)['media'],
                         {'assetIds': [], 'assets': [], 'mode': 'static', 'autoplay': False, 'intervalMs': 5000})

    def test_the_gallery_order_and_derived_mode_come_from_the_collection(self):
        collection = MediaCollection.objects.create(key='event-gallery', autoplay=True, interval_ms=4000)
        first = MediaAsset.objects.create(src='/media/a.jpg', alt='First', width=1200, height=800)
        second = MediaAsset.objects.create(src='/media/b.jpg', alt='Second', width=1200, height=800)
        MediaCollectionItem.objects.create(collection=collection, asset=first, order=0)
        MediaCollectionItem.objects.create(collection=collection, asset=second, order=1)
        self.event.media = collection
        media = eb.draft_dto(self.event)['media']
        self.assertEqual((media['assetIds'], media['mode'], media['autoplay'], media['intervalMs']),
                         ([str(first.pk), str(second.pk)], 'carousel', True, 4000))

    def test_locked_fields_and_their_reasons_are_reported_together(self):
        self.event.first_published_at = NOW - timedelta(days=1)
        dto = eb.draft_dto(self.event)
        self.assertEqual(dto['lockedFields'], ['slug'])
        self.assertEqual(dto['lockedReasons'], {'slug': 'The slug cannot change after the first publish.'})

    def test_the_last_change_names_its_editor(self):
        admin = User.objects.create_user(email='admin@example.com', password='test-pass-1', name='Admin Person')
        self.event.updated_by = admin
        self.event.last_change_summary = 'Changed the time control'
        self.event.save()
        last = eb.draft_dto(self.event)['lastChange']
        self.assertEqual(last['by'], {'id': str(admin.pk), 'name': 'Admin Person'})
        self.assertEqual(last['summary'], 'Changed the time control')

    def test_the_draft_reports_readiness_inline(self):
        self.event.title = ''
        self.assertEqual(eb.draft_dto(self.event)['readiness']['blockers'][0]['field'], 'basics.title')

    def test_row_dto_exposes_capabilities_and_the_fill_count(self):
        self.event.confirmed_count = 4
        row = eb.row_dto(self.event)
        self.assertEqual((row['id'], row['filled'], row['capacity']), (str(self.event.pk), 4, None))
        self.assertEqual(row['capabilities']['canDelete'], {'allowed': True})


# ---------------------------------------------------------------- defaults

class DefaultsTests(TestCase):
    def test_default_communications_turns_every_trigger_on(self):
        self.assertEqual(eb.default_communications(),
                         {'triggers': {t: True for t in eb.TRIGGERS}, 'channels': ['email']})

    def test_type_defaults_per_event_type(self):
        self.assertEqual(eb.type_defaults('social'),
                         {'format': 'Social night', 'pairing_mode': 'social_balanced', 'rated': False,
                          'rating_pool': '', 'hold_minutes': reg_conf.hold_minutes()})
        self.assertEqual(eb.type_defaults('rated_tournament'),
                         {'format': 'Rated tournament', 'pairing_mode': 'swiss', 'rated': True,
                          'rating_pool': 'rapid', 'hold_minutes': reg_conf.hold_minutes()})

    def test_league_and_workshop_have_no_engine(self):
        for event_type, label in (('league', 'League'), ('workshop', 'Workshop')):
            with self.subTest(event_type=event_type):
                self.assertEqual(eb.type_defaults(event_type)['format'], label)
                self.assertEqual(eb.type_defaults(event_type)['pairing_mode'], 'none')
                self.assertFalse(eb.type_defaults(event_type)['rated'])
