# Godown Book

Storage paperwork for packers and movers, and for godown owners who keep
household goods: quotations, storage agreements, storage receipts, goods
lists, storage bills, payment receipts, customer statements and release
records - made on a phone, shared on WhatsApp.

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
| Charges for a period | Storage Bill |
| Takes money | Payment Receipt, and the balance updates |
| Is asked "what do I owe?" | Customer Statement |
| Hands the goods back | Release Record (customer and gate copies) |

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
allowance, subscription dates, and every PDF rendering real bytes.
