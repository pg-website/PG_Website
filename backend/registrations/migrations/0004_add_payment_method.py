# Hand-written migration for FEAT-002 (cash registration).
# Adds payment_method (VARCHAR, default 'razorpay'), cash_registered_by FK (nullable),
# a CheckConstraint and a partial index.  Reversible.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('registrations', '0003_control_room'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='registration',
            name='payment_method',
            field=models.CharField(
                choices=[('razorpay', 'razorpay'), ('cash', 'cash')],
                default='razorpay',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='registration',
            name='cash_registered_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddConstraint(
            model_name='registration',
            constraint=models.CheckConstraint(
                condition=models.Q(payment_method__in=['razorpay', 'cash']),
                name='reg_payment_method_valid',
            ),
        ),
        migrations.AddIndex(
            model_name='registration',
            index=models.Index(
                fields=['event', 'payment_method'],
                condition=models.Q(payment_method='cash'),
                name='reg_cash_method_idx',
            ),
        ),
    ]
