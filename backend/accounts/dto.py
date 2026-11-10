"""Response projections (camelCase keys inside `data`). Self-only: nothing here is ever built for another user."""
from core.responses import iso

PLAY_STYLES = ('figuring_out', 'mostly_online', 'club_player', 'tournament_player')
MOODS = ('play', 'improve', 'compete', 'meet_people')


def me_dto(user) -> dict:
    from content import runtime_settings
    threshold = runtime_settings.provisional_games()
    ratings = [
        {
            'pool': r.pool,
            'rating': max(0, min(4000, r.rating)),
            'games': r.games_played,
            'provisional': r.games_played < threshold,
        }
        for r in user.ratings.all().order_by('pool')
    ]
    return {
        'id': str(user.pk),
        'name': user.name,
        'email': user.email,
        'role': user.role,
        'profileComplete': user.profile_complete,
        'onboardingDone': user.onboarding_done,
        'mustChangePassword': user.must_change_password,
        'city': user.city or None,
        'ratings': ratings,
    }


def profile_dto(user) -> dict:
    return {
        'name': user.name,
        'email': user.email,
        'city': user.city or None,
        'area': user.area or None,
        'phone': user.phone or None,
        'birthday': user.birthday.isoformat() if user.birthday else None,
        'chessComHandle': user.chess_com_handle or None,
        'fideId': user.fide_id or None,
        'publicIdentity': {
            'showDisplayName': user.show_display_name,
            'showRatings': user.show_ratings,
            'showChessComHandle': user.show_chess_com_handle,
            'showCityChapter': user.show_city_chapter,
        },
    }


__all__ = ['me_dto', 'profile_dto', 'PLAY_STYLES', 'MOODS', 'iso']
