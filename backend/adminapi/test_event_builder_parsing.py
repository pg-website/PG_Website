"""Event Builder input parsing (PLAN-013 phase 1): parse_event_id, parse_create, parse_patch.

Pure functions of the payload: no database, so SimpleTestCase. Expectations are written by hand from the contract
(E02/E04) and the web `builderDraftSchema`; they are not read back from the code.
"""
import uuid
from datetime import datetime, timezone as dt_timezone

from django.test import SimpleTestCase

from core.errors import EventNotFound, ValidationFailed

from . import event_builder as eb

NOT_ALLOWED = 'This field cannot be changed here.'


def errors_of(fn, *args):
    """The field -> messages map ValidationFailed carries, or a failure explaining nothing was raised."""
    try:
        fn(*args)
    except ValidationFailed as exc:
        return exc.fields
    raise AssertionError('ValidationFailed was not raised')


class ParseEventIdTests(SimpleTestCase):
    def test_accepts_a_uuid_string(self):
        value = str(uuid.uuid4())
        self.assertEqual(str(eb.parse_event_id(value)), value)

    def test_accepts_a_uuid_instance(self):
        value = uuid.uuid4()
        self.assertEqual(eb.parse_event_id(value), value)

    def test_unknown_ids_are_not_found(self):
        for raw in ('not-a-uuid', '', None, 12, ['x']):
            with self.subTest(raw=raw):
                with self.assertRaises(EventNotFound):
                    eb.parse_event_id(raw)


class ParseCreateTests(SimpleTestCase):
    def test_minimal_payload_defaults(self):
        self.assertEqual(
            eb.parse_create({'title': 'Saturday Social'}),
            {'title': 'Saturday Social', 'type': 'social', 'slug': None},
        )

    def test_trims_title_and_keeps_type_and_slug(self):
        self.assertEqual(
            eb.parse_create({'title': '  Saturday Social  ', 'type': 'special', 'slug': 'saturday-social'}),
            {'title': 'Saturday Social', 'type': 'special', 'slug': 'saturday-social'},
        )

    def test_blank_title_is_rejected_on_create(self):
        # Create is stricter than PATCH: only an existing draft may be blanked (see ParsePatchBasicsTests).
        self.assertEqual(errors_of(eb.parse_create, {'title': '   '}), {'title': ['This is required.']})

    def test_title_must_be_a_string(self):
        self.assertEqual(errors_of(eb.parse_create, {'title': 42}), {'title': ['Enter text.']})

    def test_title_length_cap(self):
        self.assertEqual(errors_of(eb.parse_create, {'title': 'x' * 121}),
                         {'title': ['Use at most 120 characters.']})
        self.assertEqual(eb.parse_create({'title': 'x' * 120})['title'], 'x' * 120)

    def test_html_in_title_is_rejected(self):
        self.assertEqual(errors_of(eb.parse_create, {'title': '<b>Saturday</b>'}),
                         {'title': ['HTML is not allowed.']})

    def test_missing_title_is_required(self):
        fields = errors_of(eb.parse_create, {'type': 'social'})
        self.assertEqual(fields, {'title': ['This is required.']})

    def test_blank_slug_means_no_slug_yet(self):
        self.assertIsNone(eb.parse_create({'title': 'X'})['slug'])
        self.assertIsNone(eb.parse_create({'title': 'X', 'slug': ''})['slug'])
        self.assertIsNone(eb.parse_create({'title': 'X', 'slug': None})['slug'])

    def test_slug_shape(self):
        message = ['Use 3 to 80 lowercase letters, digits and single hyphens.']
        for bad in ('ab', 'Saturday Social', 'saturday_social', 'x' * 81):
            with self.subTest(bad=bad):
                self.assertEqual(errors_of(eb.parse_create, {'title': 'X', 'slug': bad}), {'slug': message})

    def test_type_must_be_a_known_event_type(self):
        self.assertEqual(errors_of(eb.parse_create, {'title': 'X', 'type': 'gala'}),
                         {'type': ['Choose one of the listed options.']})

    def test_unknown_fields_are_rejected(self):
        self.assertEqual(errors_of(eb.parse_create, {'title': 'X', 'capacity': 20}),
                         {'capacity': [NOT_ALLOWED]})
        self.assertEqual(errors_of(eb.parse_create, {'title': 'X', 'status': 'published'}),
                         {'status': [NOT_ALLOWED]})

    def test_non_object_payload(self):
        self.assertEqual(errors_of(eb.parse_create, []), {'form': ['Send a JSON object.']})


class ParsePatchEnvelopeTests(SimpleTestCase):
    def test_version_is_required(self):
        self.assertEqual(errors_of(eb.parse_patch, {'basics': {'title': 'X'}}),
                         {'version': ['Send the version you loaded.']})

    def test_version_must_be_a_non_negative_integer(self):
        for bad in (True, -1, '1', 1.0, None):
            with self.subTest(bad=bad):
                self.assertEqual(errors_of(eb.parse_patch, {'version': bad}),
                                 {'version': ['Send the version you loaded.']})

    def test_version_zero_is_valid(self):
        self.assertEqual(eb.parse_patch({'version': 0}), (0, {}))

    def test_non_object_payload(self):
        self.assertEqual(errors_of(eb.parse_patch, 'basics'), {'form': ['Send a JSON object.']})

    def test_unknown_top_level_key_is_rejected(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'readiness': {}}),
                         {'readiness': [NOT_ALLOWED]})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'status': 'published'}),
                         {'status': [NOT_ALLOWED]})

    def test_review_is_not_a_patchable_step(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'review': {}}),
                         {'review': [NOT_ALLOWED]})

    def test_empty_step_object_is_accepted(self):
        self.assertEqual(eb.parse_patch({'version': 1, 'basics': {}}), (1, {'basics': {}}))

    def test_steps_that_are_not_sent_are_absent(self):
        version, out = eb.parse_patch({'version': 4, 'payment': {'holdMinutes': 15}})
        self.assertEqual(version, 4)
        self.assertEqual(out, {'payment': {'holdMinutes': 15}})


class ParsePatchBasicsTests(SimpleTestCase):
    def patch(self, basics):
        return eb.parse_patch({'version': 1, 'basics': basics})[1]['basics']

    def test_trims_text_fields(self):
        self.assertEqual(self.patch({'title': '  New title ', 'promise': ' A promise '}),
                         {'title': 'New title', 'promise': 'A promise'})

    def test_a_draft_may_blank_the_title(self):
        self.assertEqual(self.patch({'title': '   '}), {'title': ''})

    def test_slug_clears_with_null_or_empty(self):
        self.assertEqual(self.patch({'slug': None}), {'slug': None})
        self.assertEqual(self.patch({'slug': ''}), {'slug': None})

    def test_slug_is_validated(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': {'slug': 'Not A Slug'}}),
                         {'basics.slug': ['Use 3 to 80 lowercase letters, digits and single hyphens.']})

    def test_instant_with_offset_is_parsed(self):
        self.assertEqual(self.patch({'startsAt': '2026-12-01T18:00:00+05:30'}),
                         {'startsAt': datetime(2026, 12, 1, 12, 30, tzinfo=dt_timezone.utc)})

    def test_instant_with_zulu_suffix_is_parsed(self):
        self.assertEqual(self.patch({'endsAt': '2026-12-01T12:30:00Z'}),
                         {'endsAt': datetime(2026, 12, 1, 12, 30, tzinfo=dt_timezone.utc)})

    def test_naive_and_garbage_instants_are_rejected(self):
        message = ['Use an ISO 8601 date-time with a UTC offset.']
        for bad in ('2026-12-01T18:00:00', 'tomorrow', '', 20261201):
            with self.subTest(bad=bad):
                self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': {'startsAt': bad}}),
                                 {'basics.startsAt': message})

    def test_dates_may_be_cleared(self):
        self.assertEqual(self.patch({'startsAt': None, 'endsAt': None}), {'startsAt': None, 'endsAt': None})

    def test_type_and_audience_are_enumerated(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': {'type': 'gala'}}),
                         {'basics.type': ['Choose one of the listed options.']})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': {'audience': 'kids'}}),
                         {'basics.audience': ['Choose one of the listed options.']})
        self.assertEqual(self.patch({'type': 'rated_tournament', 'audience': 'beginner'}),
                         {'type': 'rated_tournament', 'audience': 'beginner'})

    def test_text_limits_are_per_field(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': {'address': 'x' * 301}}),
                         {'basics.address': ['Use at most 300 characters.']})

    def test_unknown_basics_field_is_rejected(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': {'status': 'published'}}),
                         {'basics.status': [NOT_ALLOWED]})

    def test_basics_must_be_an_object(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'basics': 'title'}), {'basics': ['Send an object.']})


class ParsePatchExperienceTests(SimpleTestCase):
    def patch(self, experience):
        return eb.parse_patch({'version': 1, 'experience': experience})[1]['experience']

    def test_highlights_are_trimmed(self):
        self.assertEqual(self.patch({'highlights': [{'title': ' Free tea ', 'body': ' Chai all evening '}]}),
                         {'highlights': [{'title': 'Free tea', 'body': 'Chai all evening'}]})

    def test_a_blank_row_is_dropped_silently(self):
        self.assertEqual(self.patch({'highlights': [{'title': '', 'body': '  '}]}), {'highlights': []})

    def test_a_half_filled_row_is_an_error(self):
        self.assertEqual(
            errors_of(eb.parse_patch, {'version': 1, 'experience': {'highlights': [{'title': 'Free tea'}]}}),
            {'experience.highlights.0': ['Fill in both the title and the text, or remove the row.']},
        )

    def test_a_half_filled_faq_row_is_an_error(self):
        self.assertEqual(
            errors_of(eb.parse_patch, {'version': 1, 'experience': {'faq': [{'question': 'Bring a board?'}]}}),
            {'experience.faq.0': ['Fill in both the question and the answer, or remove the row.']},
        )

    def test_list_rows_must_be_objects(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'highlights': ['tea']}}),
                         {'experience.highlights.0': ['Send an object.']})

    def test_list_caps(self):
        eight = [{'title': f'T{i}', 'body': 'B'} for i in range(8)]
        self.assertEqual(len(self.patch({'highlights': eight})['highlights']), 8)
        self.assertEqual(
            errors_of(eb.parse_patch, {'version': 1, 'experience': {'highlights': eight + [{'title': 'T8', 'body': 'B'}]}}),
            {'experience.highlights': ['Send a list of at most 8 items.']},
        )
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'logistics': ['x'] * 13}}),
                         {'experience.logistics': ['Send a list of at most 12 items.']})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'faq': [
            {'question': 'Q', 'answer': 'A'}] * 21}}), {'experience.faq': ['Send a list of at most 20 items.']})

    def test_logistics_drop_blanks_and_reject_non_text(self):
        self.assertEqual(self.patch({'logistics': [' Bring a board ', '', '  ']}),
                         {'logistics': ['Bring a board']})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'logistics': [5]}}),
                         {'experience.logistics.0': ['Enter text.']})

    def test_list_field_that_is_not_a_list(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'highlights': {}}}),
                         {'experience.highlights': ['Send a list of at most 8 items.']})

    def test_mode_is_social_or_competitive(self):
        self.assertEqual(self.patch({'mode': 'competitive'}), {'mode': 'competitive'})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'mode': 'workshop'}}),
                         {'experience.mode': ['Choose one of the listed options.']})

    def test_hosted_arrival_must_be_a_boolean(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'hostedArrival': 'yes'}}),
                         {'experience.hostedArrival': ['Choose true or false.']})
        self.assertEqual(self.patch({'hostedArrival': False}), {'hostedArrival': False})

    def test_description_length_cap(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'experience': {'description': 'x' * 4001}}),
                         {'experience.description': ['Use at most 4000 characters.']})


class ParsePatchRegistrationTests(SimpleTestCase):
    def patch(self, registration):
        return eb.parse_patch({'version': 1, 'registration': registration})[1]['registration']

    def test_empty_capacity_means_unlimited(self):
        self.assertEqual(self.patch({'capacity': ''}), {'capacity': None})
        self.assertEqual(self.patch({'capacity': None}), {'capacity': None})
        self.assertEqual(self.patch({'capacity': 20}), {'capacity': 20})

    def test_capacity_bounds(self):
        message = ['Enter a whole number from 1 to 100000.']
        for bad in (0, 100001, True, 1.5, '20'):
            with self.subTest(bad=bad):
                self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'registration': {'capacity': bad}}),
                                 {'registration.capacity': message})

    def test_min_age_bounds(self):
        self.assertEqual(self.patch({'minAge': 0}), {'minAge': 0})
        self.assertEqual(self.patch({'minAge': 120}), {'minAge': 120})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'registration': {'minAge': 121}}),
                         {'registration.minAge': ['Enter a whole number from 0 to 120.']})

    def test_switches_must_be_booleans(self):
        for key in ('waitlistEnabled', 'membershipRequired', 'askFirstTimer'):
            with self.subTest(key=key):
                self.assertEqual(
                    errors_of(eb.parse_patch, {'version': 1, 'registration': {key: 'yes'}}),
                    {f'registration.{key}': ['Choose true or false.']},
                )

    def test_registration_window_instants(self):
        naive = errors_of(eb.parse_patch, {'version': 1, 'registration': {'opensAt': '2026-12-01T18:00:00'}})
        self.assertEqual(naive, {'registration.opensAt': ['Use an ISO 8601 date-time with a UTC offset.']})
        self.assertEqual(
            self.patch({'opensAt': '2026-12-01T00:00:00Z', 'closesAt': '2026-12-05T00:00:00Z'}),
            {'opensAt': datetime(2026, 12, 1, tzinfo=dt_timezone.utc),
             'closesAt': datetime(2026, 12, 5, tzinfo=dt_timezone.utc)},
        )

    def test_unknown_registration_field_is_rejected(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'registration': {'pricePaise': 0}}),
                         {'registration.pricePaise': [NOT_ALLOWED]})


class ParsePatchPaymentTests(SimpleTestCase):
    def patch(self, payment):
        return eb.parse_patch({'version': 1, 'payment': payment})[1]['payment']

    def test_price_bounds(self):
        self.assertEqual(self.patch({'pricePaise': 0}), {'pricePaise': 0})
        self.assertEqual(self.patch({'pricePaise': 100_000_000}), {'pricePaise': 100_000_000})
        message = ['Enter a whole number from 0 to 100000000.']
        for bad in (100_000_001, -1, True):
            with self.subTest(bad=bad):
                self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'payment': {'pricePaise': bad}}),
                                 {'payment.pricePaise': message})

    def test_refund_window_is_nullable(self):
        self.assertEqual(self.patch({'refundWindowHours': None}), {'refundWindowHours': None})
        self.assertEqual(self.patch({'refundWindowHours': 0}), {'refundWindowHours': 0})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'payment': {'refundWindowHours': 1441}}),
                         {'payment.refundWindowHours': ['Enter a whole number from 0 to 1440.']})

    def test_hold_minutes_bounds(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'payment': {'holdMinutes': 0}}),
                         {'payment.holdMinutes': ['Enter a whole number from 1 to 60.']})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'payment': {'holdMinutes': 61}}),
                         {'payment.holdMinutes': ['Enter a whole number from 1 to 60.']})


class ParsePatchGameSystemTests(SimpleTestCase):
    def patch(self, game_system):
        return eb.parse_patch({'version': 1, 'gameSystem': game_system})[1]['gameSystem']

    def test_rounds_are_nullable(self):
        self.assertEqual(self.patch({'rounds': None}), {'rounds': None})
        self.assertEqual(self.patch({'rounds': 5}), {'rounds': 5})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'gameSystem': {'rounds': 21}}),
                         {'gameSystem.rounds': ['Enter a whole number from 1 to 20.']})

    def test_rated_must_be_a_boolean(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'gameSystem': {'rated': 1}}),
                         {'gameSystem.rated': ['Choose true or false.']})

    def test_pool_and_pairing_mode_are_enumerated(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'gameSystem': {'pool': 'ultra'}}),
                         {'gameSystem.pool': ['Choose one of the listed options.']})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'gameSystem': {'pairingMode': 'knockout'}}),
                         {'gameSystem.pairingMode': ['Choose one of the listed options.']})
        self.assertEqual(self.patch({'pool': 'blitz', 'pairingMode': 'swiss'}),
                         {'pool': 'blitz', 'pairingMode': 'swiss'})

    def test_time_control_length(self):
        self.assertEqual(self.patch({'timeControl': '10+5'}), {'timeControl': '10+5'})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'gameSystem': {'timeControl': 'x' * 61}}),
                         {'gameSystem.timeControl': ['Use at most 60 characters.']})


class ParsePatchMediaTests(SimpleTestCase):
    def patch(self, media):
        return eb.parse_patch({'version': 1, 'media': media})[1]['media']

    def test_asset_ids_are_canonical_lowercase_strings(self):
        asset = uuid.uuid4()
        self.assertEqual(self.patch({'assetIds': [str(asset).upper()]}), {'assetIds': [str(asset)]})

    def test_an_empty_list_clears_the_gallery(self):
        self.assertEqual(self.patch({'assetIds': []}), {'assetIds': []})

    def test_duplicates_are_rejected(self):
        asset = str(uuid.uuid4())
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'assetIds': [asset, asset]}}),
                         {'media.assetIds': ['Each asset can appear once.']})

    def test_a_bad_asset_id_names_its_index(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'assetIds': ['abc']}}),
                         {'media.assetIds.0': ['Use a valid asset id.']})

    def test_asset_id_cap(self):
        ids = [str(uuid.uuid4()) for _ in range(51)]
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'assetIds': ids}}),
                         {'media.assetIds': ['Send a list of at most 50 asset ids.']})

    def test_autoplay_must_be_a_boolean(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'autoplay': 'yes'}}),
                         {'media.autoplay': ['Send true or false.']})
        self.assertEqual(self.patch({'autoplay': True}), {'autoplay': True})

    def test_interval_bounds(self):
        message = ['Use 2000 to 60000 milliseconds.']
        for bad in (1999, 60001, 5000.5, '5000'):
            with self.subTest(bad=bad):
                self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'intervalMs': bad}}),
                                 {'media.intervalMs': message})
        self.assertEqual(self.patch({'intervalMs': 2000}), {'intervalMs': 2000})

    def test_collections_and_derived_mode_are_not_write_fields(self):
        # PLAN-010: the builder takes asset ids; the display mode is derived, collections are gone.
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'collectionId': str(uuid.uuid4())}}),
                         {'media.collectionId': [NOT_ALLOWED]})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'media': {'mode': 'carousel'}}),
                         {'media.mode': [NOT_ALLOWED]})


class ParsePatchCommunicationsTests(SimpleTestCase):
    def patch(self, communications):
        return eb.parse_patch({'version': 1, 'communications': communications})[1]['communications']

    def test_email_is_the_only_channel_and_is_not_echoed(self):
        self.assertEqual(self.patch({'channels': ['email']}), {})
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'communications': {'channels': ['sms']}}),
                         {'communications.channels': ['Email is the only channel at launch.']})

    def test_a_partial_trigger_set_is_kept_as_sent(self):
        self.assertEqual(self.patch({'triggers': {'reminder_24h': False}}),
                         {'triggers': {'reminder_24h': False}})

    def test_unknown_trigger_is_rejected(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'communications': {'triggers': {'push': True}}}),
                         {'communications.triggers.push': [NOT_ALLOWED]})

    def test_trigger_values_must_be_booleans(self):
        self.assertEqual(
            errors_of(eb.parse_patch, {'version': 1, 'communications': {'triggers': {'post_event': 1}}}),
            {'communications.triggers.post_event': ['Choose true or false.']},
        )

    def test_triggers_must_be_an_object(self):
        self.assertEqual(errors_of(eb.parse_patch, {'version': 1, 'communications': {'triggers': []}}),
                         {'communications.triggers': ['Send an object.']})


class ParsePatchReportsEveryProblemTests(SimpleTestCase):
    def test_all_errors_come_back_together(self):
        fields = errors_of(eb.parse_patch, {
            'version': 1,
            'basics': {'title': 'x' * 400, 'type': 'gala'},
            'payment': {'holdMinutes': 0},
            'gameSystem': {'rounds': 21},
        })
        self.assertEqual(set(fields), {'basics.title', 'basics.type', 'payment.holdMinutes', 'gameSystem.rounds'})
        self.assertEqual(fields['basics.title'], ['Use at most 120 characters.'])
        self.assertEqual(fields['basics.type'], ['Choose one of the listed options.'])
        self.assertEqual(fields['payment.holdMinutes'], ['Enter a whole number from 1 to 60.'])
        self.assertEqual(fields['gameSystem.rounds'], ['Enter a whole number from 1 to 20.'])

    def test_each_half_filled_row_is_reported_separately(self):
        fields = errors_of(eb.parse_patch, {
            'version': 1,
            'experience': {'highlights': [{'title': 'Only a title'}, {'title': 'Another title'}]},
        })
        message = ['Fill in both the title and the text, or remove the row.']
        self.assertEqual(fields, {'experience.highlights.0': message, 'experience.highlights.1': message})
