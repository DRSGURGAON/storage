# Storage Book — the household storage app

The operator-facing app for storing a family's belongings: a booking, an
item-wise inventory list, the goods coming in, the goods going back, and
the booking wound up.

It talks to the same API as `apps/web` — same login, same tenants, same
row-level security, same numbering and documents. What differs is who is
holding the phone.

```bash
npm run dev --workspace apps/storage-web   # http://localhost:5174
```

## Why it is a separate app, not a section of the other one

The 3PL app has eleven menu groups because contract warehousing genuinely
has eleven. A person storing thirty cartons and an almirah needs four
screens, and burying those four inside the eleven is how the product
becomes "too much software" — the complaint that started this app.

So: same engine underneath, two front doors. A customer who grows from
household storage into contract warehousing changes app, not data.

## Why there is no component library

Every control here is a plain element styled by `src/app.css`.

- **It is used standing up.** Nothing tappable is under 48px, the type is
  16px or larger (below that iOS zooms the page on focus), and the actions
  sit at the bottom of the sheet where a thumb reaches.
- **Native pickers win on a phone.** A `<select>` and `<input type="date">`
  open the OS wheel; a JavaScript date picker opens a small calendar built
  for a mouse.
- **Fewer steps is the whole product.** A dense enterprise component set
  pulls the other way, and the bundle it costs is paid by somebody on a
  godown's patchy signal.

## The screens

| Screen | What it is for |
| --- | --- |
| **Today** | How much is in the godown, what is coming, what space is free |
| **Bookings** | Search by name, phone or number — how a caller identifies themselves |
| **New booking** | One form, top to bottom: who, where, how much, and what |
| **Booking** | The record, and the three actions: goods arrived, hand goods back, close |
| **Plan** | What is in storage against what the plan allows, and how to ask for a bigger one |

## What the screens refuse to do

These are in the API and repeated here, because a paywall or a guard that
only exists on the server is invisible until somebody hits it:

- **Goods arrived** is disabled with no inventory list, and says why.
- **Hand goods back** needs a name for who collected them, and warns
  before saving that this cannot be undone in software.
- **Close booking** does not appear while anything is still inside.
- **Hand goods back** and **Close** do not appear at all for field staff —
  `confirm_storage_intake` they have; `release_storage_goods` they do not.

## The subscription

Priced per **customer in storage**, not per godown — the opposite
dimension to the 3PL product, because a household storage operator runs
one godown for years and grows by holding more families' goods in it.

| Plan | Customers in storage | Price |
| --- | --- | --- |
| Free | 3 | ₹0, forever, no card |
| Solo | 25 | ₹799 / month |
| Godown | 100 | ₹2,499 / month |
| Network | no limit | ₹6,999 / month |

Two things make this safe for a customer to accept. The count is **live**
— a family taking their things home frees the slot the same day, so a
quieter month is a cheaper month — and it is charged at the **intake**,
not at the booking, so an enquiry that never arrives never cost anybody a
slot.

Nothing is charged from inside the app. The Plan screen sends a request
and a human arranges payment (`DECISIONS.md` §13 — no gateway is wired
yet).

## Installing it on a phone

The app ships a manifest, icons and a service worker, so over HTTPS Chrome
offers **Install app** and it opens full-screen with its own icon. The
service worker uses two strategies: the shell is cache-first, so the app
opens on a dead connection; the API is network-first with a cached
fallback **for reads only**. Writes are never cached or replayed —
re-sending "hand back 4 cartons" when the signal returns is the one
mistake nobody could undo.

See `ops/twa/README.md` for the HTTPS address, and the path to a Play
Store listing.

## Not built yet

Rent invoicing, the PDF document set (inventory list, storage receipt,
release note), photo capture on items, and the customer's own view. The
API for the first two is the next slice; the engine for both already
exists on the 3PL side.
