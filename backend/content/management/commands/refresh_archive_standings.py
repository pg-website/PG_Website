"""Rebuild the stored archive standings/winner of published archives from their real rounds.

Snapshots written before the public player profile existed carry no `publicId`, so their names render unlinked. This
recomputes them with the same code the archive publish step uses. Events without rounds (seeded demo archives) are
skipped, and nothing is saved when the snapshot is unchanged, so re-running is safe.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from content.models import Event
from registrations import room as reg_room
from registrations.models import Round


class Command(BaseCommand):
    help = 'Recompute standings and winner for completed events with a published archive.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Report what would change without saving.')

    def handle(self, *args, dry_run=False, **options):
        changed = skipped = 0
        for event in Event.objects.filter(status='completed', archive_published=True):
            rounds = list(Round.objects.filter(event=event).exclude(state='void'))
            if not rounds:
                skipped += 1
                continue
            public = reg_room.public_rows(reg_room.standings(event, rounds))
            winner = public[0]['identity'] if public else None
            if public == event.standings and winner == event.winner:
                continue
            changed += 1
            self.stdout.write(f'{"would update" if dry_run else "updating"} {event.slug}')
            if dry_run:
                continue
            with transaction.atomic():
                event.standings, event.winner = public, winner
                event.save()  # a public event save enqueues its revalidation outbox row (content.signals)
        self.stdout.write(self.style.SUCCESS(f'{changed} changed, {skipped} skipped (no rounds).'))
