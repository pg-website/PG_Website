import base64
import secrets

from django.db import migrations, models


def _slug():
    return base64.b32encode(secrets.token_bytes(8)).decode('ascii')[:12].lower()


def backfill(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    used = set(User.objects.exclude(public_slug=None).values_list('public_slug', flat=True))
    for pk in User.objects.filter(public_slug=None).values_list('pk', flat=True).iterator():
        slug = _slug()
        while slug in used:
            slug = _slug()
        used.add(slug)
        User.objects.filter(pk=pk).update(public_slug=slug)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='public_slug',
            field=models.CharField(blank=True, editable=False, max_length=16, null=True, unique=True),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
