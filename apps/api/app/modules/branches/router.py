"""Branch endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select, update

from app.api_utils import get_or_404
from app.auth.deps import RequireAdmin, RequireKiosk
from app.core.errors import ConflictError
from app.core.security import ROLE_HIERARCHY, Role
from app.modules.booking.models import Court
from app.modules.branches.models import Branch
from app.modules.branches.schemas import BranchCreate, BranchOut, BranchUpdate
from app.modules.branches.service import branch_out, tenant_settings
from app.tenancy.deps import Db

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get(
    "",
    response_model=list[BranchOut],
    summary="List branches",
    description=(
        "Active branches, default first. The counter tablet reads this to let staff "
        "pick which site it is sitting in. Reception and above may also pass "
        "`include_inactive` to see closed ones; for the tablet it is ignored."
    ),
)
async def list_branches(
    db: Db, principal: RequireKiosk, include_inactive: bool = False
) -> list[BranchOut]:
    stmt = select(Branch).order_by(Branch.is_default.desc(), Branch.name)
    sees_closed = principal.is_platform_admin or (
        principal.role is not None
        and ROLE_HIERARCHY[principal.role] >= ROLE_HIERARCHY[Role.RECEPTION]
    )
    if not (include_inactive and sees_closed):
        stmt = stmt.where(Branch.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    settings = await tenant_settings(db)
    return [branch_out(row, settings) for row in rows]


async def _assert_name_free(db: Db, name: str, *, exclude: uuid.UUID | None = None) -> None:
    stmt = select(Branch.id).where(func.lower(Branch.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(Branch.id != exclude)
    if (await db.execute(stmt)).first() is not None:
        raise ConflictError(f"A branch called '{name}' already exists.", details={"field": "name"})


@router.post(
    "", response_model=BranchOut, status_code=status.HTTP_201_CREATED, summary="Add a branch"
)
async def create_branch(payload: BranchCreate, db: Db, _: RequireAdmin) -> BranchOut:
    await _assert_name_free(db, payload.name)
    data = payload.model_dump()
    data["email"] = str(payload.email) if payload.email else None
    branch = Branch(**data, is_default=False, is_active=True)
    db.add(branch)
    await db.flush()
    return branch_out(branch, await tenant_settings(db))


@router.patch("/{branch_id}", response_model=BranchOut, summary="Update a branch")
async def update_branch(
    branch_id: uuid.UUID, payload: BranchUpdate, db: Db, _: RequireAdmin
) -> BranchOut:
    branch = await get_or_404(db, Branch, branch_id, label="Branch")
    updates = payload.model_dump(exclude_unset=True)

    if "name" in updates:
        if updates["name"] is None:
            raise ConflictError("A branch needs a name.", details={"field": "name"})
        await _assert_name_free(db, updates["name"], exclude=branch.id)
    if updates.get("email") is not None:
        updates["email"] = str(updates["email"])

    make_default = updates.pop("is_default", None)
    active = updates.get("is_active")

    if make_default is False:
        raise ConflictError(
            "An academy always has a default branch. Make another branch the default instead."
        )
    if active is False and branch.is_default:
        raise ConflictError(
            "The default branch cannot be deactivated. Make another branch the default first."
        )
    if active is False:
        live_courts = (
            await db.execute(
                select(func.count())
                .select_from(Court)
                .where(Court.branch_id == branch.id, Court.is_bookable.is_(True))
            )
        ).scalar_one()
        if live_courts:
            raise ConflictError(
                f"{branch.name} still has {live_courts} bookable court(s). Move them to another "
                "branch or switch them off first.",
                details={"court_count": live_courts},
            )
    if make_default and not (active if active is not None else branch.is_active):
        raise ConflictError("A deactivated branch cannot be the default.")

    for field, value in updates.items():
        setattr(branch, field, value)

    if make_default and not branch.is_default:
        # The partial unique index allows one default, so the old one is cleared and
        # flushed before the new one is set — the other order trips the constraint.
        await db.execute(
            update(Branch).where(Branch.is_default.is_(True)).values(is_default=False)
        )
        await db.flush()
        branch.is_default = True

    await db.flush()
    return branch_out(branch, await tenant_settings(db))
