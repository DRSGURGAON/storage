# Deployment

Everything needed to put this somewhere real, and an honest account of what
is still missing.

## What ships

```
docker-compose.yml       postgres + api + web on one machine
.env.example             copy to .env; two values have no default on purpose
apps/api/Dockerfile      Node 22 + Chromium, migrations on start
apps/web/Dockerfile      built assets behind nginx, which proxies /api
apps/web/nginx.conf.template
```

```bash
cp .env.example .env
# openssl rand -base64 32   -> POSTGRES_PASSWORD
# openssl rand -base64 48   -> JWT_SECRET
docker compose up --build
# http://localhost:8080
```

That is a working workspace signup, with the schema applied and the system
rows (roles, permissions, plans, feature keys, charge types, tax rates,
notification rules, the agreement template) seeded.

## The three things that are easy to get wrong

**Chromium.** Every document this product issues is rendered by a real
browser. The API image installs Debian's `chromium` and sets
`PUPPETEER_CHROMIUM_EXECUTABLE` to it. `puppeteer-core` — unlike
`puppeteer` — never goes looking for a browser on its own, so an image
without one starts fine, serves every read endpoint fine, and fails the
first time somebody clicks "Generate document". If you build your own
image, install a browser and set that variable; the service now says
exactly that when it is missing, rather than passing puppeteer's own
message through as a 500.

Fonts matter for the same reason. The image installs the Liberation and
Noto families, because a document carrying an Indian address or a `₹`
renders as boxes without them — and a PDF is the one artefact a customer
keeps.

**The attachments volume.** Generated PDFs, uploaded KYC documents, gate
photographs and captured signatures are written to `ATTACHMENTS_DIR`
(`/var/lib/warehouse/attachments` in the image), which the compose file
backs with a named volume. Without it, every document a workspace has ever
issued disappears on the next deploy. The local filesystem adapter is
`DECISIONS.md` §24's stand-in for object storage; a container's own disk is
not storage.

**Migrations run on start.** `apps/api/docker-entrypoint.sh` applies the
schema and seeds before the process serves anything, on every start. Both
steps are idempotent — the runner skips what it has applied, the seed
upserts — so a schema file added in a release is applied by that release,
rather than by somebody remembering. Set `SKIP_MIGRATIONS=1` if your
platform runs them as a separate job.

## Two addresses, not one

- `PUBLIC_APP_URL` — where a document's QR code points. That is the **API**:
  the QR opens `/verify/:token`, which the API serves.
- `PUBLIC_WEB_URL` — where the **web app** is served. A password-reset link
  is built from this, because it has to open a screen rather than a JSON
  endpoint.

They were the same variable for one commit, and the reset mail pointed at
the API.

## TLS, and what sits in front

The compose file terminates nothing. Put a reverse proxy or a load balancer
in front of the `web` container and terminate TLS there. Then:

- Set `TRUST_PROXY_HOPS` to the number of proxies you actually control.
  It is `0` by default and that is the safe direction: `X-Forwarded-For` is
  client-settable, so trusting it on a directly reachable host lets anyone
  forge their address, mint fresh rate-limit buckets, and write a fabricated
  IP into `audit_logs`. The compose file sets `1` because nginx is the one
  hop it knows about.
- HSTS is already sent by the API (helmet) and only means anything once you
  are actually on HTTPS.

If you serve the frontend from a different origin than the API — a CDN, a
separate host — set `CORS_ORIGINS` to a comma-separated list of exact
origins. It is empty by default, and an API that answers any origin is how
a token in `localStorage` becomes readable from someone else's page. The
shape this repo ships needs none of that: nginx proxies `/api`, so the
browser's requests are same-origin.

## Installing it on a phone

`apps/web/public/manifest.webmanifest` and the icon set make the app
installable: Android and iOS can add it to a home screen, and a Play Store
listing built as a Trusted Web Activity reads exactly those fields.

A TWA additionally needs the site served over HTTPS on a domain you
control, and `/.well-known/assetlinks.json` on that domain carrying your
signing key's fingerprint. Neither exists until the app is deployed
somewhere public — deploy first, then package.

There is deliberately **no service worker**. An offline cache on an
operational app means somebody can be shown a stock figure that was true an
hour ago, and deciding what may be served stale is a question about
warehouse practice rather than a build setting.

## Still missing

Named rather than implied:

- **Backups.** There is no backup or restore procedure here. A warehouse's
  stock ledger and its issued invoices are the two things it cannot
  reconstruct.
- **Object storage.** `DECISIONS.md` §24 — the interface exists
  (`AttachmentStorage`), the S3 adapter does not. Until then attachments
  live on one machine's disk, which caps you at one API container.
- **Error monitoring.** No Sentry, no structured log shipping. The logs are
  whatever the container writes.
- **A payment gateway.** `DECISIONS.md` §13. V1 runs on the seeded Free
  plan with upgrades arranged offline, and the upgrade prompt says so
  rather than inventing a tier.
- **Account deletion.** Google Play requires a route to delete an account
  for any app that lets one be created in it. Deleting a workspace whose
  invoices and stock ledger are legal records is a product decision, not a
  `DELETE` statement, and it has not been made.
- **A second API instance.** Nothing in the code prevents it — the
  numbering engine takes row locks, the entitlement engine is idempotent —
  but the attachments directory would have to become shared storage first.

## Verified how

The images themselves were **not** built in the development sandbox: its
egress policy blocks Docker Hub's blob CDN, so no base image can be pulled
there. What was verified, locally and for real:

- `docker compose config` parses and interpolates.
- The entrypoint's own two commands (`migrate`, then `seed`) run against a
  database created from empty, applying every schema file in order.
- The compiled `dist` then boots with the image's environment
  (`NODE_ENV=production`), and a workspace signup → customer → quotation →
  **generated PDF** succeeds against it, with the PDF written to the
  directory the volume mounts.
- Security headers come back on a live response: `X-Frame-Options: DENY`,
  `nosniff`, a referrer policy, HSTS, and `Cross-Origin-Resource-Policy:
  cross-origin`.

The step that remains unproven here is `docker build` itself. Run it once
on a machine with registry access before trusting a deploy to it.
