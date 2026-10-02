"""Branch lookups shared by booking, finance and tenant provisioning."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.tenant import TenantSettings
from app.modules.branches.models import Branch
from app.modules.branches.schemas import BranchInfo, BranchOut


async def default_branch(db: AsyncSession) -> Branch:
    """The academy's default branch.

    Every academy has one — provisioning and the migration both create it — so a miss
    here is a data fault, not a normal state, and is reported as such rather than
    papered over by inventing a branch mid-request.
    """
    branch = (
        await db.execute(select(Branch).where(Branch.is_default.is_(True)))
    ).scalar_one_or_none()
    if branch is None:
        raise ConflictError("This academy has no default branch. Add one in Settings → General.")
    return branch


async def resolve_branch(db: AsyncSession, branch_id: uuid.UUID | None) -> Branch:
    """The named branch, or the default when none was named.

    Refuses a deactivated branch: a court added to a closed site would be invisible
    to the counter that is meant to sell it.
    """
    if branch_id is None:
        return await default_branch(db)
    branch = await db.get(Branch, branch_id)
    if branch is None:
        raise ConflictError("That branch does not exist.", details={"branch_id": str(branch_id)})
    if not branch.is_active:
        raise ConflictError(f"{branch.name} is deactivated.", details={"branch_id": str(branch_id)})
    return branch


def branch_info(branch: Branch | None, settings: TenantSettings) -> BranchInfo | None:
    """The branch as printed on a bill, with the academy's GSTIN filled in behind it."""
    if branch is None:
        return None
    info = BranchInfo.model_validate(branch)
    info.gstin = branch.gstin or settings.gst_number
    return info


def branch_out(branch: Branch, settings: TenantSettings) -> BranchOut:
    """The branch as the API returns it, with the effective GSTIN resolved."""
    out = BranchOut.model_validate(branch)
    out.effective_gstin = branch.gstin or settings.gst_number
    return out


async def tenant_settings(db: AsyncSession) -> TenantSettings:
    return (await db.execute(select(TenantSettings))).scalar_one()


def format_address(branch: Branch) -> str:
    """One printable line: street, city, state and pincode."""
    tail = " ".join(part for part in (branch.state, branch.pincode) if part)
    return ", ".join(part for part in (branch.address, branch.city, tail) if part)
