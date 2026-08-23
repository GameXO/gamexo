"""Application configuration, sourced entirely from the environment."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "test", "staging", "production"]
PoolMode = Literal["direct", "external_pooler"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Environment = "local"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    project_name: str = "gamexo API"

    # ── Database ────────────────────────────────────────────────────────────
    database_url: str
    migration_database_url: str
    db_app_user: str = "gamexo_app"
    db_pool_mode: PoolMode = "direct"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_echo: bool = False

    # ── Tenancy ─────────────────────────────────────────────────────────────
    tenant_base_domain: str = "gamexo.app"
    allow_tenant_header: bool = False

    # Resolve the tenant from the JWT's `tid` claim when the host names no
    # subdomain. This is what lets every academy share one origin — which is how
    # the product is actually deployed today: one Cloudflare Worker serving the
    # dashboard at `/` and the POS at `/pos/`, with no wildcard DNS.
    #
    # Deliberately NOT guarded in _guard_production the way ALLOW_TENANT_HEADER is.
    # The header is a bare string the caller types, so honouring it in production
    # would let anyone name any tenant. `tid` is a signed claim inside a token we
    # minted: a caller can only ever present a tid we already issued to them.
    allow_token_tenant: bool = True

    # ── Auth ────────────────────────────────────────────────────────────────
    jwt_secret_key: SecretStr
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14

    # ── HTTP ────────────────────────────────────────────────────────────────
    cors_origins: list[str] = Field(default_factory=list)

    # ── Uploads ─────────────────────────────────────────────────────────────
    #
    # Turf logos and court photos. Cloudflare R2 when configured (S3-compatible, so
    # boto3 talks to it unchanged and these same four settings point at real S3 by
    # swapping the endpoint); otherwise the local disk, served at /media.
    #
    # The local backend is not a production fallback — it is what makes onboarding
    # runnable without a Cloudflare account, and what lets the tests upload without
    # a network. A deployment on more than one instance must set R2, or two workers
    # will disagree about which images exist.
    r2_account_id: str | None = None
    r2_bucket: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: SecretStr | None = None
    #: The public hostname the bucket is served from — an r2.dev subdomain, or a
    #: custom domain. Uploads are unreachable without it: R2's API endpoint is not
    #: a read endpoint.
    r2_public_base_url: str | None = None
    local_upload_dir: str = "var/uploads"

    # ── Secrets at rest ─────────────────────────────────────────────────────
    #
    # Encrypts credentials an academy gives us for its own third-party accounts —
    # today, payment gateway key secrets. Unlike a password these cannot be hashed:
    # we have to replay them to Razorpay/Cashfree on every charge, so they must be
    # recoverable. What makes that safe is that the key is here, in the environment,
    # and not in the database — a stolen dump decrypts to nothing.
    #
    # Generate one with:
    #   python -c "from app.core.crypto import generate_key; print(generate_key())"
    #
    # Comma-separate to rotate: the first key encrypts, all of them decrypt, so
    # old ciphertext keeps opening while new writes move to the new key.
    #
    # Optional, and absent by default. A deployment that has not set it simply
    # cannot store payment credentials; everything else works untouched.
    secrets_encryption_key: SecretStr | None = None

    # ── Email ───────────────────────────────────────────────────────────────
    #
    # Two transports, picked automatically: Resend's HTTP API when RESEND_API_KEY is
    # set, otherwise SMTP. Nothing sends at all until one of them is configured, so
    # a deployment without mail queues and skips rather than failing bookings.
    #
    # Resend is preferred because it returns a real message id (which lands in
    # notification_delivery.provider_message_id and is searchable in their
    # dashboard), reports failures as structured JSON rather than an SMTP code, and
    # needs no outbound port 587 — which some serverless hosts block.
    #
    # The catch worth knowing before the first send: Resend will only accept a
    # `from` address on a **domain you have verified** with them. Until a domain is
    # verified the only usable sender is `onboarding@resend.dev`, and it will only
    # deliver to the email address that owns the Resend account.
    resend_api_key: SecretStr | None = None
    resend_api_url: str = "https://api.resend.com/emails"

    #: SMTP fallback. For Gmail/Workspace, SMTP_PASSWORD is a 16-character app
    #: password (which only exists once 2-Step Verification is on), not the account
    #: password — and Gmail silently rewrites From to the authenticated mailbox
    #: unless the address is a verified alias.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    #: 587 uses STARTTLS (upgrade after connecting); 465 is TLS from the first byte.
    smtp_use_tls: bool = False
    smtp_starttls: bool = True

    #: Sender identity, used by whichever transport is active. A tenant's own
    #: `notification_sender_email` overrides this per academy — unless forced below.
    mail_from_email: str | None = None
    mail_from_name: str = "gamexo"
    #: Always send from MAIL_FROM_EMAIL, keeping the academy's name as the display
    #: name and putting its own address in Reply-To.
    #:
    #: Needed with Resend (and SES, and most providers): they refuse any sender on a
    #: domain you have not verified with them, so a per-academy address only works
    #: once that academy's domain is verified too. Forcing the deployment's verified
    #: sender means every academy can send today, the recipient still sees the
    #: academy's name, and replies still reach the academy.
    mail_force_from: bool = False
    mail_timeout_seconds: int = 20
    #: Every outbound message goes here instead of the real recipient. For staging,
    #: and for the first run against live data when you would rather not post real
    #: bookings to real customers.
    mail_redirect_all_to: str | None = None

    @property
    def mail_provider(self) -> str:
        """Which transport will actually be used. `none` means sending is off."""
        if self.resend_api_key:
            return "resend"
        return "smtp" if self.smtp_host else "none"

    # ── Seed ────────────────────────────────────────────────────────────────
    seed_tenant_slug: str | None = None
    seed_tenant_name: str | None = None
    seed_admin_email: str | None = None
    seed_admin_password: SecretStr | None = None
    seed_platform_admin_email: str | None = None
    seed_platform_admin_password: SecretStr | None = None
    #: The walk-in counter's shared login. Separate from the admin credential on
    #: purpose: it is typed into a tablet on a public counter and shared between
    #: shifts, so it must never be the password that also opens the dashboard.
    seed_kiosk_email: str | None = None
    seed_kiosk_password: SecretStr | None = None

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def _require_asyncpg_driver(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "must use the asyncpg driver, e.g. postgresql+asyncpg://user:pw@host/db"
            )
        return v

    @model_validator(mode="after")
    def _guard_production(self) -> Settings:
        if self.environment != "production":
            return self

        # X-Tenant-ID lets the caller name any tenant they like. That is exactly
        # what you want for curl and pytest, and a total isolation bypass in
        # production. Refuse to boot rather than serve with it on.
        if self.allow_tenant_header:
            raise ValueError(
                "ALLOW_TENANT_HEADER must be false in production: the header lets any "
                "caller select any tenant, bypassing host-based resolution entirely."
            )

        # The app and migrator URLs pointing at the same role means the API is
        # connecting as the table owner, which silently exempts it from RLS.
        if self.database_url == self.migration_database_url:
            raise ValueError(
                "DATABASE_URL must not equal MIGRATION_DATABASE_URL: the API must connect "
                "as a non-owner role, or RLS policies do not apply to it."
            )

        if len(self.jwt_secret_key.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET_KEY must be at least 32 characters in production")

        return self

    @property
    def is_testing(self) -> bool:
        return self.environment == "test"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment


settings = get_settings()
