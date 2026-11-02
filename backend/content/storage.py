"""Media storage adapter (contract 3.7 S07/S08, ARCH 6.3).

`get_storage()` returns the adapter for settings.STORAGE_MODE:

* SupabaseStorage: signed upload URLs, object reads/writes/deletes against the Supabase Storage REST API using the
  backend-only secret key. The bucket is public for reads; every write is a signed upload or a backend call.
* FakeStorage: local disk under settings.FAKE_STORAGE_ROOT, DEBUG only. Its "signed" upload URL points at the
  development endpoint in content/dev_storage.py, so the whole flow runs without network.

The secret key is only ever placed in request headers to the configured SUPABASE_URL. It is never logged, returned or
put in an exception message. Network calls must not run while a database transaction holds row locks.
"""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core import signing
from django.utils import timezone

logger = logging.getLogger('pg.storage')

CONNECT_TIMEOUT = 3.05
READ_TIMEOUT = 20
KEY_RE = re.compile(r'^media/[0-9a-f]{32}\.(?:jpg|png|webp|avif)$')
FAKE_SALT = 'pg.fake-storage.upload'


class StorageError(Exception):
    """Storage is unreachable or answered unexpectedly. Never carries URLs, keys or response bodies."""


class ObjectMissing(StorageError):
    pass


class ObjectTooLarge(StorageError):
    pass


@dataclass(frozen=True)
class UploadTicket:
    url: str
    method: str
    headers: dict
    expires_at: object


def new_object_key(extension: str) -> str:
    """Random, unguessable key: the client's filename never reaches the path."""
    return f'media/{uuid.uuid4().hex}.{extension}'


class SupabaseStorage:
    def __init__(self):
        self.base = settings.SUPABASE_URL
        self.bucket = settings.SUPABASE_MEDIA_BUCKET
        self._host = urlsplit(self.base).hostname

    # -- helpers
    def _headers(self, extra=None):
        key = settings.SUPABASE_SECRET_KEY
        headers = {'apikey': key}
        if key.startswith('eyJ'):  # legacy JWT-style service keys are also sent as a bearer token
            headers['Authorization'] = f'Bearer {key}'
        headers.update(extra or {})
        return headers

    def _call(self, method, path, **kwargs):
        try:
            return requests.request(method, f'{self.base}/storage/v1{path}', headers=self._headers(kwargs.pop('headers', None)),
                                    timeout=(CONNECT_TIMEOUT, READ_TIMEOUT), allow_redirects=False, **kwargs)
        except requests.RequestException as exc:
            logger.warning('storage_network_error exc=%s', type(exc).__name__)
            raise StorageError('Storage is unreachable.') from None

    # -- interface
    def create_upload(self, key: str, content_type: str) -> UploadTicket:
        response = self._call('POST', f'/object/upload/sign/{self.bucket}/{key}')
        if response.status_code not in (200, 201):
            logger.error('storage_sign_failed status=%s', response.status_code)
            raise StorageError('Could not sign an upload.')
        try:
            relative = response.json()['url']
        except (ValueError, KeyError, TypeError):
            raise StorageError('Unexpected storage response.') from None
        url = relative if relative.startswith('https://') else f'{self.base}/storage/v1{relative}'
        parts = urlsplit(url)
        if parts.scheme != 'https' or parts.hostname != self._host:  # F-16: only the configured storage host
            logger.error('storage_sign_host_mismatch')
            raise StorageError('Unexpected storage response.')
        return UploadTicket(url=url, method='PUT', headers={'Content-Type': content_type, 'x-upsert': 'false'},
                            expires_at=timezone.now() + timedelta(seconds=settings.MEDIA_UPLOAD_TTL_SECONDS))

    def read(self, key: str, max_bytes: int) -> bytes:
        response = self._call('GET', f'/object/{self.bucket}/{key}', stream=True)
        try:
            if response.status_code in (400, 404):
                raise ObjectMissing('Object not found.')
            if response.status_code != 200:
                logger.error('storage_read_failed status=%s', response.status_code)
                raise StorageError('Could not read the object.')
            declared = response.headers.get('Content-Length')
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise ObjectTooLarge('Object is too large.')
            data = bytearray()
            try:
                for chunk in response.iter_content(64 * 1024):
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        raise ObjectTooLarge('Object is too large.')
            except requests.RequestException:
                raise StorageError('Could not read the object.') from None
            return bytes(data)
        finally:
            response.close()

    def write(self, key: str, data: bytes, content_type: str) -> None:
        response = self._call('PUT', f'/object/{self.bucket}/{key}', data=data,
                              headers={'Content-Type': content_type, 'x-upsert': 'true'})
        if response.status_code not in (200, 201):
            logger.error('storage_write_failed status=%s', response.status_code)
            raise StorageError('Could not write the object.')

    def delete(self, key: str) -> None:
        response = self._call('DELETE', f'/object/{self.bucket}/{key}')
        if response.status_code == 400:
            # Supabase answers a missing object with HTTP 400 and a JSON body whose statusCode is "404".
            try:
                missing = str(response.json().get('statusCode')) == '404'
            except (ValueError, AttributeError):
                missing = False
            if missing:
                return
        if response.status_code not in (200, 204, 404):
            logger.error('storage_delete_failed status=%s', response.status_code)
            raise StorageError('Could not delete the object.')

    def public_url(self, key: str) -> str:
        return f'{self.base}/storage/v1/object/public/{self.bucket}/{key}'


class FakeStorage:
    """Disk-backed stand-in. Keys are validated against KEY_RE, so no path traversal is possible."""

    def __init__(self):
        self.root = settings.FAKE_STORAGE_ROOT

    def _path(self, key: str):
        if not KEY_RE.match(key):
            raise StorageError('Invalid object key.')
        return self.root / key

    def create_upload(self, key: str, content_type: str) -> UploadTicket:
        self._path(key)
        token = signing.dumps({'k': key, 'ct': content_type}, salt=FAKE_SALT)
        return UploadTicket(url=f'/api/dev-storage/upload/{token}', method='PUT', headers={'Content-Type': content_type},
                            expires_at=timezone.now() + timedelta(seconds=settings.MEDIA_UPLOAD_TTL_SECONDS))

    def read(self, key: str, max_bytes: int) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise ObjectMissing('Object not found.')
        if path.stat().st_size > max_bytes:
            raise ObjectTooLarge('Object is too large.')
        return path.read_bytes()

    def write(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.is_file():
            path.unlink()

    def public_url(self, key: str) -> str:
        return f'/api/dev-storage/public/{key}'


def get_storage():
    return FakeStorage() if settings.STORAGE_MODE == 'fake' else SupabaseStorage()
