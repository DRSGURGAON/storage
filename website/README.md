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

## Before you publish: fill in five details

Every page carries the same placeholders. Nothing else needs editing.

| Placeholder | Put in |
| --- | --- |
| `{{COMPANY_ADDRESS}}` | the postal address of DRS Softech |
| `{{SUPPORT_EMAIL}}` | the address you will answer support on |

Already filled in: the publisher is **DRS Softech**, the terms are governed
by the courts at **Gurugram**, and the support number is
**+91 70428 89134** as a `tel:` link with a WhatsApp link beside it.

The publisher name must match the entity that actually exists - the
proprietorship, LLP or company that the Play developer account and the
bank account belong to. If DRS Softech is a trading name over a
proprietorship, say so in the address line, e.g. "DRS Softech, a
proprietorship of <name>, <address>".

From the repository root:

```bash
cd website
sed -i \
  -e 's/{{COMPANY_ADDRESS}}/Plot 1, Sector 1, Gurugram, Haryana 122001/g' \
  -e 's/{{SUPPORT_EMAIL}}/support@example.com/g' \
  *.html
grep -rn '{{' *.html || echo "nothing left to fill in"
```

On Windows, open each file and use Replace All instead. The last line is
the check: it should print `nothing left to fill in`.

Read the pages once after replacing. The privacy policy describes what the
app actually does today - phone sign-in, records on the device, a cloud
backup, no advertising, no data sold - so it only needs changing when the
app changes.

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
