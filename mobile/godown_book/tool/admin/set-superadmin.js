#!/usr/bin/env node
// Grants, revokes or lists platform Super Admins for StorageBill Pro.
//
// Super Admin is the custom claim `role: "superadmin"` on a Firebase
// Auth account, checked by the Firestore rules (isSuperAdmin()) and by
// the app (SuperAdminScope). Only this script, running with a service
// account, can set it - nothing in the app can. Each grant is mirrored
// in platformAdmins/{uid} for the admin panel, and every grant/revoke
// is written to platformAuditLogs.
//
// Usage (from mobile/godown_book/tool/admin, after `npm install`):
//
//   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
//   node set-superadmin.js grant  --phone +919999999999 [--name "Your name"]
//   node set-superadmin.js grant  --uid <firebaseUid>
//   node set-superadmin.js revoke --phone +919999999999
//   node set-superadmin.js list
//
// The account must already exist (it has signed in to the app once).
// The claim reaches the phone with the next ID token: the person
// signs out and back in, and the Super Admin Dashboard appears.

import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const CLAIM_KEY = 'role';
const CLAIM_VALUE = 'superadmin';

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error(
    'Usage:\n' +
      '  node set-superadmin.js grant  (--phone +91XXXXXXXXXX | --uid <uid>) [--name "Name"]\n' +
      '  node set-superadmin.js revoke (--phone +91XXXXXXXXXX | --uid <uid>)\n' +
      '  node set-superadmin.js list\n\n' +
      'Credentials: GOOGLE_APPLICATION_CREDENTIALS must point to a service-account\n' +
      'key for the Firebase project (or pass --key <file>). Never commit that file.',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) usage(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) usage(`Missing value for --${key}`);
    options[key] = value;
    i += 1;
  }
  return { command, options };
}

function initialise(options) {
  if (options.key) {
    const serviceAccount = JSON.parse(readFileSync(options.key, 'utf8'));
    return initializeApp({ credential: cert(serviceAccount) });
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    usage('Set GOOGLE_APPLICATION_CREDENTIALS or pass --key <service-account.json>.');
  }
  return initializeApp({ credential: applicationDefault() });
}

async function resolveUser(auth, options) {
  if (options.uid) return auth.getUser(options.uid);
  if (options.phone) {
    const phone = options.phone.startsWith('+') ? options.phone : `+91${options.phone}`;
    return auth.getUserByPhoneNumber(phone);
  }
  usage('Give the account as --phone or --uid.');
  return null;
}

async function writeAudit(db, actor, action, target, metadata) {
  await db.collection('platformAuditLogs').add({
    actorUid: actor,
    actorMobile: '',
    action,
    targetCompanyId: '',
    targetUid: target,
    metadata,
    appBuild: 'tool/admin/set-superadmin.js',
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function grant(auth, db, options) {
  const user = await resolveUser(auth, options);
  const existing = user.customClaims ?? {};
  await auth.setCustomUserClaims(user.uid, { ...existing, [CLAIM_KEY]: CLAIM_VALUE });

  const ref = db.collection('platformAdmins').doc(user.uid);
  const snapshot = await ref.get();
  await ref.set(
    {
      uid: user.uid,
      role: CLAIM_VALUE,
      active: true,
      mobileNumber: user.phoneNumber ?? '',
      name: options.name ?? snapshot.get('name') ?? '',
      grantedBy: 'admin-sdk',
      createdAt: snapshot.exists ? snapshot.get('createdAt') : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await writeAudit(db, 'admin-sdk', 'SUPERADMIN_GRANTED', user.uid, {
    phone: user.phoneNumber ?? '',
  });

  console.log(`Granted superadmin to ${user.uid} (${user.phoneNumber ?? 'no phone'}).`);
  console.log('They must sign out and sign in again for the app to see it.');
}

async function revoke(auth, db, options) {
  const user = await resolveUser(auth, options);
  const claims = { ...(user.customClaims ?? {}) };
  delete claims[CLAIM_KEY];
  await auth.setCustomUserClaims(user.uid, claims);
  // Existing tokens stay valid until they expire (at most one hour);
  // revoking refresh tokens makes every device sign in again now.
  await auth.revokeRefreshTokens(user.uid);

  await db.collection('platformAdmins').doc(user.uid).set(
    {
      uid: user.uid,
      role: CLAIM_VALUE,
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await writeAudit(db, 'admin-sdk', 'SUPERADMIN_REVOKED', user.uid, {
    phone: user.phoneNumber ?? '',
  });

  console.log(`Revoked superadmin from ${user.uid} (${user.phoneNumber ?? 'no phone'}).`);
}

async function list(db) {
  const snapshot = await db.collection('platformAdmins').orderBy('createdAt').get();
  if (snapshot.empty) {
    console.log('No platform admins recorded.');
    return;
  }
  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(
      `${doc.id}  ${data.active ? 'active  ' : 'inactive'}  ` +
        `${data.mobileNumber ?? ''}  ${data.name ?? ''}`,
    );
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!['grant', 'revoke', 'list'].includes(command ?? '')) usage();

  initialise(options);
  const auth = getAuth();
  const db = getFirestore();

  if (command === 'grant') await grant(auth, db, options);
  if (command === 'revoke') await revoke(auth, db, options);
  if (command === 'list') await list(db);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
