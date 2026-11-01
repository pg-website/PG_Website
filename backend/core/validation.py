"""Small strict input validation helpers (contract 2.1 field errors: { fieldName: [message] }).

Messages mirror the frontend mock and never echo the submitted value. Unknown keys are rejected (strict) where the
caller asks for it, never silently accepted or mass-assigned.
"""
import re
from datetime import date

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email

from .errors import ValidationFailed

MISSING = object()

REQUIRED = 'This is required.'
BAD_FORMAT = 'Check the format of this field.'
BAD_EMAIL = 'Enter a valid email address.'
BAD_CHOICE = 'Choose one of the listed options.'
NOT_EDITABLE = 'This field cannot be changed here.'

PHONE_RE = re.compile(r'^\+?[0-9 ()-]{7,20}$')
PHONE_CHARS_RE = re.compile(r'[ ()+-]')  # the only non-digits PHONE_RE allows
PHONE_QUERY_RE = re.compile(r'^\+?[0-9 ()-]+$')


def phone_digits(value: str) -> str:
    """Digits-only form of a phone number. Stored phones keep the user's formatting (PHONE_RE only validates), so
    comparison always happens on this form on both sides."""
    return PHONE_CHARS_RE.sub('', value or '')


CHESS_HANDLE_RE = re.compile(r'^[A-Za-z0-9_-]{3,25}$')
FIDE_ID_RE = re.compile(r'^[0-9]{3,12}$')
ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def require_object(data) -> dict:
    if not isinstance(data, dict):
        raise ValidationFailed(fields={'form': ['Send a JSON object.']})
    return data


class Collector:
    def __init__(self, data: dict):
        self.data = data
        self.errors: dict[str, list[str]] = {}

    def add(self, field: str, message: str) -> None:
        bucket = self.errors.setdefault(field, [])
        if message not in bucket:
            bucket.append(message)

    def reject_unknown(self, allowed) -> None:
        for key in self.data:
            if key not in allowed:
                self.add(str(key)[:60], NOT_EDITABLE)

    def done(self) -> None:
        if self.errors:
            raise ValidationFailed(fields=self.errors)

    # ---- field readers: return the cleaned value, None for an absent optional field, or MISSING after recording an error
    def _raw(self, name: str, required: bool):
        if name not in self.data:
            if required:
                self.add(name, REQUIRED)
                return MISSING
            return None
        if self.data[name] is None:  # an explicit null is not "absent": reject it
            self.add(name, REQUIRED)
            return MISSING
        return self.data[name]

    def text(self, name, *, max_len, min_len=1, required=True, strip=True, pattern=None):
        raw = self._raw(name, required)
        if raw is MISSING or raw is None:
            return raw
        if not isinstance(raw, str):
            self.add(name, REQUIRED)
            return MISSING
        value = raw.strip() if strip else raw
        if len(value) < min_len:
            self.add(name, REQUIRED if min_len <= 1 else f'Use at least {min_len} characters.')
            return MISSING
        if len(value) > max_len:
            self.add(name, f'Use at most {max_len} characters.')
            return MISSING
        if pattern is not None and not pattern.match(value):
            self.add(name, BAD_FORMAT)
            return MISSING
        return value

    def email(self, name='email', *, required=True):
        raw = self._raw(name, required)
        if raw is None or raw is MISSING:
            return raw
        if not isinstance(raw, str):
            self.add(name, REQUIRED)
            return MISSING
        value = raw.strip()
        if not value:
            self.add(name, REQUIRED)
            return MISSING
        try:
            if len(value) > 254:
                raise DjangoValidationError('long')
            validate_email(value)
        except DjangoValidationError:
            self.add(name, BAD_EMAIL)
            return MISSING
        return value.lower()

    def choice(self, name, options, *, required=False):
        raw = self._raw(name, required)
        if raw is None or raw is MISSING:
            return raw
        if not isinstance(raw, str) or raw not in options:
            self.add(name, BAD_CHOICE)
            return MISSING
        return raw

    def boolean(self, name, *, required=False):
        raw = self._raw(name, required)
        if raw is None or raw is MISSING:
            return raw
        if not isinstance(raw, bool):
            self.add(name, BAD_FORMAT)
            return MISSING
        return raw

    def iso_date(self, name, *, required=False):
        raw = self._raw(name, required)
        if raw is None or raw is MISSING:
            return raw
        if not isinstance(raw, str) or not ISO_DATE_RE.match(raw):
            self.add(name, BAD_FORMAT)
            return MISSING
        try:
            parsed = date.fromisoformat(raw)
        except ValueError:
            self.add(name, BAD_FORMAT)
            return MISSING
        if parsed > date.today() or parsed.year < 1900:
            self.add(name, 'Enter a valid date.')
            return MISSING
        return parsed


def present(value) -> bool:
    """True when a reader returned a real value (not None for 'absent', not MISSING for 'invalid')."""
    return value is not None and value is not MISSING
