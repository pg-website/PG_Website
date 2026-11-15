from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0014_private_galleries_data'),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='event_mode',
            field=models.CharField(
                choices=[('social', 'Hosted social'), ('competitive', 'Competitive')],
                default='social',
                max_length=20,
            ),
        ),
    ]
