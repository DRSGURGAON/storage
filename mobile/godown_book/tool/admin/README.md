# Platform admin tooling

Super Admin access in StorageBill Pro is the custom claim
`role: "superadmin"` on a Firebase Auth account. The Firestore rules
(`isSuperAdmin()`) and the app (`SuperAdminScope`) both check that claim
and nothing else, so the only way to become a Super Admin is this
script, run by the platform operator with a service account.

```bash
cd mobile/godown_book/tool/admin
npm install

# A service-account key for the Firebase project. Keep it outside the
# repository; this folder's .gitignore refuses every *.json but
# package.json anyway.
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json

node set-superadmin.js grant  --phone +919999999999 --name "Your name"
node set-superadmin.js revoke --phone +919999999999
node set-superadmin.js list
```

The account must already exist in Firebase Auth, which means the
person has signed in to the app once. After a grant they sign out and
in again; the claim travels with the next ID token and the Super Admin
Dashboard appears under Settings.

What the script writes:

- the custom claim on the account (Firebase Auth);
- `platformAdmins/{uid}` with `uid`, `role`, `active`, `mobileNumber`,
  `name`, `grantedBy`, `createdAt`, `updatedAt` (the registry the admin
  panel lists; clients cannot write it);
- one `platformAuditLogs` entry per grant or revoke.

A revoke removes the claim, marks the registry entry inactive and
revokes the account's refresh tokens so every device signs in again.
