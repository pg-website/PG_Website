"""Load the approved legal wording (content/legal_texts.py) into the live legal pages, validating blocks first.

    python manage.py load_legal_pages            # every page defined in legal_texts.LEGAL_PAGES
    python manage.py load_legal_pages terms      # just one

Touches only the named LegalPage rows. Safe to re-run.
"""
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from content import legal_texts as t
from content import validation as v
from content.models import LegalPage


class Command(BaseCommand):
    help = 'Replace live legal pages with the approved wording.'

    def add_arguments(self, parser):
        parser.add_argument('pages', nargs='*', help=f'Subset of: {", ".join(t.LEGAL_PAGES)}')

    def handle(self, *args, **options):
        pages = options['pages'] or list(t.LEGAL_PAGES)
        unknown = [p for p in pages if p not in t.LEGAL_PAGES]
        if unknown:
            raise CommandError(f'Unknown page(s): {", ".join(unknown)}. Available: {", ".join(t.LEGAL_PAGES)}')
        for page in pages:
            title, effective, blocks = t.LEGAL_PAGES[page]
            try:
                v.check_blocks(blocks, 'blocks')
            except v.ContentError as exc:
                raise CommandError(f'{page} failed validation: ' + '; '.join(exc.messages)) from None
            LegalPage.objects.update_or_create(page=page, defaults={
                'title': title, 'blocks': blocks,
                'effective_date': datetime.strptime(effective, '%Y-%m-%d').date(),
            })
            self.stdout.write(self.style.SUCCESS(f'{page}: loaded ({len(blocks)} blocks).'))
