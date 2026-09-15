# The StorageBill Pro website

Five static pages, no build step, no framework. Google Play asks a listing
for three of them by name: a privacy policy, a way to delete an account
without installing the app, and a support contact. The other two are the
landing page people arrive on and the terms.

| File | What it is | Where Play needs it |
| --- | --- | --- |
| `index.html` | Landing page | Store listing → **App website** |
| `privacy.html` | Privacy policy | Store listing → **Privacy policy URL** (required) |
| `delete-account.html` | Account and data deletion | Data safety → **Account deletion URL** (required once an app lets people create an account) |
| `support.html` | Support, downloads, questions | Store listing → **Support email**, and the page to link from it |
| `terms.html` | Terms of use | Not required by Play, expected by most users |
| `404.html` | Not-found page | — |

`style.css` holds the whole design and uses the app's own palette, so the
site and the phone look like one product. `icon.png` is the Play icon.

## The contact details on the pages

Filled in and live:

| Detail | Value |
| --- | --- |
| Publisher | DRS Softech |
| Support email | defencerelocation@gmail.com |
| Phone / WhatsApp | +91 70428 89134 (`tel:` link, WhatsApp link beside it) |
| Business hours | Mon to Sun, 9 AM to 6 PM |
| Governing law | the courts at Gurugram |

There is **no postal address on the pages yet**. Play does not require
one, and email plus phone satisfies the contact requirement, so the site
publishes without it. Add it when you have it: put a line back into the
`contact-block` on `privacy.html`, `terms.html` and `delete-account.html`,
and a `Post:` line in `support.html`.

The publisher name must match the entity that actually exists - the
proprietorship, LLP or company the Play developer account and the bank
account belong to. If DRS Softech is a trading name over a
proprietorship, write it that way when you add the address: "DRS Softech,
a proprietorship of <name>, <address>".

Read the pages once before submitting them to Play. The privacy policy
describes what the app actually does today - phone sign-in, records on
the device, a cloud backup, no advertising, no data sold - so it only
needs changing when the app changes.

## Publishing it

`.github/workflows/website.yml` publishes this folder to GitHub Pages on
every push that touches it. Turn it on once: repository **Settings** →
**Pages** → **Source: GitHub Actions**. The site then lives at
`https://drsgurgaon.github.io/storage/`, which is a valid URL for every
Play field above.

To put it on your own domain instead, add a `CNAME` file here containing
the domain and point the domain's DNS at GitHub Pages.

To host it on Firebase instead, note that `mobile/godown_book/firebase.json`
already serves the customer signing page at the site root. Give the website
its own Firebase Hosting site rather than replacing that one, or the
signing links stop working.

## Checking it before you push

```bash
cd website && python3 -m http.server 8000
```

Then open `http://localhost:8000`. Read every page on a narrow window as
well: a Play reviewer will open the privacy policy on a phone.
