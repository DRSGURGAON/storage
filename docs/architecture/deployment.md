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
ops/backup.sh            database + attachments, in the order that matters
ops/restore.sh           and the verification most procedures skip
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

The two URLs a listing asks for are served by the app itself: `/privacy`
and `/delete-account`, both public. Set `VITE_OPERATOR_NAME` and
`VITE_OPERATOR_CONTACT` at build time so they name the company running the
deployment rather than a placeholder — those are facts about the operator,
not about the software. Account deletion itself is in the app, under
Settings → Your account (`tenancy-and-security.md` §3b).

A TWA additionally needs the site served over HTTPS on a domain you
control, and `/.well-known/assetlinks.json` on that domain carrying your
signing key's fingerprint. The second half is built in: set
`ANDROID_PACKAGE_NAME` and `ANDROID_SHA256_FINGERPRINT` and the web
container writes and serves that file at start-up; leave either unset and
it serves nothing, because a file with the wrong fingerprint fails
verification in a way that reads like a signing bug. `ops/twa/README.md`
has the whole path, including the mistake everyone makes with Play App
Signing.

The domain still has to be yours. **`ops/twa/README.md` §1 is the five
minute version**: an HTTPS tunnel in front of `docker compose up`, and
Chrome on the phone will install the app — real icon, real standalone
window — with no Android build at all.

There is deliberately **no service worker**. An offline cache on an
operational app means somebody can be shown a stock figure that was true an
hour ago, and deciding what may be served stale is a question about
warehouse practice rather than a build setting.

## Attachments: a disk, or a bucket

Generated PDFs, KYC documents, gate photographs and captured signatures go
to whichever of two adapters the environment selects.

**Naming `S3_BUCKET` is the switch.** There is no second mode flag to
forget: a bucket named and not used is not a state anyone means. Set
`ATTACHMENT_STORAGE=local` to override it — for a staging copy of
production's environment that should not write to production's bucket —
and `ATTACHMENT_STORAGE=s3` with no bucket **refuses to start** rather than
falling back to a disk, because a multi-container deployment quietly on
local disks is a fleet of half-populated directories and a document that
404s depending on which instance answered.

It speaks the S3 *protocol*, not AWS specifically: `S3_ENDPOINT` and
`S3_FORCE_PATH_STYLE` point it at MinIO in a rack, Cloudflare R2,
DigitalOcean Spaces or Wasabi. Credentials are optional — leave them unset
and the SDK's own chain finds an instance or task role, which is how a
deployment avoids holding long-lived keys at all.

`storage_key` keeps the same shape either way
(`<tenant>/<attachment-id>-<filename>`), so moving an existing deployment
is a copy and a variable, not a migration: sync the directory into the
bucket under the same paths, set `S3_BUCKET`, restart.

**What it deliberately does not do is presign URLs.** This application
already mints its own signed download links, which carry a document id and
an expiry it controls (`tenancy-and-security.md` §5). A parallel presigned
URL would be a second capability with different rules — and that is how a
document stays reachable after the link that named it was supposed to have
expired.

## Backups

```bash
ops/backup.sh /var/backups/warehouse           # database + attachments
ops/restore.sh /var/backups/warehouse/<stamp> <target-url> <attachments-dir>
```

Three things in there are worth knowing before you need them.

**Backups need their own database role.** Every tenant table is under
FORCE ROW LEVEL SECURITY, which applies to the table's owner too, so
`pg_dump` as the application's role fails partway through with
`ERROR: query would be affected by row-level security policy`. That is
correct behaviour and a terrible thing to learn during an incident, so
`backup.sh` checks for it before writing a byte and prints the fix:

```sql
create role warehouse_backup login password '...' bypassrls;
grant connect on database <db> to warehouse_backup;
grant usage on schema public to warehouse_backup;
grant select on all tables in schema public to warehouse_backup;
alter default privileges in schema public grant select on tables to warehouse_backup;
```

Read-only, which is the other reason not to reuse the application's role.

**The database is dumped first and the files second.** The two halves
cannot be captured at the same instant. Files first means the database can
name an attachment written after the file snapshot — a row pointing at
bytes the backup does not contain, which restores as an invoice nobody can
open. Database first means the file snapshot can hold bytes no row names:
an orphan, costing a few kilobytes. One direction loses documents; the
other wastes disk.

**The restore verifies itself, and refuses to pretend.** It checks the
dump's checksums, compares row counts against the ones recorded at backup
time, and confirms that every `attachments` row has its bytes on disk. That
verification also has to run as the bypassing role — counted under RLS,
every tenant table answers zero, so a perfect restore would report five
zeroes. It says it cannot verify rather than reporting a number it did not
really measure.

On object storage the bytes are not copied into the backup directory: the
bucket is backed up on its own terms (versioning, lifecycle rules, or a
scheduled `aws s3 sync`), and `attachments-location.txt` records where they
were, so a restore knows what it needs. The objects must be from the same
moment as the dump **or later** — never earlier.

## Still missing

Named rather than implied:

- **Error monitoring.** No Sentry, no structured log shipping. The logs are
  whatever the container writes.
- **A payment gateway.** `DECISIONS.md` §13. V1 runs on the seeded Free
  plan with upgrades arranged offline, and the upgrade prompt says so
  rather than inventing a tier.
- **An off-site copy, and a schedule.** `ops/backup.sh` takes a backup;
  nothing here runs it every night, copies it to another machine, or
  encrypts it. Those are decisions about where your data may live, and a
  cron line is the easy part.

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

**Object storage** was proved by running the whole application on it: the
API booted with `S3_BUCKET` set and no `ATTACHMENTS_DIR` at all, generated
a quotation PDF, served it back through a signed download link (a valid
56 KB PDF), round-tripped an uploaded KYC file — and left **zero files on
the local disk**, which is what proves nothing silently fell back. The
endpoint it spoke to was a local S3-compatible server rather than AWS, so
what is proved is the protocol conversation, not IAM or bucket policies.

**The backup was restored.** Not "a backup script exists": a real dump of a
running workspace was restored into an empty database, the row counts
matched, every attachment row had its bytes, and then the API was pointed
at the restored copy — where a document generated *before* the backup
opened as a valid PDF. Rehearse yours the same way, on a schedule. A backup
nobody has restored is a hope.
