# Firebase data and security architecture

StorageBill Pro is SQLite-first: every business record lives on the
phone and every screen reads from there. Firestore holds only what has
to leave the device - the company's backup, its subscription, KYC,
signature links and the platform's own settings. This page is the map
of that cloud data and of who may touch what.

## Collections

| Path | Written by | Read by | Purpose |
|---|---|---|---|
| `companies/{uid}` | the owner (`CompanyFirestoreSyncService`) | owner, Super Admin | company profile; `companyId` inside is the tenant id and never changes |
| `companies/{uid}/{table}/{rowId}` | the owner (`DocumentCloudSyncService`, 16 tables) | owner, Super Admin | one document per SQLite row; every row carries `company_id`, which must equal the profile's `companyId` |
| `subscriptions/{companyId}` | owner (create LIMITED, profile copy, counters up only); Super Admin (status, plan, dates) | owner, Super Admin | entitlement and the free-copy counters (`demoGenerationsUsed` map; `demoGenerationsUsedJson` kept for old readers) |
| `platformSettings/DEFAULT`, `platformSettings/promotions` | Super Admin | every signed-in user | payment QR, signing address, promotions |
| `counters/company_registration` | any signed-in user, by exactly +1 in a transaction | signed-in users | the App ID counter |
| `kycSubmissions/{companyId}` | owner (submit / resubmit as PENDING); Super Admin (review) | owner, Super Admin | KYC papers and their status |
| `signatureRequests/{token}` | owner (create, cancel); the customer (sign once, unauthenticated, by token) | anyone holding the token; Super Admin may list | signature links |
| `platformAdmins/{uid}` | **Admin SDK only** (`tool/admin/set-superadmin.js`) | the person themselves, Super Admin | registry of who holds the superadmin claim |
| `platformAuditLogs/{id}` | Super Admin (about themselves, server-stamped) and the admin tool | Super Admin | privileged-action audit trail; never edited or deleted |
| `superAdmins/{uid}` | nobody (legacy) | Super Admin | the pre-claims registry, kept so old documents are not orphaned; grants nothing |

Firebase Storage is not used. Logos, signatures and photos stay on the
device.

## Tenant model

- A tenant is a company. Its id is the `companyId` UUID minted once by
  `CompanyController.saveCompany` and stamped on every SQLite row as
  `company_id`.
- The cloud is keyed by the owner's Firebase uid (`companies/{uid}`),
  so the Firestore rules can tie every read and write to
  `request.auth.uid` without a lookup. The profile records which
  tenant that account owns; the rules refuse a backup row whose
  `company_id` differs from it, and refuse changing `companyId` once
  set.
- `TenantBootstrap` (see `lib/core/tenant/tenant_bootstrap.dart`)
  installs the account's own company at sign-in, restores its rows on a
  reinstall, and keeps another account's rows invisible on a shared
  phone. The rules make the same separation server-side.

## Who is a Super Admin

A Super Admin is a Firebase Auth user whose ID token carries the custom
claim `role: "superadmin"`. The rules check that claim (`isSuperAdmin()`)
and the app checks the same claim (`SuperAdminScope`). Nothing a client
can write makes anyone a Super Admin: `platformAdmins` and `superAdmins`
refuse every client write, and the old in-app bootstrap is gone.

Granting and revoking is done with the Admin SDK script in
`tool/admin/` (see its README). A grant reaches the phone with the next
ID token, so the person signs out and in again. A revoke also revokes
the account's refresh tokens.

What a Super Admin can do from the app: list companies and their
backups, list and change subscriptions, review KYC, publish platform
settings, read the audit log. What a Super Admin cannot do: edit a
company's profile or its backed-up rows, or grant admin access.

## Audit log

Every privileged action writes one `platformAuditLogs` entry:
`actorUid`, `actorMobile`, `action`, `targetCompanyId`, `targetUid`,
`metadata`, `appBuild`, `createdAt` (server time). The rules accept an
entry only from a superadmin token, only with `actorUid` equal to that
token's uid, only with a server timestamp, and never allow an update or
delete. Actions today: `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_SUSPENDED`,
`SUBSCRIPTION_CANCELLED`, `KYC_APPROVED`, `KYC_REJECTED`,
`PLATFORM_SETTINGS_PUBLISHED`, plus `SUPERADMIN_GRANTED` /
`SUPERADMIN_REVOKED` from the admin tool.

## Testing the rules

```bash
cd mobile/godown_book/firestore_tests
npm install
npm test          # starts the Firestore emulator and runs rules.test.mjs
```

CI runs the same tests on every push (`firestore-rules-test`) and only
deploys `firestore.rules` when they pass.

## Firebase Console steps

1. Deploy the rules: CI does it when `GODOWN_BOOK_FIREBASE_SERVICE_ACCOUNT`
   and `GODOWN_BOOK_FIREBASE_PROJECT_ID` are set, or run
   `firebase deploy --only firestore:rules` from `mobile/godown_book`.
2. Create a service-account key (Project settings, Service accounts,
   Generate new private key) for the admin tool. Keep it outside the
   repository.
3. Grant the first Super Admin with `tool/admin/set-superadmin.js`
   after that person has signed in to the app once.
4. Optional: delete any documents left in the legacy `superAdmins`
   collection. They grant nothing now.
