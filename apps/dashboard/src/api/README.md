# API layer

Everything the frontend needs to talk to `apps/api`.

| File | Generated? | What it is |
|---|---|---|
| `openapi.json` | yes | Schema dumped straight from the FastAPI app |
| `schema.d.ts` | yes | `openapi-typescript` output — every request/response type |
| `client.ts` | no | Typed `fetch` wrapper: auth header, tenant header, `ApiError`, 401 refresh |
| `auth.ts` | no | Token-pair storage |
| `hooks/` | no | TanStack Query hooks over `client.ts` |

## Regenerating

```bash
pnpm --filter @gamexo/web run generate:api
```

Run this after any backend route or schema change. It shells out to
`apps/api/scripts/export_openapi.py`, which walks the route table without starting a
server or opening a database connection — so the types cannot drift from what is deployed.

**Do not hand-edit `openapi.json` or `schema.d.ts`.** They are overwritten.

Two details that are easy to get wrong if you rebuild this pipeline:

- `--default-non-nullable false` is required. Without it, every field with a Pydantic
  default (`booking_type`, `discount`) is emitted as *required* in request bodies, so
  every call has to restate values the server already defaults.
- Operation ids come from tag + handler name (`booking_createBooking`), set by
  `unique_operation_id` in `apps/api/app/main.py`. That is what keeps generated names
  stable and readable across regenerations.

## Configuration

`VITE_API_BASE_URL` and `VITE_TENANT_SLUG` — see `.env.example`. The tenant slug is sent
as `X-Tenant-ID`, which the API honours only while `ALLOW_TENANT_HEADER=true`. In
production the tenant is resolved from the host subdomain and the header is ignored.

## Response shapes

Not uniform, so check before assuming:

- `GET /sports`, `GET /courts` → plain arrays
- `GET /bookings` → page envelope `{ items, total, page, size, pages }`

## Errors

Every failure throws `ApiError`, carrying the API's envelope
(`{ error: { code, message, details } }`) with `isUnauthenticated` / `isForbidden` /
`isNotFound` / `isConflict` helpers. A 401 triggers one transparent refresh-and-retry;
if that also fails the tokens are cleared and `AuthProvider` drops back to the login screen.
