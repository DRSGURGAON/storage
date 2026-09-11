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

## The four screens

| Screen | What it is for |
| --- | --- |
| **Today** | How much is in the godown, what is coming, what space is free |
| **Bookings** | Search by name, phone or number — how a caller identifies themselves |
| **New booking** | One form, top to bottom: who, where, how much, and what |
| **Booking** | The record, and the three actions: goods arrived, hand goods back, close |

## What the screens refuse to do

These are in the API and repeated here, because a paywall or a guard that
only exists on the server is invisible until somebody hits it:

- **Goods arrived** is disabled with no inventory list, and says why.
- **Hand goods back** needs a name for who collected them, and warns
  before saving that this cannot be undone in software.
- **Close booking** does not appear while anything is still inside.
- **Hand goods back** and **Close** do not appear at all for field staff —
  `confirm_storage_intake` they have; `release_storage_goods` they do not.

## Not built yet

Rent invoicing, the PDF document set (inventory list, storage receipt,
release note), photo capture on items, and the customer's own view. The
API for the first two is the next slice; the engine for both already
exists on the 3PL side.
