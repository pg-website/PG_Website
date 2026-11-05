"""Registrations, rounds, pairings (contract 3.3 R01-R08, 3.4 M01-M09, 5.3).

Capacity rule (5.3): confirmed registrations + unexpired holds + unexpired waitlist offers never exceed
`Event.capacity`. `Event.confirmed_count` is kept in step with CONFIRMED registrations by `services.adjust_confirmed`
(a relative queryset update inside the same transaction, under the Event row lock).

Statuses are stored finely (`offer` is its own status) and projected to the frontend union by `dto.py`
(`offer` -> `waitlist` with an `offer` object; an expired hold or offer is projected as `cancelled` until the
scheduler command rewrites the row).
"""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from accounts.models import User
from content.models import Event


class Registration(models.Model):
    ACTIVE = ('pending', 'confirming', 'confirmed', 'waitlist', 'offer')
    STATUSES = [(s, s) for s in ('pending', 'confirming', 'confirmed', 'waitlist', 'offer', 'cancelled', 'refunded')]
    ORDER_STATES = [(s, s) for s in ('none', 'created', 'attempted', 'paid', 'failed', 'expired', 'refunded')]
    REFUND_STATES = [(s, s) for s in ('none', 'pending', 'refunded', 'failed')]
    CHECK_IN_SOURCES = [('self', 'self'), ('host', 'host')]
    PAYMENT_METHODS = [('razorpay', 'razorpay'), ('cash', 'cash')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name='event_registrations')
    event = models.ForeignKey(Event, on_delete=models.PROTECT, related_name='player_registrations')
    status = models.CharField(max_length=10, choices=STATUSES)

    # Waitlist: position is derived from `waitlisted_at` (then id), never stored, so it cannot drift.
    waitlisted_at = models.DateTimeField(null=True, blank=True)
    hold_expires_at = models.DateTimeField(null=True, blank=True)    # pending: capacity hold
    offer_expires_at = models.DateTimeField(null=True, blank=True)   # offer: promoted from the waitlist
    confirmed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)

    # Payment facts (slice 4 owns the ledger and provider ids; only what the DTOs need lives here, never provider ids).
    amount_paise = models.PositiveIntegerField(default=0)
    payment_order_state = models.CharField(max_length=10, choices=ORDER_STATES, default='none')
    refund_state = models.CharField(max_length=10, choices=REFUND_STATES, default='none')
    payment_method = models.CharField(max_length=10, choices=PAYMENT_METHODS, default='razorpay')
    cash_registered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    # Check-in (M06). `manual_checkin_required` is set by the host desk (slice 3).
    manual_checkin_required = models.BooleanField(default=False)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    check_in_source = models.CharField(max_length=4, choices=CHECK_IN_SOURCES, blank=True)

    # Control room (BE-06). `welcomed_by` is the host who welcomed a first-timer (the desk "assignee").
    welcomed_at = models.DateTimeField(null=True, blank=True)
    welcomed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    pairing_active = models.BooleanField(default=True)  # False: left out of generated rounds (C03 set_pairing_active)
    version = models.PositiveIntegerField(default=1)    # +1 on every admin change (control room rows)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'event_registrations'
        constraints = [
            # One live registration per player and event; a cancelled one does not block registering again.
            models.UniqueConstraint(
                fields=['user', 'event'], condition=Q(status__in=['pending', 'confirming', 'confirmed', 'waitlist', 'offer']),
                name='reg_one_active_per_user_event'),
            models.CheckConstraint(
                condition=Q(status__in=['pending', 'confirming', 'confirmed', 'waitlist', 'offer', 'cancelled', 'refunded']),
                name='reg_status_valid'),
            models.CheckConstraint(
                condition=Q(payment_order_state__in=['none', 'created', 'attempted', 'paid', 'failed', 'expired', 'refunded']),
                name='reg_order_state_valid'),
            models.CheckConstraint(condition=Q(refund_state__in=['none', 'pending', 'refunded', 'failed']),
                                   name='reg_refund_state_valid'),
            models.CheckConstraint(condition=Q(payment_method__in=['razorpay', 'cash']),
                                   name='reg_payment_method_valid'),
        ]
        indexes = [
            models.Index(fields=['event', 'status'], name='reg_event_status_idx'),
            models.Index(fields=['user', 'status'], name='reg_user_status_idx'),
            models.Index(fields=['status', 'hold_expires_at'], name='reg_hold_expiry_idx'),
            models.Index(fields=['status', 'offer_expires_at'], name='reg_offer_expiry_idx'),
            models.Index(fields=['event', 'payment_method'], condition=Q(payment_method='cash'),
                         name='reg_cash_method_idx'),
        ]

    def __str__(self):
        return f'{self.pk} {self.status}'

    def waitlist_position(self, now) -> int:
        """1-based place in the queue (offers keep their original place). Read-only."""
        if self.waitlisted_at is None:
            return 1
        ahead = (Registration.objects.filter(event_id=self.event_id, status__in=['waitlist', 'offer'])
                 .exclude(status='offer', offer_expires_at__lte=now)
                 .filter(Q(waitlisted_at__lt=self.waitlisted_at) | Q(waitlisted_at=self.waitlisted_at, id__lt=self.id))
                 .count())
        return ahead + 1


class Round(models.Model):
    STATES = [(s, s) for s in ('draft', 'published', 'live', 'completed', 'void')]
    VISIBLE = ('published', 'live', 'completed')  # players never see draft or void rounds

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.PROTECT, related_name='event_rounds')
    number = models.PositiveSmallIntegerField()
    state = models.CharField(max_length=10, choices=STATES, default='draft')
    time_control = models.CharField(max_length=40, blank=True)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    ratings_processed_at = models.DateTimeField(null=True, blank=True)  # set once by the rating job (slice 2B/3)
    version = models.PositiveIntegerField(default=1)          # optimistic-concurrency token, +1 per admin change
    pairing_version = models.PositiveIntegerField(default=1)  # +1 on every pairing change (BE-05, contract C08)
    method = models.CharField(max_length=20, default='swiss')  # pairing method used to generate: swiss | social_balanced
    last_change_reason = models.CharField(max_length=500, blank=True)  # reason of the latest post-publish edit
    finalise_key = models.CharField(max_length=64, blank=True)  # Idempotency-Key that finalised the round (C12)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'event_rounds'
        ordering = ['event_id', 'number']
        constraints = [
            models.UniqueConstraint(fields=['event', 'number'], name='round_unique_number_per_event'),
            models.CheckConstraint(condition=Q(number__gte=1) & Q(number__lte=100), name='round_number_range'),
            models.CheckConstraint(condition=Q(state__in=['draft', 'published', 'live', 'completed', 'void']),
                                   name='round_state_valid'),
        ]

    def __str__(self):
        return f'{self.event_id} R{self.number} {self.state}'


class Pairing(models.Model):
    RESULT_STATES = [(s, s) for s in ('none', 'submitted', 'awaiting_confirmation', 'final', 'disputed')]
    OUTCOMES = [(s, s) for s in ('white', 'black', 'draw')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    round = models.ForeignKey(Round, on_delete=models.CASCADE, related_name='pairings')
    board = models.PositiveSmallIntegerField()
    white = models.ForeignKey(User, on_delete=models.PROTECT, related_name='white_pairings')
    black = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name='black_pairings')
    is_bye = models.BooleanField(default=False)  # bye: `white` is the player, `black` is null, result is final (1 point)
    time_control = models.CharField(max_length=40, blank=True)

    # `awaiting_confirmation` is derived per viewer (submitted by the other player); stored states are
    # none | submitted | final | disputed.
    result_state = models.CharField(max_length=24, choices=RESULT_STATES, default='none')
    outcome = models.CharField(max_length=5, choices=OUTCOMES, null=True, blank=True)
    submitted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    submitted_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    confirmed_at = models.DateTimeField(null=True, blank=True)
    disputed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    disputed_at = models.DateTimeField(null=True, blank=True)
    dispute_note = models.CharField(max_length=500, blank=True)
    finalised_at = models.DateTimeField(null=True, blank=True)
    # Admin desk (C11): set when an admin recorded, overrode or resolved the result. Reason is mandatory then.
    admin_decided = models.BooleanField(default=False)
    admin_reason = models.CharField(max_length=500, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'event_pairings'
        ordering = ['round_id', 'board']
        constraints = [
            models.UniqueConstraint(fields=['round', 'board'], name='pairing_unique_board_per_round'),
            models.CheckConstraint(condition=Q(board__gte=1) & Q(board__lte=500), name='pairing_board_range'),
            models.CheckConstraint(condition=~Q(white=models.F('black')), name='pairing_distinct_players'),
            models.CheckConstraint(
                condition=(Q(is_bye=True, black__isnull=True) | Q(is_bye=False, black__isnull=False)),
                name='pairing_bye_has_no_black'),
            models.CheckConstraint(
                condition=Q(result_state__in=['none', 'submitted', 'awaiting_confirmation', 'final', 'disputed']),
                name='pairing_result_state_valid'),
            models.CheckConstraint(condition=Q(outcome__isnull=True) | Q(outcome__in=['white', 'black', 'draw']),
                                   name='pairing_outcome_valid'),
            models.CheckConstraint(condition=~Q(result_state='final') | Q(outcome__isnull=False),
                                   name='pairing_final_has_outcome'),
        ]
        indexes = [
            models.Index(fields=['white'], name='pairing_white_idx'),
            models.Index(fields=['black'], name='pairing_black_idx'),
        ]

    def __str__(self):
        return f'{self.round_id} board {self.board}'
