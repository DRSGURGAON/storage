# Godown Book

Storage paperwork for packers and movers, and for godown owners who keep
household goods: quotations, storage agreements, storage receipts, goods
lists, storage bills, payment receipts, customer statements, release
records, notices about unpaid rent, damage reports, handover papers and
the bilty pack - made on a phone, shared on WhatsApp.

The app is sold on a subscription. Every company gets two free copies of
each document, marked as a demo; after that a subscription is needed,
which a Super Admin activates once payment is received.

## What it does

| The operator does this | The app makes this |
| --- | --- |
| Adds a customer once | Their details fill in on every later document |
| Prices a job | Quotation |
| Puts the terms in writing | Household Goods Storage Agreement |
| Records goods coming in | Storage Receipt, Goods List |
| Sends a signature link | The customer signs on their own phone, and it prints on the document |
| Charges for a period | Storage Bill |
| Takes money | Payment Receipt, and the balance updates |
| Is asked "what do I owe?" | Customer Statement |
| Hands the goods back | Release Record (customer and gate copies), signed by the customer |
| Takes a deposit | Security Deposit Receipt, and later a Refund Voucher or an Adjustment Note |
| Is not paid for months | Payment Reminder, then Final Notice, then Notice Before Disposal - each one kept as proof it went out |
| Finds goods damaged or missing | Damage / Loss Report with photographs on the same paper |
| Sends the goods to someone else | Authority Letter, or an Indemnity Bond when the receipt is lost |
| Moves goods by truck | Bilty / Lorry Receipt in four copies, the Goods Forwarding Note the sender signs, and a Delivery Challan - and the same bilty records the delivery |

Used personal and household effects need no e-way bill, and the bilty
and the challan say so on the paper.

Storage charges are worked out four ways: a fixed amount per month, an
amount per day, an amount per box per month, or one agreed amount. A
started month counts as a full month, and every bill line says in words
what was counted.

## Running it

Requirements: Flutter (stable), Java 17, and a Firebase project of your
own.

```bash
cd mobile/godown_book
flutter pub get
flutter test
flutter run
```

### Firebase

`lib/firebase_options.dart` in source control is a placeholder, so a
fresh clone cannot silently talk to somebody else's project. Point the
app at your own:

```bash
dart pub global activate flutterfire_cli
flutterfire configure --project=<your-firebase-project-id> --platforms=android,web
```

That rewrites `firebase_options.dart` and writes
`android/app/google-services.json`. In the Firebase Console, turn on
**Phone** sign-in and create a **Cloud Firestore** database, then deploy
the rules in `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

Until this is done the app opens on its "Could not connect" screen,
deliberately.

### The customer signing page

The operator can ask a customer to sign a document from their own phone:
the app sends a link, the customer opens it, reads the details and the
terms, signs with a finger and submits. The signature then prints on the
Storage Receipt and the Storage Agreement, with the date it was signed.

It is an electronic acknowledgement, not a certificate-based digital
signature. The documents say exactly that.

To turn it on:

1. Put your own Firebase web configuration into
   `signing_web/firebase-config.js` (those values are public, not
   secrets - Firebase Console, Project settings, Your apps, Web app).
2. Deploy the page and the rules:

   ```bash
   firebase deploy --only hosting,firestore:rules
   ```

3. Open the app as a Super Admin, go to Settings, Super Admin Dashboard,
   Settings, and put the hosting address (e.g.
   `https://your-project.web.app`) into **Signing page web address**.

Until that address is set, the signature buttons say the page is not set
up rather than sending a link that opens on nothing.

How the privacy works: each link carries a 32-character random token,
readable only by someone holding it, never listed. The link expires
after 14 days, and the moment the app has brought the signature back it
deletes the cloud copy - so a link stops showing a customer's details as
soon as it has done its job. The signature image itself lives on the
operator's own device.

### The first Super Admin

Super Admins authorise subscriptions. There is no way to make one from
inside the app. In the Firebase Console, add a document to the
`superAdmins` collection whose **document id is that person's Firebase
Auth uid**:

```
superAdmins/<uid>
  mobileNumber: "+919999999999"
  name: "Your name"
  isActive: true
```

They then see Super Admin Dashboard in Settings.

### Signing a release build

Make a keystore once and keep it safe - losing it means never updating
the app again:

```bash
keytool -genkey -v -keystore godown-book.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias godown
```

Put it at `mobile/godown_book/android/godown-book.jks` and create
`mobile/godown_book/android/key.properties`:

```properties
storeFile=godown-book.jks
storePassword=<store password>
keyAlias=godown
keyPassword=<key password>
```

Both files are gitignored. Without them the release build falls back to
debug signing, which runs on a phone but cannot be uploaded to Play.

```bash
flutter build appbundle --release
```

### Building in CI

`.github/workflows/godown-book-android.yml` analyses, tests and builds
the app bundle and an APK on every push that touches the app, and on
demand with a version name and code. It reads four optional secrets:

| Secret | What it is |
| --- | --- |
| `GODOWN_BOOK_GOOGLE_SERVICES_JSON` | Contents of `android/app/google-services.json` |
| `GODOWN_BOOK_FIREBASE_OPTIONS_DART` | Contents of `lib/firebase_options.dart` |
| `GODOWN_BOOK_KEYSTORE_BASE64` | The keystore, base64 encoded |
| `GODOWN_BOOK_KEYSTORE_PASSWORD`, `GODOWN_BOOK_KEY_ALIAS`, `GODOWN_BOOK_KEY_PASSWORD` | Its passwords and alias |

Without them the build still runs and still produces an artifact, and
says plainly in the log what that artifact cannot do.

## How it is put together

```
lib/
  core/           database, tenant scope, auth, permissions,
                  subscription access, document theme, cloud backup
  features/
    company/      the letterhead every document prints on
    customers/    the customer master and their own page
    quotation/    quotations
    storage_booking/  storage records, goods, photos, three papers
    release/      goods going back out
    signature/    signature links, and what came back
    billing/      bills, payments, statements
    documents/    the document centre
    dashboard/    home
    subscription/ plans, free copies, samples, Super Admin
```

Data lives on the device in SQLite, company-scoped: every table carries
a `company_id` and every read and write goes through helpers that filter
on it, so one company's records can never surface in another's. The
cloud holds the company profile, a document backup, the subscription and
the platform settings - nothing else.

`signing_web/` is the customer-facing signing page - plain HTML and the
Firebase web SDK, so it opens fast on a cheap phone.

Documents are built with the `pdf` package through one shared page kit,
so the letterhead, watermark, tables, terms, bank block and signature
band are identical on every document, and a theme change moves all of
them at once.

## Tests

```bash
flutter test
```

They run against real SQLite (`sqflite_common_ffi`) and an in-memory
Firestore (`fake_cloud_firestore`), and cover the schema, company
scoping, numbering, the four storage-charge models, bills and payments
keeping balances in step, releases moving stock, the free-copy
allowance, subscription dates, signature links from request to signed
image, and every PDF rendering real bytes.
