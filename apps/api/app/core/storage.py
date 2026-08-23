"""Where uploaded images go.

Two backends, chosen by whether R2 is configured, because the alternative is that
onboarding cannot be exercised locally without a Cloudflare account. Both answer the
same question — "store these bytes, give me a URL" — and nothing above this module
knows which one ran.

Not stored in Postgres. The one existing image field in the schema
(`equipment.image_url`) holds a base64 data-URL, which was fine for one thumbnail
and is not fine for five photos on every court: it inflates every court response by
megabytes, defeats HTTP caching entirely, and puts binary blobs in the row a
booking joins against.
"""

from __future__ import annotations

import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.core.errors import InvalidInputError

#: Accepted image types, and the extension each is stored under. The client's
#: Content-Type is not consulted — see `sniff` — so this maps *detected* type.
ALLOWED_TYPES: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}

#: Magic-byte prefixes. A file is what its first bytes say it is, not what the
#: multipart header claims: an upload declaring image/png and containing HTML is
#: stored, served from our domain, and executed by whoever opens it.
_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def sniff(data: bytes) -> str:
    """The content type of these bytes, or reject them.

    WEBP is checked separately because its signature is split: "RIFF", four bytes
    of length, then "WEBP".
    """
    for prefix, content_type in _SIGNATURES:
        if data.startswith(prefix):
            return content_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise InvalidInputError(
        "That file is not a PNG, JPEG or WebP image.",
        details={"field": "file"},
    )


@dataclass(frozen=True, slots=True)
class StoredFile:
    url: str
    key: str
    content_type: str
    size: int


def _key_for(tenant_id: uuid.UUID, extension: str) -> str:
    """Tenant-prefixed, so an object in the bucket is traceable to an academy.

    Not a secret and not an access control — anyone with the URL can fetch it, the
    same as any other image on the web. It is what makes "delete everything
    belonging to this turf" a prefix listing rather than a join.
    """
    return f"t/{tenant_id}/{uuid.uuid4().hex}{extension}"


def _r2_configured() -> bool:
    return bool(
        settings.r2_account_id
        and settings.r2_bucket
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
    )


def _store_r2(key: str, data: bytes, content_type: str) -> str:
    import boto3  # imported here so a deployment without R2 need not install it

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=(
            settings.r2_secret_access_key.get_secret_value()
            if settings.r2_secret_access_key
            else None
        ),
        # R2 ignores the region but boto3 insists on one being set.
        region_name="auto",
    )
    client.put_object(
        Bucket=settings.r2_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        # Immutable: the key contains a uuid, so a given URL's bytes never change.
        CacheControl="public, max-age=31536000, immutable",
    )
    base = (settings.r2_public_base_url or "").rstrip("/")
    return f"{base}/{key}"


def local_upload_dir() -> Path:
    return Path(settings.local_upload_dir).resolve()


def _store_local(key: str, data: bytes, content_type: str) -> str:
    del content_type
    target = local_upload_dir() / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    # Relative, deliberately. The API and the frontend are on different origins in
    # development, and baking in whichever host this process happens to think it
    # has produces URLs that work on one machine and 404 on the next. The frontend
    # resolves it against its own API base, which it already knows.
    return f"/media/{key}"


def store_image(data: bytes, *, tenant_id: uuid.UUID) -> StoredFile:
    """Validate and store one image, returning the URL to render it from."""
    if not data:
        raise InvalidInputError("The uploaded file is empty.", details={"field": "file"})
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidInputError(
            f"Images must be under {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            details={"field": "file", "max_bytes": MAX_UPLOAD_BYTES},
        )

    content_type = sniff(data)
    extension = ALLOWED_TYPES.get(content_type) or mimetypes.guess_extension(content_type) or ".bin"
    key = _key_for(tenant_id, extension)

    url = _store_r2(key, data, content_type) if _r2_configured() else _store_local(
        key, data, content_type
    )
    return StoredFile(url=url, key=key, content_type=content_type, size=len(data))
