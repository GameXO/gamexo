# @gamexo/docs

The **public** developer documentation, at `developers.gamexo.app`. Two audiences:

- **Booking platforms** integrating against the gateway — Playo today, Hudle and
  District when their specs land, and anyone else via the gamexo API.
- **Venue admins** connecting a payment gateway.

Fumadocs on Next.js, built as a **static export** (`output: 'export'`) and served by
its own Cloudflare Worker. No server, no Node runtime at the edge.

```bash
pnpm docs:dev      # localhost:5176
pnpm docs:build    # -> out/
pnpm docs:deploy   # build, then wrangler deploy
```

## This is published to people outside the company

Anything written here is readable by Playo, by a venue owner, and by anyone who
finds the URL. Two rules follow from that:

1. **No internal detail.** No source paths, no row-level-security internals, no
   infrastructure hostnames, no seed credentials. If it only makes sense to someone
   with the repo open, it does not belong here.
2. **No aspirational documentation.** Hudle and District have no endpoints, so their
   pages say exactly that rather than describing a contract that does not exist.
   Documenting an endpoint into existence is how a partner spends a sprint
   integrating against nothing.

## Content

`content/docs/`, MDX with `meta.json` for ordering.

```
index.mdx                        Landing
integrations/
  index.mdx                      Overview: one URL, shared guarantees
  concepts.mdx                   Keys, idempotency, holds, atomicity, errors
  gamexo-api.mdx                 Our own contract — the default
  third-party/
    index.mdx                    Status of all platforms
    playo.mdx                    Full reference (live)
    hudle.mdx                    Coming soon
    district.mdx                 Coming soon
payments/
  index.mdx                      Overview
  providers.mdx                  Five gateways, three verifiable
  connecting.mdx                 Credentials, storage, verification
  routing.mdx                    Web and POS surfaces
```

## Keeping it true

The integration pages describe real behaviour, and the details that matter are the
ones that would cost a partner a day if wrong: the 15-minute hold TTL, the
idempotency key, Playo's `requestStatus` envelope, which payment providers can
actually be verified.

When any of those change in the API, they change here. In particular:

| If this changes | Update |
| --- | --- |
| Hold TTL | `integrations/concepts.mdx`, `playo.mdx`, `gamexo-api.mdx` |
| A dialect becomes ready | its page, plus the status tables in `third-party/index.mdx` and `integrations/index.mdx` |
| A payment provider gains live verification | the matrix in `payments/providers.mdx` |
| Gateway endpoints or field names | the relevant dialect page |

## No mermaid

The static export has no diagram runtime, so a ` ```mermaid ` fence renders as its
own source code. Request sequences use the `Steps` component instead, registered
globally in `src/components/mdx.tsx`.
