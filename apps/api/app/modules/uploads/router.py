"""Image upload: turf logos and court photos.

One endpoint, doing one thing. It stores bytes and hands back a URL — it does not
know what the image is *for*, and nothing records that either. The URL is written
into `tenant_settings.logo_url` or `court.images` by whichever request does that,
and an upload nobody references is simply an orphaned object.

That is a deliberate trade: the alternative is an `upload` table, a reference count,
and a reaper — real machinery to save a few kilobytes of blob storage on a form the
user abandoned. If it ever matters, the tenant prefix on every key
(`t/{tenant_id}/…`) makes "list what this turf has, diff against what it references"
a batch job rather than a schema change.
"""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, status
from pydantic import BaseModel

from app.auth.deps import RequireManager
from app.core import storage
from app.tenancy.deps import TenantCtx

router = APIRouter(prefix="/uploads", tags=["uploads"])


class UploadOut(BaseModel):
    url: str
    content_type: str
    size: int


@router.post(
    "",
    response_model=UploadOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an image",
    description=(
        "PNG, JPEG or WebP, up to 5 MB. The type is determined from the file's own "
        "magic bytes, not from the multipart `Content-Type` — a caller can claim "
        "anything there, and the result would be served back from our own domain.\n\n"
        "Returns a URL to store on whatever the image belongs to. Uploading does "
        "not attach it to anything by itself."
    ),
)
async def upload_image(
    tenant: TenantCtx,
    _: RequireManager,
    file: UploadFile = File(description="PNG, JPEG or WebP, max 5 MB"),
) -> UploadOut:
    # Read in full rather than streaming to the backend. At a 5 MB cap that is a
    # bounded amount of memory, and both backends want the whole body anyway —
    # `put_object` takes bytes, and a partial write to local disk would leave a
    # truncated file behind a URL that already looks valid.
    data = await file.read()
    stored = storage.store_image(data, tenant_id=tenant.id)
    return UploadOut(url=stored.url, content_type=stored.content_type, size=stored.size)
