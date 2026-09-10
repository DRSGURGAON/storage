# Web — Warehouse Documentation & Operations SaaS

The operator-facing frontend for [`apps/api`](../api/README.md), and the
last P0 item in
[`docs/architecture/v1-scope-specification.md`](../../docs/architecture/v1-scope-specification.md)
§10: every screen in that document's §8 screen map existed only as an API
until this app.

## Stack

React 18 + TypeScript on Vite, Ant Design for the component set, TanStack
Query for server state, React Router for navigation — `DECISIONS.md` §0's
choices, unchanged. No global state library: everything on screen is server
state, and inventing a second place to keep it is how a stock figure ends
up disagreeing with itself.

## Running it

```bash
cd apps/api && npm run start:dev      # the API, on :3000
cd apps/web && npm run dev            # this app, on :5173
```

The dev server proxies `/api` to `http://localhost:3000` (override with
`API_PROXY_TARGET`), so the browser's requests are same-origin: no CORS
configuration on the API, and no base URL compiled into the bundle.
`VITE_API_URL` exists only for a deployment that really does serve the two
from different hosts.

## What is built

Sign-in and workspace signup; the role-filtered shell and dashboard; the
setup checklist; every master (customers with addresses and contacts,
warehouses with their location tree, products, transport, rate cards with
priced lines); the inbound chain (gate entry → inward → GRN → put-away →
warehouse receipt); stock on hand, the ledger and ageing; the outbound
chain (release order → reserve → pick → dispatch → gate pass → gate-out →
POD); billing runs, invoices, payments and statements; quotations and
agreements; stock transfers and verifications; returns; the Document
Centre with its relationship graph; the **reports library** (one screen
built from the API's own catalogue, so a report added on the server
appears here with its filters and column types and no frontend change);
notifications; settings (company,
users, notification rules, number series, operations, plan and usage, audit
log, and **your account** — where anyone, whatever their role, changes their
own password); **forgotten-password and reset** screens outside the session
entirely; the public **/privacy** and **/delete-account** pages a store
listing points at; and the **customer portal**, which a `customer` login lands in instead of the staff app.

Every staff screen carries **global search** in its header (ux-system §4):
one box over the API's one ranked `GET /search`, results grouped by type,
each one opening its record — or, for the types this app reads in a list
rather than on a page, that list already filtered to what was typed. On a
phone it is an icon that opens a full-screen sheet.

A route the navigation offers but that has no screen yet renders an
explicit "not built yet" page. The navigation is generated from what the
API supports, which is still ahead of the UI in a few places, and a blank
page would look like missing data.

Blueprint §64's phone pass **has** been run — 390×844 in a real browser,
across the operator screens, the settings screens and a create drawer, with
every screen reporting `scrollWidth == clientWidth == 390`. It found three
things worth fixing: there was no way to open the navigation at all below
`lg`, the list tables pushed the page sideways, and the login card and the
form drawers were both wider than the screen. All three are fixed.

The company's letterhead images (logo, signature, seal) are uploaded from
Settings → Company with the same card, and the one each document prints is
marked "in use".

Photographs and signatures are captured here too (Phase 12a): the
`Attachments` card on a GRN, gate entry, customer or POD uses an upload
control with `capture="environment"`, so a phone opens the camera rather
than a file browser, and the POD screen takes a real signature on a canvas
and saves it as the image the delivery document prints.

The Agreement screen carries §15's eleven-step wizard, drawn from the
API's own definition, each step saving on its own and showing what is
still outstanding before the agreement can be submitted.

Running out of free copies is a screen of its own (`components/Paywall.tsx`,
ux-system §11): the sentence, the figures and the list of what a larger
plan would give all come from the API — the 402's own body and
`GET /plan/upgrade/:featureCode` — so the page that asks someone to pay
cannot promise something the entitlement engine does not enforce. Where
there is nothing to sell yet, it says that instead. Generating a document
that *does* fit within the plan nudges once at the first copy and once at
the last (§12), and never in between.

## Deploying it

`apps/web/Dockerfile` builds these assets and serves them from nginx, which
also proxies `/api` to the API container — the same shape the dev server
has, so the browser's requests stay same-origin in production too. The
nginx config carries the CSP, the frame and referrer policies, and
immutable caching for the hashed asset filenames (never for `index.html`,
which is what points at the new hashes after a deploy). See
[`docs/architecture/deployment.md`](../../docs/architecture/deployment.md).

## Installing it on a phone

`public/manifest.webmanifest` plus the icon set makes this installable:
Android and iOS can add it to a home screen, and a Play Store listing
built as a Trusted Web Activity reads exactly these fields. There is
deliberately **no service worker yet** — an offline cache on an
operational app means someone can be shown a stock figure that was true an
hour ago, and choosing what may be served stale is a decision about
warehouse practice, not a build setting.

The production bundle is split so that Ant Design and React are cached
separately from this app's own code: a release changes ~45 kB gzipped
rather than ~494 kB, which is the difference that shows up on a phone
inside a shed.

## Checking the screens against the API

`node tools/contract-audit.mjs` (with `TOKEN=` a bearer token and a server
running) walks every `api<T>('/path')` call in `src/`, fetches that path,
and compares the fields `T` declares against the keys the server actually
sends. TypeScript cannot do this: the API is JSON at runtime, so a field
that was renamed — or never existed — arrives as `undefined` and renders
as a blank column rather than as an error.

It is not theoretical. The agreements screen read `effectiveFrom`,
`effectiveTo` and `clauses[].renderedClause` for three phases and the API
has never returned any of the three; the audit then found two more (a
put-away's GRN number and a rate card line's charge type), both fixed on
the API side, since the id alone is not what a person reads.

## How it is put together

- **`src/lib/api.ts`** — the one place this app talks to the API. It
  attaches the bearer token, unwraps JSON, and turns a non-2xx into an
  `ApiError` carrying *the server's own message*. That last part matters:
  the API says specific, useful things ("Only 30 of that product is
  available to return on this dispatch"), and a client that replaces them
  with "Something went wrong" throws away the most valuable thing it was
  handed.
- **`src/lib/session.tsx`** — the session, read from `GET /auth/me` rather
  than decoded from the JWT. The token's claims are the same data and one
  fetch cheaper, but they are a snapshot from login: a role change or a
  disabled membership bites the server immediately, and a UI drawn from
  stale claims would offer actions that no longer exist.
- **`session.can(permission)`** — whether to *offer* an action, never
  whether to allow one. `/auth/me` returns the caller's live grants and the
  navigation and buttons are filtered from them; the API re-resolves the
  same grants on every request and is what actually decides (saas-layer
  §14, "never trust the frontend"). Hiding a button the server would refuse
  is courtesy, not a control.
- **`src/lib/format.ts`** — the formatting rules every screen shares,
  including the status → colour map. The status vocabulary is common across
  modules (draft, submitted, approved, cancelled), so colouring it per
  screen would mean the same word rendering differently depending on where
  you saw it.

Quantities arrive as **strings**, deliberately: they are `numeric` columns
and postgres.js hands them over as text, so a three-decimal warehouse
quantity cannot be quietly rounded through a float. `format.quantity()` is
the only place they become numbers.

## How it is tested

There are no component tests. The app is exercised by driving a real
browser (Puppeteer) against a live API on a from-nothing database: the
whole inbound chain, the whole outbound chain, and every screen loaded and
looked at.

That is a deliberate trade rather than an omission to fix later. Driving
the real thing catches what a component test cannot — a wrong endpoint
shape, a field the API can derive that the form insists on, a response
that is a bare array where a page was expected — and every one of those
was found this way. It misses what a component test would catch: a
rendering regression in one component, with no API involved. If this app
grows a piece of genuinely tricky client-side logic, that piece should get
a unit test; today the tricky logic is all on the server, and it has 329
of them.
