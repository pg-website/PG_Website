"""Starter content, translated from web/src/lib/mock/seeds/*.ts (copy, slugs and values kept verbatim).

Event dates are RELATIVE to the moment the seed runs (days offset + IST wall-clock time), mirroring `mockIstAt`, except
the completed Monsoon Open, which keeps its fixed 2026-09-13 date. Site sections reference media collections by key
(`{"collection": key}`); the DTO layer resolves them at read time.
"""
from __future__ import annotations

TILES = {
    '1x1': ('/placeholders/tile-1x1.png', 800, 800),
    '4x3': ('/placeholders/tile-4x3.png', 1200, 900),
    '3x2': ('/placeholders/tile-3x2.png', 1200, 800),
    '16x9': ('/placeholders/tile-16x9.png', 1600, 900),
    '4x5': ('/placeholders/tile-4x5.png', 800, 1000),
}


def tile(name, alt, x=0.5, y=0.5):
    src, w, h = TILES[name]
    return {'src': src, 'width': w, 'height': h, 'alt': alt, 'focal': (x, y), 'blur': ''}


_B = 'data:image/png;base64,'
HOME_IMAGES = {
    'hero': ('/assets/home-hero-players-at-board.avif', 2200, 2750,
             _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIElEQVR42mN4dWEPVsTEwMSMFTH9Z2LGivDpwI6oaAcAFH0st3nCjIoAAAAASUVORK5CYII='),
    'card1': ('/placeholders/home-card-1.png', 960, 720,
              _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAHUlEQVR42mP48v4ZVsT0/88vrIjp3+9fWNGA6gAA5rC7v1DWZA8AAAAASUVORK5CYII='),
    'card2': ('/placeholders/home-card-2.png', 960, 720,
              _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIklEQVR42mP4/eMTVsT0/esXrIjp27cvWBE+HZ+xIiraAQAF6Lgvon2TBgAAAABJRU5ErkJggg=='),
    'card3': ('/placeholders/home-card-3.png', 960, 720,
              _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAHUlEQVR42mO4OKsUK2Ji4uDGjkiXYOTkwYqoaAcAmPwTr6K2HPAAAAAASUVORK5CYII='),
    'firstVisit': ('/placeholders/home-first-visit.png', 1200, 900,
                   _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAJElEQVR42mN4fu8CVsT099tnrIjp7/fPWBFuHX++fcaKqGgHAKtatw8PEJF2AAAAAElFTkSuQmCC'),
    'stands': ('/placeholders/home-stands.png', 960, 1200,
               _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIUlEQVR42mPwTAjCiph+//yFFTH9wgFw6/j96xdWREU7AN6bq/+Kyld/AAAAAElFTkSuQmCC'),
    'story': ('/placeholders/home-story.png', 1200, 900,
              _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIElEQVR42mO4d/kwVsT0Gwdg+oUD4Nbx+/cvrIiKdgAApKq4L18G3OoAAAAASUVORK5CYII='),
    'finalCta': ('/placeholders/home-final-cta.png', 1920, 1080,
                 _B + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIUlEQVR42mMwdLHAipj+/P6DFTH9/fMHK8Ktg3QJku0AAH1kqr8U9pggAAAAAElFTkSuQmCC'),
}


def home_image(name, alt, x, y):
    src, w, h, blur = HOME_IMAGES[name][0], HOME_IMAGES[name][1], HOME_IMAGES[name][2], HOME_IMAGES[name][3]
    return {'src': src, 'width': w, 'height': h, 'alt': alt, 'focal': (x, y), 'blur': blur}


# ---- media: asset key -> asset fields; collection key -> [asset keys] ----
ASSETS = {
    'home-hero': home_image('hero', 'People enjoying a chess game together in a warm cafe, two players smiling across the board', 0.55, 0.4),
    'home-first-visit': home_image('firstVisit', 'A relaxed chess game over coffee, a newcomer and a regular sharing a small table', 0.5, 0.45),
    'home-stands': home_image('stands', 'A group gathered around chess boards, watching a game and talking between moves', 0.5, 0.35),
    'home-story': home_image('story', 'A warm cafe filled with people playing chess at long wooden tables', 0.4, 0.5),
    'home-final-cta': home_image('finalCta', 'A lively evening of social chess in a cafe, every table busy under warm lights', 0.5, 0.6),
    'cover-saturday-social': home_image('card1', 'Two friends mid-game at a sunny cafe table, coffee cups beside the board', 0.5, 0.42),
    'cover-beginner-circle': home_image('card2', 'A host leaning in to show a new player a move on a wooden board', 0.45, 0.38),
    'cover-after-work-blitz': home_image('card3', 'A hand pressing a chess clock during a fast evening game', 0.6, 0.55),
    'cover-monsoon-open': tile('4x3', 'Players studying boards during the Monsoon Open'),
    'gallery-monsoon-open-1': tile('3x2', 'The playing hall during round six'),
    'cover-story-clubs': tile('3x2', 'Players chatting between games at a cafe table'),
    'cover-story-monsoon': tile('16x9', 'The Monsoon Open playing hall'),
    'portrait-nikhil-varma': tile('1x1', 'Portrait of Nikhil Varma'),
    'portrait-meera-joshi': tile('1x1', 'Portrait of Meera Joshi'),
    'portrait-karan-iyer': tile('1x1', 'Portrait of Karan Iyer'),
}

# Collections: key -> asset keys (single item = static, 2+ = carousel). An empty list is the "none" placeholder.
COLLECTIONS = {
    'home-hero': ['home-hero'],
    'home-first-visit': ['home-first-visit'],
    'home-stands': ['home-stands'],
    'home-story': ['home-story'],
    'home-final-cta': ['home-final-cta'],
    'community-hero': [],
    'event-saturday-social': ['cover-saturday-social'],
    'event-beginner-circle': ['cover-beginner-circle'],
    'event-after-work-blitz': ['cover-after-work-blitz'],
    'event-monsoon-open': ['cover-monsoon-open'],
    'gallery-monsoon-open': ['gallery-monsoon-open-1'],
}


def ref(key):
    return {'collection': key}


# ---- site sections ----
SECTIONS = {
    'home': {
        'hero': {
            'eyebrow': 'Social chess, done properly.',
            'headlineLine1': 'Good games.',
            'headlineAccent': 'Better company.',
            'lead': 'Come for the chess. Stay for the people.',
            'body': 'We’ll know your name, find you a good game, introduce you around, and make your first visit feel easy.',
            'proofPoints': ['Beginners welcome', 'Come solo', 'No membership needed'],
            'primaryCta': {'label': 'Find my next game', 'href': '/play'},
            'secondaryCta': {'label': 'Meet the community', 'href': '/community'},
            'media': ref('home-hero'),
        },
        'upcoming': {
            'eyebrow': 'Next at PG',
            'title': 'Upcoming games',
            'intro': 'Pick the kind of chess you feel like playing. We’ll take it from there.',
            'cta': {'label': 'See all events', 'href': '/play'},
        },
        'firstVisit': {
            'eyebrow': 'First time?',
            'headline': 'You bring the curiosity. We’ll take care of the rest.',
            'body': 'Walk in alone if you like. We’ll welcome you by name, introduce you around, find you a good first game, and make sure you’re never left wondering what to do next.',
            'cta': {'label': 'I’m new to PG', 'href': '/welcome'},
            'promises': [
                {'title': 'A real welcome', 'body': 'Someone from PG knows you’re new and makes the first hello easy.'},
                {'title': 'A thoughtful pairing', 'body': 'We match for the game you want, not just a number beside your name.'},
                {'title': 'An easy introduction', 'body': 'No hovering around. No breaking into closed circles.'},
                {'title': 'Another game, if you want it', 'body': 'We keep the night moving without making it feel managed.'},
            ],
            'media': ref('home-first-visit'),
        },
        'stands': {
            'eyebrow': 'What PG stands for',
            'headline': 'A chess club people actually come back to.',
            'body': 'Ratings matter across the board. People matter off it. PG is built for strong games, easy conversation and the kind of familiarity that makes a city feel smaller.',
            'principles': [
                {'title': 'Come alone.', 'body': 'You won’t stay anonymous for long.'},
                {'title': 'Play seriously.', 'body': 'Take yourself lightly.'},
                {'title': 'Make room.', 'body': 'The next regular may be walking in for the first time.'},
            ],
            'media': ref('home-stands'),
        },
        'moreThanAGame': {
            'eyebrow': 'More than a game',
            'headline': 'A place to think, meet and come back to.',
            'body': 'PG creates regular places for chess to happen in real life: cafés, cultural spaces and partner venues where the game is taken seriously and people are treated generously.',
            'media': ref('home-story'),
            'cta': {'label': 'Our story', 'href': '/community'},
        },
        'finalCta': {
            'eyebrow': 'Your next game',
            'headline': 'Come for a game. Stay for the people.',
            'body': 'Tell us how you like to play. We’ll help you find the next table worth sitting at.',
            'media': ref('home-final-cta'),
            'cta': {'label': 'Find a game', 'href': '/play'},
        },
    },
    'community': {
        'hero': {
            'eyebrow': 'Community',
            'headline': 'A club built around the people who show up.',
            'lead': 'Regulars, first-timers and everyone in between share the same tables.',
            'media': ref('community-hero'),
        },
        'principles': [
            {'title': 'Welcome first', 'body': 'Every newcomer gets a host and a first game.'},
            {'title': 'Fair play', 'body': 'Strong games, generous manners.'},
        ],
        'hospitality': {
            'eyebrow': 'Hospitality',
            'headline': 'We look after the room.',
            'body': 'Good coffee, clear communication and a host who knows your name.',
            'cta': {'label': 'Contact us', 'href': '/contact'},
        },
    },
    'nav': {
        'primary': [
            {'label': 'Play', 'href': '/play'},
            {'label': 'Community', 'href': '/community'},
            {'label': 'Stories', 'href': '/stories'},
            {'label': 'Past events', 'href': '/past-events'},
        ],
        'authCta': {'label': 'Log in', 'href': '/login'},
    },
    'footer': {
        'tagline': 'Good games. Better company.',
        'links': [
            {'label': 'Community', 'href': '/community'},
            {'label': 'Contact', 'href': '/contact'},
            {'label': 'Privacy', 'href': '/privacy'},
            {'label': 'Terms', 'href': '/terms'},
            {'label': 'Refund policy', 'href': '/refund-policy'},
        ],
        'social': [{'label': 'Instagram', 'href': 'https://www.instagram.com/example'}],
        'legalNote': None,
    },
    'meta': {
        'siteName': "Pawn's Gambit",
        'titleTemplate': "%s | Pawn's Gambit",
        'description': 'Social chess in Hyderabad. Good games, better company, beginners welcome.',
        'defaultCity': 'Hyderabad',
    },
}

PUBLIC_SETTINGS = {
    'support_email': 'desk@example.com',
    'desk_contact_href': 'https://wa.me/910000000000',
    'social': [{'label': 'Instagram', 'href': 'https://www.instagram.com/example'}],
    'default_city': 'Hyderabad',
}

# ---- events ----
VENUE = {
    'area': 'Jubilee Hills', 'city': 'Hyderabad', 'venue_name': 'The Open Board Cafe',
    'address': '12 Sample Road, Jubilee Hills, Hyderabad',
}
EXPERIENCE = {
    'eyebrow': 'First time?',
    'heading': 'You bring the curiosity. We will take care of the rest.',
    'body': 'Someone from PG greets you at the door, finds you a good first game and introduces you around.',
    'highlights': [
        {'title': 'A real welcome', 'body': 'A host knows you are new and makes the first hello easy.'},
        {'title': 'A thoughtful pairing', 'body': 'We match for the game you want, not only a number.'},
    ],
}
FAQ = [
    {'question': 'Do I need to be a member?', 'answer': 'No. Walk in, play, and decide later.'},
    {'question': 'Can I come alone?', 'answer': 'Yes. Most people do. We will find you a game.'},
]
LOGISTICS = ['Doors open 30 minutes before the start.', 'Boards and clocks are provided.']

# (day offset, 'HH:MM') are relative to the seed day in IST. `confirmed` yields the availability numbers.
EVENTS = [
    {
        'slug': 'saturday-social', 'title': 'Saturday Social',
        'promise': 'Easy games. Good coffee. Stay for another.',
        'description': 'A relaxed afternoon of friendly chess for every level. Come alone, leave with a new rival.',
        'type': 'social', 'audience': 'all_levels', 'status': 'registration_open',
        'starts': (1, '17:00'), 'ends': (1, '20:30'), 'format': 'Social chess', 'time_control': '15+10',
        'price_paise': 0, 'rated': False, 'rating_pool': '', 'pairing_mode': 'social_balanced',
        'first_timer_count': 7, 'capacity': 30, 'confirmed': 18,  # 12 places left
        'opens': (-13, '10:00'), 'closes': (1, '15:00'), 'waitlist': True,
        'updated': (-3, '12:00'), 'cover': 'cover-saturday-social', 'collection': 'event-saturday-social',
    },
    {
        'slug': 'beginner-circle', 'title': 'Beginner Circle',
        'promise': 'Your first over-the-board game, minus the awkward bit.',
        'description': 'A guided morning for new players: a short warm-up, hosted games and no pressure.',
        'type': 'workshop', 'audience': 'beginner', 'status': 'registration_open',
        'starts': (2, '11:00'), 'ends': (2, '14:00'), 'format': 'Guided beginner games', 'time_control': '15+10',
        'price_paise': 20000, 'rated': False, 'rating_pool': '', 'pairing_mode': 'none',
        'first_timer_count': 11, 'capacity': 20, 'confirmed': 14,  # 6 left
        'opens': (-13, '10:00'), 'closes': (2, '09:00'), 'waitlist': True,
        'updated': (-3, '12:00'), 'cover': 'cover-beginner-circle', 'collection': 'event-beginner-circle',
    },
    {
        'slug': 'after-work-blitz', 'title': 'After Work Blitz',
        'promise': 'Clock on. Work off.',
        'description': 'Fast, friendly 5+2 blitz after the working day. Rated games, loud clocks.',
        'type': 'rated_tournament', 'audience': 'all_levels', 'status': 'sold_out',
        'starts': (5, '19:30'), 'ends': (5, '22:30'), 'format': '5+2 Blitz', 'time_control': '5+2',
        'price_paise': 30000, 'rated': True, 'rating_pool': 'blitz', 'pairing_mode': 'swiss',
        'first_timer_count': 3, 'capacity': 24, 'confirmed': 24,  # full, waitlist open
        'opens': (-11, '10:00'), 'closes': (5, '17:00'), 'waitlist': True,
        'updated': (-2, '12:00'), 'cover': 'cover-after-work-blitz', 'collection': 'event-after-work-blitz',
    },
    {
        'slug': 'monsoon-open', 'title': 'Monsoon Open',
        'promise': 'Nine rounds, one room, plenty to argue about afterwards.',
        'description': 'A nine-round open that closed the monsoon season. Final standings and recap below.',
        'type': 'rated_tournament', 'audience': 'all_levels', 'status': 'completed',
        'starts_abs': '2026-09-13T10:00:00+05:30', 'ends_abs': '2026-09-13T19:00:00+05:30',
        'format': 'Swiss, 9 rounds', 'time_control': '15+5',
        'price_paise': 50000, 'rated': True, 'rating_pool': 'rapid', 'pairing_mode': 'swiss',
        'first_timer_count': 0, 'capacity': 32, 'confirmed': 32,
        'opens_abs': '2026-08-20T10:00:00+05:30', 'closes_abs': '2026-09-12T18:00:00+05:30', 'waitlist': False,
        'cover': 'cover-monsoon-open', 'collection': 'event-monsoon-open',
        'archive': {
            'published': True,
            'recap': 'Thirty-two players, nine rounds and a final-round decider that kept the room watching.',
            'winner': {'displayName': 'Asha Rao', 'initials': 'AR', 'rating': {'pool': 'rapid', 'value': 1720},
                       'cityChapter': 'Hyderabad'},
            'standings': [
                {'place': 1, 'identity': {'displayName': 'Asha Rao', 'initials': 'AR',
                                          'rating': {'pool': 'rapid', 'value': 1720}, 'cityChapter': 'Hyderabad'},
                 'score': 8, 'rounds': 9, 'rating': {'pool': 'rapid', 'value': 1720}},
                {'place': 2, 'identity': {'displayName': 'Dev Menon', 'initials': 'DM', 'rating': None,
                                          'cityChapter': None},
                 'score': 7.5, 'rounds': 9, 'rating': None},
                {'place': 3, 'identity': {'displayName': 'Ira Kapoor', 'initials': 'IK',
                                          'rating': {'pool': 'rapid', 'value': 1540}, 'cityChapter': 'Hyderabad'},
                 'score': 7, 'rounds': 9, 'rating': {'pool': 'rapid', 'value': 1540}},
            ],
            'rounds_played': 9,
            'gallery': 'gallery-monsoon-open',
        },
    },
]

# ---- stories ----
STORIES = [
    {
        'slug': 'the-best-clubs-are-not-about-chess', 'kind': 'club_notes', 'eyebrow': 'Club notes',
        'title': 'The best chess clubs are not really about chess',
        'dek': 'What happens between the games is often the reason people come back for another one.',
        'published_on': '2026-10-05', 'reading_minutes': 4, 'featured': True, 'cover': 'cover-story-clubs',
        'body': [
            {'type': 'paragraph', 'text': 'Ask a regular why they keep coming back and the answer is rarely an opening.'},
            {'type': 'heading', 'level': 2, 'text': 'The room matters'},
            {'type': 'paragraph', 'text': 'A familiar face at the door, a board already set up, an invitation to play one more.'},
            {'type': 'quote', 'text': 'I came for one game and stayed for four.', 'attribution': 'A Saturday regular'},
            {'type': 'list', 'ordered': False, 'items': ['Say hello first', 'Offer a second game', 'Learn one name each night']},
        ],
    },
    {
        'slug': 'monsoon-open-in-photographs', 'kind': 'event_notes', 'eyebrow': 'Event notes',
        'title': 'Nine rounds, one room, plenty to argue about afterwards',
        'dek': 'The Monsoon Open in photographs, final standings and the games that had a crowd around them.',
        'published_on': '2026-09-16', 'reading_minutes': 6, 'featured': False, 'cover': 'cover-story-monsoon',
        'body': [
            {'type': 'paragraph', 'text': 'Thirty-two players filled the hall for a long day of rapid chess.'},
            {'type': 'image', 'media': {'src': '/placeholders/tile-3x2.png', 'width': 1200, 'height': 800,
                                        'decorative': False, 'alt': 'Two players deep in thought over a board',
                                        'focal': {'x': 0.5, 'y': 0.5}},
             'caption': 'Round six, board one.'},
            {'type': 'paragraph', 'text': 'The final round decided the title, and the room stayed to watch.'},
            {'type': 'link', 'label': 'See the event archive', 'href': '/events/monsoon-open'},
        ],
    },
    {
        'slug': 'why-repeat-opponents-matter', 'kind': 'rivalries', 'eyebrow': 'Rivalries',
        'title': 'Somebody you want to play again is a good reason to return',
        'dek': 'Why repeat opponents matter more than another anonymous leaderboard.',
        'published_on': '2026-08-28', 'reading_minutes': 3, 'featured': False, 'cover': None,
        'body': [
            {'type': 'paragraph', 'text': 'A rating tells you how strong someone is. A rematch tells you who they are.'},
            {'type': 'paragraph', 'text': 'The friendliest rivalries start with a draw nobody was happy about.'},
        ],
    },
]

# ---- testimonials (consent timestamp is set at seed time: the people are fictional) ----
TESTIMONIALS = [
    {'id': '6f0b1c1a-1f0e-4f5e-9a3c-000000000001', 'quote': 'I walked in alone and was playing within five minutes. Nobody made it awkward.',
     'name': 'Nikhil Varma', 'descriptor': 'First-time visitor', 'portrait': 'portrait-nikhil-varma'},
    {'id': '6f0b1c1a-1f0e-4f5e-9a3c-000000000002', 'quote': 'The pairings are thoughtful. I get games that are hard but never hopeless.',
     'name': 'Meera Joshi', 'descriptor': 'Weekend regular', 'portrait': 'portrait-meera-joshi'},
    {'id': '6f0b1c1a-1f0e-4f5e-9a3c-000000000003', 'quote': 'Strong chess, warm room. It is the one place I bring friends who do not play.',
     'name': 'Karan Iyer', 'descriptor': 'Blitz regular', 'portrait': 'portrait-karan-iyer'},
]

# ---- legal ----
def _legal(page, title, text):
    return {
        'page': page, 'title': title, 'effective_date': '2026-10-01',
        'blocks': [
            {'type': 'paragraph', 'text': text},
            {'type': 'heading', 'level': 2, 'text': 'Questions'},
            {'type': 'paragraph', 'text': 'Write to the event desk and we will answer within two working days.'},
        ],
    }


LEGAL = [
    _legal('privacy', 'Privacy policy', 'Sample text: we collect only what is needed to run events.'),
    _legal('terms', 'Terms of use', 'Sample text: play fair, be kind, and respect the venue.'),
    _legal('refund-policy', 'Refund policy', 'Sample text: cancel before the window closes for a refund.'),
]
