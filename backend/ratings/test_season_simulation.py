"""A season of rated Swiss events: 20 players, 10 tournaments of 5 rounds, in both the blitz and the rapid pool.

The product promises a system, not a function: players arrive unrated, a season of Swiss events pairs them, moves their
ratings and orders the standings. Every step below goes through the real code, nothing is reimplemented:

    adminapi.round_service.generate_round -> publish_round -> start_round -> finalise_round
    registrations.pairing_engine (Swiss)     ratings.services.process_round (Glicko-2)
    registrations.room.standings             registrations.tiebreaks

Only two things are decided in the test: each player's hidden true strength (a fixed 40-point ladder, 1300..2060, player
00 strongest) and who wins each game — a seeded pseudo-random roll against the logistic expectation of the two true
strengths, with a 35-point white advantage and a 12% draw band. Player ids are fixed UUIDs because the pairing engine
breaks rating ties on `str(player id)`, so the season is byte-for-byte reproducible and the pinned figures below are
measured values, not guesses. If one of them fails after a change to the engine or to Glicko-2, re-measure rather than
loosen: the numbers ARE the finding.

Measured (blitz / rapid, after each of the 10 tournaments):

    t   1   2   3   4   5    6    7    8    9   10
    spread        825 894 954 914 884  859  851  887  862  845   (rapid: 814 .. 923)
    stdev         232 261 280 274 271  269  265  258  256  252   (rapid: 226 .. 265)
    mean RD       177 132 110  99  91   85   81   78   75   73
    mean |delta|   99  41  24  18  16   13   14   12   11   12
    games/player    5  10  15  20  25   30   35   40   45   50

So: five games already spread the pool by ~820 points and the spread then settles near the true 760-point range; the
size of a rating change collapses ~9x over five tournaments and then plateaus around 10-12 points a game, because every
round is its own rating period; rank correlation with the hidden strength ends at 0.980 and every tournament is won by
one of the five strongest players; tie-breaks separate every table (up to 7 players on one score) and Buchholz always
equals the opponents' scores.
"""
import random
import uuid
from collections import Counter
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from adminapi import round_service
from content.models import Event
from ratings import selectors
from ratings.models import PoolRating, RatingLedgerEntry, RatingRun
from registrations.models import Pairing, Registration, Round
from registrations.room import standings

PLAYERS = 20
TOURNAMENTS = 10
ROUNDS = 5
POOLS = ('blitz', 'rapid')
BOARDS = PLAYERS // 2
SEED = '2026-11-season'
BASE_STRENGTH = 1300
STRENGTH_STEP = 40
WHITE_ADVANTAGE = 35   # rating points the white side is worth in the result model
DRAW_BAND = 0.06       # a roll this close to the expected score is a draw (12% of games)


def strength_of(index: int) -> int:
    """The hidden truth the games follow: player 0 is the strongest, player 19 the weakest (2060 down to 1300)."""
    return BASE_STRENGTH + STRENGTH_STEP * (PLAYERS - 1 - index)


def expected_score(white_strength: int, black_strength: int) -> float:
    diff = (white_strength - black_strength) + WHITE_ADVANTAGE
    return 1 / (1 + 10 ** (-diff / 400))


def spread(values) -> int:
    return max(values) - min(values)


def stdev(values) -> float:
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5


def ranks(ratings: dict) -> list:
    """Player ids strongest first; equal ratings fall back to the id, as `current_ratings` + `_rank_key` do."""
    return sorted(ratings, key=lambda uid: (-ratings[uid], str(uid)))


class SeasonTests(TestCase):
    """The season runs once for the class (`setUpTestData`); every test below only reads what it recorded."""

    @classmethod
    def setUpTestData(cls):
        cls.now = timezone.now()
        cls.host = User.objects.create_user(id=uuid.UUID(int=999), email='host@example.com',
                                            password='test-pass-1', name='Host')
        cls.players = [
            User.objects.create_user(id=uuid.UUID(int=i + 1), email=f'player{i:02d}@example.com',
                                     password='test-pass-1', name=f'Player {i:02d}')
            for i in range(PLAYERS)
        ]
        cls.strength = {u.pk: strength_of(i) for i, u in enumerate(cls.players)}
        cls.season = {}
        # Email is not what this test is about: publishing a round would queue 20 mails per round and start a
        # delivery thread.
        with patch('comms.transactional.queue_pairing_notices', return_value=0):
            for pool in POOLS:
                cls.season[pool] = cls._run_pool(pool)

    # ------------------------------------------------------------ driving the real code

    @classmethod
    def _request(cls, key: str):
        return SimpleNamespace(user=cls.host, request_id='season-sim',
                               META={'REMOTE_ADDR': '127.0.0.1', 'HTTP_IDEMPOTENCY_KEY': key})

    @classmethod
    def _seed_ratings(cls, pool: str) -> dict:
        """Exactly what `round_service.generate_round` reads: the rounded pool rating, else the 1500 default."""
        rated = {r.user_id: int(round(r.rating)) for r in PoolRating.objects.filter(pool=pool, games__gt=0)}
        return {u.pk: rated.get(u.pk, 1500) for u in cls.players}

    @classmethod
    def _run_pool(cls, pool: str) -> dict:
        rng = random.Random(f'{SEED}:{pool}')
        events, snapshots, tables, first_rounds = [], [], [], []
        for index in range(TOURNAMENTS):
            event, first_round = cls._run_tournament(pool, index, rng)
            events.append(event)
            first_rounds.append(first_round)
            snapshots.append(cls._snapshot(pool, event))
            tables.append(standings(event, list(Round.objects.filter(event=event).order_by('number'))))
        return {'events': events, 'snapshots': snapshots, 'tables': tables, 'first_rounds': first_rounds}

    @classmethod
    def _run_tournament(cls, pool: str, index: int, rng):
        starts = cls.now + timedelta(days=7 * index)
        event = Event.objects.create(
            slug=f'{pool}-swiss-{index + 1}', title=f'{pool.title()} Swiss {index + 1}', type='social',
            status='ongoing', starts_at=starts, ends_at=starts + timedelta(hours=4),
            capacity=PLAYERS, confirmed_count=PLAYERS, rated=True, rating_pool=pool, rounds_planned=ROUNDS,
            pairing_mode='swiss', time_control='3+2' if pool == 'blitz' else '10+5', city='Pune',
            venue_name='The Club',
            # A non-draft event validates its public copy on save; the season does not depend on the wording.
            experience={'eyebrow': '', 'heading': 'Rated Swiss', 'body': '', 'highlights': []},
            at_a_glance={'membershipRequired': False, 'hostedArrival': True},
        )
        for user in cls.players:
            Registration.objects.create(user=user, event=event, status='confirmed', confirmed_at=cls.now)

        seeded = cls._seed_ratings(pool)  # taken before round 1: this is what the engine seeds with
        first_round = None
        for number in range(1, ROUNDS + 1):
            _, rnd, _ = round_service.generate_round(cls._request(f'{event.pk}:g{number}'), event.pk, number, 'swiss')
            pairings = list(Pairing.objects.filter(round=rnd).order_by('board'))
            if first_round is None:
                first_round = [(p.white_id, p.black_id) for p in pairings]
            round_service.publish_round(cls._request(f'{event.pk}:p{number}'), event.pk, rnd.pk, rnd.version)
            rnd.refresh_from_db()
            round_service.start_round(cls._request(f'{event.pk}:s{number}'), event.pk, rnd.pk, rnd.version)
            rnd.refresh_from_db()

            for pairing in pairings:  # the games the season is made of, decided by the hidden strengths
                p = expected_score(cls.strength[pairing.white_id], cls.strength[pairing.black_id])
                roll = rng.random()
                pairing.result_state = 'final'
                pairing.outcome = 'draw' if abs(roll - p) <= DRAW_BAND else ('white' if roll < p else 'black')
                pairing.finalised_at = cls.now
            Pairing.objects.bulk_update(pairings, ['result_state', 'outcome', 'finalised_at'])

            round_service.finalise_round(cls._request(f'{event.pk}:f{number}'), event.pk, rnd.pk, rnd.version)
        return event, (seeded, first_round)

    @classmethod
    def _snapshot(cls, pool: str, event) -> dict:
        rows = {r.user_id: r for r in PoolRating.objects.filter(pool=pool, user__in=cls.players)}
        ratings = {uid: int(round(r.rating)) for uid, r in rows.items()}
        ledger = list(RatingLedgerEntry.objects.filter(event_id=event.pk, pool=pool, rated=True))
        return {
            'event': event, 'ratings': ratings, 'order': ranks(ratings),
            'spread': spread(ratings.values()), 'stdev': stdev(list(ratings.values())),
            'mean_rd': sum(r.rd for r in rows.values()) / len(rows), 'max_rd': max(r.rd for r in rows.values()),
            'mean_delta': sum(abs(e.delta) for e in ledger) / len(ledger),
            'games': sorted({r.games for r in rows.values()}),
        }

    # ------------------------------------------------------------ reading the season back

    @classmethod
    def _snaps(cls, pool):
        return cls.season[pool]['snapshots']

    @classmethod
    def _final(cls, pool):
        return cls._snaps(pool)[-1]

    @classmethod
    def _game_rows(cls, event):
        return list(Pairing.objects.filter(round__event=event, is_bye=False)
                    .order_by('round__number', 'board')
                    .values_list('round__number', 'white_id', 'black_id', 'outcome'))

    @classmethod
    def _movers(cls, pool, tournament: int) -> int:
        """Players whose position after `tournament` differs from their position in the final table."""
        order, final = cls._snaps(pool)[tournament - 1]['order'], cls._final(pool)['order']
        return sum(1 for position, uid in enumerate(order) if final.index(uid) != position)

    @classmethod
    def _equal_score_share(cls, pool) -> float:
        """Share of boards in rounds 2-5 whose two players had the SAME score going into the round."""
        same = total = 0
        for event in cls.season[pool]['events']:
            running = {u.pk: 0.0 for u in cls.players}
            for number in range(1, ROUNDS + 1):
                rows = list(Pairing.objects.filter(round__event=event, round__number=number, is_bye=False)
                            .values_list('white_id', 'black_id', 'outcome'))
                if number > 1:
                    total += len(rows)
                    same += sum(1 for white, black, _ in rows if running[white] == running[black])
                for white, black, outcome in rows:
                    running[white] += 1 if outcome == 'white' else 0.5 if outcome == 'draw' else 0
                    running[black] += 1 if outcome == 'black' else 0.5 if outcome == 'draw' else 0
        return same / total

    @classmethod
    def _colour_sequences(cls, pool):
        out = []
        for event in cls.season[pool]['events']:
            colours = {}
            for _number, white, black, _outcome in cls._game_rows(event):
                colours.setdefault(white, []).append('W')
                colours.setdefault(black, []).append('B')
            out.extend(colours.values())
        return out

    @classmethod
    def _longest_colour_run(cls, pool) -> int:
        worst = 0
        for seq in cls._colour_sequences(pool):
            run = 0
            for i, colour in enumerate(seq):
                run = run + 1 if i and colour == seq[i - 1] else 1
                worst = max(worst, run)
        return worst

    @classmethod
    def _three_in_a_row(cls, pool) -> int:
        count = 0
        for seq in cls._colour_sequences(pool):
            run = 0
            for i, colour in enumerate(seq):
                run = run + 1 if i and colour == seq[i - 1] else 1
                if run == 3:
                    count += 1
        return count

    def test_the_season_is_twenty_profiles_through_ten_events_of_five_rounds_in_each_pool(self):
        self.assertEqual(len(self.players), PLAYERS)
        self.assertEqual(User.objects.filter(email__endswith='@example.com').count(), PLAYERS + 1)
        for pool in POOLS:
            self.assertEqual(len(self.season[pool]['events']), TOURNAMENTS)
            self.assertEqual({e.rating_pool for e in self.season[pool]['events']}, {pool})
        self.assertEqual(Round.objects.count(), TOURNAMENTS * ROUNDS * len(POOLS))
        self.assertEqual(Round.objects.filter(state='completed').count(), Round.objects.count())
        # 10 boards a round, and 20 players means nobody ever gets a bye.
        self.assertEqual(Pairing.objects.count(), TOURNAMENTS * ROUNDS * BOARDS * len(POOLS))
        self.assertFalse(Pairing.objects.filter(is_bye=True).exists())
        self.assertEqual(RatingRun.objects.count(), Round.objects.count())
        self.assertEqual(RatingLedgerEntry.objects.count(), Pairing.objects.count() * 2)
        self.assertTrue(all(RatingLedgerEntry.objects.values_list('rated', flat=True)))

    def test_every_player_plays_every_round_of_every_tournament(self):
        for pool in POOLS:
            for event in self.season[pool]['events']:
                played = Counter()
                for _number, white, black, _outcome in self._game_rows(event):
                    played[white] += 1
                    played[black] += 1
                with self.subTest(pool=pool, event=event.slug):
                    self.assertEqual(set(played.values()), {ROUNDS})
                    self.assertEqual(len(played), PLAYERS)

    # ------------------------------------------------------------ how far apart the ratings get

    def test_five_games_already_spread_a_flat_pool_by_about_eight_hundred_points(self):
        # All 20 players start at 1500. One tournament later the strongest is ~825 points above the weakest, which is
        # already wider than the 760-point range of the hidden strengths: early ratings are loud, not accurate.
        self.assertEqual(self._snaps('blitz')[0]['spread'], 825)
        self.assertEqual(self._snaps('rapid')[0]['spread'], 814)
        self.assertAlmostEqual(self._snaps('blitz')[0]['stdev'], 232.5, places=1)
        self.assertAlmostEqual(self._snaps('rapid')[0]['stdev'], 225.8, places=1)

    def test_the_spread_settles_near_the_true_range_instead_of_running_away(self):
        # The true range is 19 * 40 = 760 points. The season ends at 845 (blitz) and 923 (rapid) — close, and never
        # beyond the 1000-point noisiest tournament in the middle of the season.
        true_range = STRENGTH_STEP * (PLAYERS - 1)
        self.assertEqual(self._final('blitz')['spread'], 845)
        self.assertEqual(self._final('rapid')['spread'], 923)
        for pool in POOLS:
            spreads = [snap['spread'] for snap in self._snaps(pool)]
            with self.subTest(pool=pool):
                self.assertLessEqual(max(spreads), 1000)
                self.assertGreaterEqual(min(spreads), 700)
                self.assertLessEqual(abs(spreads[-1] - true_range), 200)

    def test_the_rating_gap_between_the_strongest_and_weakest_widens(self):
        for pool in POOLS:
            first, last = self._snaps(pool)[0], self._final(pool)
            strongest, weakest = self.players[0].pk, self.players[-1].pk
            with self.subTest(pool=pool):
                self.assertGreater(first['ratings'][strongest], first['ratings'][weakest])
                self.assertGreater(last['ratings'][strongest], last['ratings'][weakest])
                self.assertGreater(last['stdev'], first['stdev'])
                self.assertGreater(last['ratings'][strongest], 1800)
                self.assertLess(last['ratings'][weakest], 1300)

    def test_the_final_order_follows_the_hidden_strength(self):
        # 50 games per player, ranks against the truth: 0.980 in both pools, and the five genuinely strongest
        # players all finish in the top six of both pools.
        for pool in POOLS:
            ratings = self._final(pool)['ratings']
            truth = {uid: self.strength[uid] for uid in ratings}
            order = ranks(ratings)
            with self.subTest(pool=pool):
                self.assertAlmostEqual(self._spearman(truth, ratings), 0.980, places=3)
                five = set(sorted(truth, key=lambda uid: -truth[uid])[:5])
                self.assertLessEqual(max(order.index(uid) for uid in five) + 1, 6)
        self.assertEqual(self._final('blitz')['ratings'][self.players[0].pk], 1893)
        self.assertEqual(self._final('blitz')['ratings'][self.players[-1].pk], 1085)
        self.assertEqual(self._final('rapid')['ratings'][self.players[0].pk], 2033)
        self.assertEqual(self._final('rapid')['ratings'][self.players[-1].pk], 1110)

    def test_every_tournament_is_won_by_one_of_the_five_strongest_players(self):
        best = set(sorted(self.strength, key=lambda uid: -self.strength[uid])[:5])
        for pool in POOLS:
            winners = [table[0]['_uid'] for table in self.season[pool]['tables']]
            with self.subTest(pool=pool):
                self.assertEqual(len(winners), TOURNAMENTS)
                self.assertTrue(all(w in best for w in winners))

    def test_the_two_pools_are_separate_series(self):
        blitz = {r.user_id: round(r.rating) for r in PoolRating.objects.filter(pool='blitz')}
        rapid = {r.user_id: round(r.rating) for r in PoolRating.objects.filter(pool='rapid')}
        self.assertEqual((len(blitz), len(rapid)), (PLAYERS, PLAYERS))
        self.assertEqual(set(blitz), set(rapid))
        self.assertTrue(all(blitz[uid] != rapid[uid] for uid in blitz))
        self.assertEqual(RatingLedgerEntry.objects.filter(pool='blitz').count(),
                         RatingLedgerEntry.objects.filter(pool='rapid').count())
        self.assertNotEqual(self._final('blitz')['order'], self._final('rapid')['order'])

    @staticmethod
    def _spearman(a: dict, b: dict) -> float:
        def rank(values):
            return {uid: i for i, uid in enumerate(sorted(values, key=lambda key: values[key]))}
        ra, rb = rank(a), rank(b)
        mean = (len(a) - 1) / 2
        cov = sum((ra[u] - mean) * (rb[u] - mean) for u in a)
        return cov / (sum((ra[u] - mean) ** 2 for u in a) ** 0.5 * sum((rb[u] - mean) ** 2 for u in b) ** 0.5)

    # ------------------------------------------------------------ when the ratings settle

    def test_uncertainty_falls_every_single_tournament(self):
        # RD starts at 350 (Glicko-2 default) and only ever shrinks while the player keeps playing: 177 after one
        # tournament, ~73 after the season. Both the mean and the most uncertain player fall monotonically.
        for pool in POOLS:
            snaps = self._snaps(pool)
            for tournament, (earlier, later) in enumerate(zip(snaps, snaps[1:]), start=2):
                with self.subTest(pool=pool, tournament=tournament):
                    self.assertLess(later['mean_rd'], earlier['mean_rd'])
                    self.assertLess(later['max_rd'], earlier['max_rd'])
            self.assertAlmostEqual(snaps[0]['mean_rd'], 176.5 if pool == 'blitz' else 175.7, places=1)
            self.assertAlmostEqual(snaps[-1]['mean_rd'], 73.3 if pool == 'blitz' else 72.3, places=1)

    def test_a_rating_stops_being_provisional_after_two_tournaments(self):
        threshold = selectors.provisional_threshold()
        for pool in POOLS:
            for tournament, snap in enumerate(self._snaps(pool), start=1):
                games = tournament * ROUNDS
                with self.subTest(pool=pool, tournament=tournament):
                    self.assertEqual(snap['games'], [games])
                    self.assertEqual(selectors.pool_state(games),
                                     'established' if games >= threshold else 'provisional')
        self.assertEqual(threshold, 10)  # two tournaments of 5 rounds
        self.assertEqual(self._season_summary('blitz', 0)['state'], 'established')

    def test_the_size_of_a_rating_change_collapses_and_then_plateaus(self):
        # 99 points a game after the first tournament, 13 after the fifth, 11-12 by the end: an ~9x fall that then
        # flattens, because every round is its own rating period.
        self.assertAlmostEqual(self._snaps('blitz')[0]['mean_delta'], 99.45, places=2)
        self.assertAlmostEqual(self._snaps('rapid')[0]['mean_delta'], 94.69, places=2)
        self.assertAlmostEqual(self._final('blitz')['mean_delta'], 11.55, places=2)
        self.assertAlmostEqual(self._final('rapid')['mean_delta'], 9.02, places=2)
        for pool in POOLS:
            deltas = [snap['mean_delta'] for snap in self._snaps(pool)]
            with self.subTest(pool=pool):
                self.assertGreater(deltas[0], 5 * deltas[4])
                for later in deltas[6:]:
                    self.assertLessEqual(later, 15)
                self.assertGreaterEqual(deltas[-1], 5)  # still moving, not frozen

    def test_the_table_keeps_reordering_after_the_numbers_have_settled(self):
        # The magnitude of a change settles around tournament five or six; the ORDER between near-equal players does
        # not — 17 (blitz) and 14 (rapid) of 20 places still differ from the final table after five tournaments, and
        # ~11/6 after nine. Neighbours swap long after the numbers stop moving.
        for pool in POOLS:
            with self.subTest(pool=pool):
                self.assertGreaterEqual(self._movers(pool, 5), 8)
                self.assertLessEqual(self._movers(pool, 9), 11)
                self.assertGreater(self._movers(pool, 9), 0)
        self.assertEqual(self._movers('blitz', 5), 17)
        self.assertEqual(self._movers('rapid', 5), 14)

    def test_the_published_summary_agrees_with_the_ledger_at_season_end(self):
        for pool, expected in (('blitz', 1893), ('rapid', 2033)):
            summary = self._season_summary(pool, 0)
            row = PoolRating.objects.get(user=self.players[0], pool=pool)
            last = (RatingLedgerEntry.objects.filter(user=self.players[0], pool=pool, rated=True)
                    .order_by('-created', '-id').first())
            with self.subTest(pool=pool):
                self.assertEqual((summary['rating'], summary['games'], summary['state']),
                                 (expected, 50, 'established'))
                self.assertEqual(summary['rd'], int(round(row.rd)))
                self.assertEqual(summary['lastChange'], last.delta)

    def _season_summary(self, pool: str, index: int) -> dict:
        return selectors.ratings_summary_for(self.players[index])[pool]

    # ------------------------------------------------------------ the tables and their tie-breaks

    def test_points_then_buchholz_order_every_one_of_the_twenty_tables(self):
        for pool in POOLS:
            for tournament, table in enumerate(self.season[pool]['tables'], start=1):
                keys = [(row['score'], row['buchholz']) for row in table]
                with self.subTest(pool=pool, tournament=tournament):
                    self.assertEqual(keys, sorted(keys, key=lambda key: (-key[0], -key[1])))
                    self.assertEqual(table[0]['place'], 1)
                    self.assertEqual(table[0]['score'], max(row['score'] for row in table))

    def test_a_shared_place_only_happens_when_points_and_buchholz_are_equal(self):
        for pool in POOLS:
            for tournament, table in enumerate(self.season[pool]['tables'], start=1):
                places = [row['place'] for row in table]
                with self.subTest(pool=pool, tournament=tournament):
                    self.assertEqual(places, sorted(places))
                    self.assertEqual(max(places), len(table))
                    for index, row in enumerate(table):
                        self.assertLessEqual(row['place'], index + 1)
                        if index and row['place'] == table[index - 1]['place']:
                            self.assertEqual((row['score'], row['buchholz']),
                                             (table[index - 1]['score'], table[index - 1]['buchholz']))

    def test_buchholz_is_always_the_sum_of_the_opponents_final_scores(self):
        # Recomputed from the games and the players' points, not from the tie-break module: 400 rows, every pool.
        checked = 0
        for pool in POOLS:
            for event, table in zip(self.season[pool]['events'], self.season[pool]['tables']):
                score = {row['_uid']: row['score'] for row in table}
                opponents = {row['_uid']: [] for row in table}
                for _number, white, black, _outcome in self._game_rows(event):
                    opponents[white].append(black)
                    opponents[black].append(white)
                for row in table:
                    with self.subTest(pool=pool, event=event.slug, player=row['identity']['displayName']):
                        self.assertEqual(row['buchholz'], sum(score[o] for o in opponents[row['_uid']]))
                        self.assertEqual(row['rounds'], ROUNDS)
                        checked += 1
        self.assertEqual(checked, TOURNAMENTS * PLAYERS * len(POOLS))

    def test_every_table_contains_a_real_tie_that_the_tie_breaks_have_to_separate(self):
        # Points alone are never enough in a 20-player Swiss: every tournament ends with a group of players on the same
        # score (up to 7 of them), and Buchholz is what divides them.
        for pool in POOLS:
            for tournament, table in enumerate(self.season[pool]['tables'], start=1):
                groups = {}
                for row in table:
                    groups.setdefault(row['score'], []).append(row)
                tied = {score: rows for score, rows in groups.items() if len(rows) > 1}
                with self.subTest(pool=pool, tournament=tournament):
                    self.assertTrue(tied, 'a 20-player Swiss with 5 rounds must produce a tie')
                    self.assertGreaterEqual(max(len(rows) for rows in tied.values()), 2)
                    separated = [rows for rows in tied.values()
                                 if len({row['buchholz'] for row in rows}) > 1]
                    self.assertTrue(separated, 'a tie group must be ordered by Buchholz')
        self.assertEqual(max(max(Counter(row['score'] for row in table).values())
                             for pool in POOLS for table in self.season[pool]['tables']), 7)

    # ------------------------------------------------------------ seeding and who meets whom

    def test_round_one_always_seeds_the_top_half_against_the_bottom_half(self):
        # The engine sorts by (score, rating, id) and pairs rank i with rank i+10. Checked against the ratings the
        # generator itself read (snapshot taken just before round 1), for all 20 first rounds.
        for pool in POOLS:
            for index, (seeded, first_round) in enumerate(self.season[pool]['first_rounds']):
                order = sorted(self.players, key=lambda user: (-seeded[user.pk], str(user.pk)))
                expected = {frozenset((order[i].pk, order[i + BOARDS].pk)) for i in range(BOARDS)}
                with self.subTest(pool=pool, tournament=index + 1):
                    self.assertEqual({frozenset(board) for board in first_round}, expected)
                    self.assertEqual(frozenset(first_round[0]), frozenset((order[0].pk, order[BOARDS].pk)))

    def test_the_first_tournament_cannot_seed_because_everyone_is_unrated(self):
        # Nobody has a rating yet, so all 20 are 1500 and round 1 falls back to the id order: board 1 is player 00
        # against player 10, and the colour rule gives the stronger player black on board one.
        for pool in POOLS:
            seeded, _first_round = self.season[pool]['first_rounds'][0]
            with self.subTest(pool=pool):
                self.assertEqual(set(seeded.values()), {1500})
        seeded, first_round = self.season['blitz']['first_rounds'][0]
        self.assertEqual(first_round[0], (self.players[BOARDS].pk, self.players[0].pk))
        self.assertEqual(first_round[:2], [(self.players[10].pk, self.players[0].pk),
                                           (self.players[1].pk, self.players[11].pk)])

    def test_seeding_follows_the_ratings_once_they_exist(self):
        # From tournament two on, board one is the current top player against the current middle player, not the
        # strongest against the second strongest.
        for pool in POOLS:
            for index in range(1, TOURNAMENTS):
                seeded, first_round = self.season[pool]['first_rounds'][index]
            order = sorted(self.players, key=lambda user: (-seeded[user.pk], str(user.pk)))
                with self.subTest(pool=pool, tournament=index + 1):
                    self.assertEqual(first_round[0], (order[BOARDS].pk, order[0].pk))
                    self.assertNotEqual(set(first_round[0]), {order[0].pk, order[1].pk})

    def test_nobody_meets_the_same_opponent_twice_in_a_tournament(self):
        for pool in POOLS:
            for event in self.season[pool]['events']:
                pairs = [frozenset((white, black)) for _n, white, black, _o in self._game_rows(event)]
                with self.subTest(pool=pool, event=event.slug):
                    self.assertEqual(len(pairs), len(set(pairs)))
                    self.assertEqual(len(pairs), BOARDS * ROUNDS)

    def test_later_rounds_pair_players_on_equal_scores(self):
        # 72% (blitz) / 66% (rapid) of boards in rounds 2-5 are score-group games; the rest are the pairs forced by
        # an odd score group or by a rematch that is not allowed.
        for pool, expected in (('blitz', 0.72), ('rapid', 0.66)):
            with self.subTest(pool=pool):
                self.assertAlmostEqual(self._equal_score_share(pool), expected, delta=0.02)

    def test_colours_mostly_alternate(self):
        # The engine avoids a third colour in a row where it can. It cannot always: two players who both need black
        # get one each, so ~5% of player-tournaments (11 and 10 of 200) still run three, and once four.
        for pool in POOLS:
            with self.subTest(pool=pool):
                self.assertLessEqual(self._longest_colour_run(pool), 4)
                self.assertLessEqual(self._three_in_a_row(pool), 15)
        self.assertEqual(self._longest_colour_run('blitz'), 3)
        self.assertEqual(self._three_in_a_row('blitz'), 11)
