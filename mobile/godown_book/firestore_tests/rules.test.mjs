// Security-rules tests for ../firestore.rules, run against the
// Firestore emulator:  npm test   (firebase emulators:exec).
//
// Two companies (A and B), one platform Super Admin (claim role ==
// superadmin), and nobody. Every collection the app touches is covered
// with the shapes the app actually writes.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT = 'demo-storagebill';
const UID_A = 'uid-company-a';
const UID_B = 'uid-company-b';
const UID_ADMIN = 'uid-platform-admin';
const COMPANY_A = 'company-a-uuid';
const COMPANY_B = 'company-b-uuid';

let env;

const companyDoc = (companyId, name) => ({
  companyId,
  companyName: name,
  address: 'GT Road',
  mobile1: '9999999999',
});

const subscriptionDoc = (companyId, ownerUid, extra = {}) => ({
  id: `sub-${companyId}`,
  companyId,
  planId: null,
  status: 'LIMITED',
  startDate: null,
  expiryDate: null,
  ownerUid,
  companyName: 'Company',
  ownerMobile: '9999999999',
  gstNumber: '',
  authorizedSignatoryName: '',
  email: '',
  companyCode: '4838',
  demoGenerationsUsedJson: '{}',
  demoGenerationsUsed: {},
  createdAt: '2026-09-01T00:00:00',
  updatedAt: '2026-09-01T00:00:00',
  ...extra,
});

const customerRow = (companyId, id) => ({
  id,
  company_id: companyId,
  customer_name: 'Rajesh Kumar',
  mobile_number: '9876500001',
  is_active: 1,
  created_at: '2026-09-01T00:00:00',
});

/** Seeds the cloud the way the app leaves it, bypassing the rules. */
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'companies', UID_A), companyDoc(COMPANY_A, 'Sharma Packers'));
    await setDoc(doc(db, 'companies', UID_B), companyDoc(COMPANY_B, 'Verma Storage'));
    await setDoc(doc(db, 'companies', UID_A, 'customers', 'cust-a'), customerRow(COMPANY_A, 'cust-a'));
    await setDoc(doc(db, 'companies', UID_B, 'customers', 'cust-b'), customerRow(COMPANY_B, 'cust-b'));
    await setDoc(doc(db, 'subscriptions', COMPANY_A), subscriptionDoc(COMPANY_A, UID_A, {
      demoGenerationsUsed: { bill: 1 },
      demoGenerationsUsedJson: '{"bill":1}',
    }));
    await setDoc(doc(db, 'subscriptions', COMPANY_B), subscriptionDoc(COMPANY_B, UID_B, {
      status: 'ACTIVE',
      planId: 'PLAN_QUARTERLY',
      startDate: '2026-09-01T00:00:00',
      expiryDate: '2026-11-30T00:00:00',
    }));
    await setDoc(doc(db, 'platformSettings', 'DEFAULT'), { upiId: 'ops@upi', merchantName: 'StorageBill' });
    await setDoc(doc(db, 'platformSettings', 'promotions'), { promos: [] });
    await setDoc(doc(db, 'counters', 'company_registration'), { lastAssigned: 4840, updatedAt: null });
    await setDoc(doc(db, 'kycSubmissions', COMPANY_A), {
      companyId: COMPANY_A, ownerUid: UID_A, companyName: 'Sharma Packers', status: 'PENDING',
      reviewedAt: '', rejectionReason: '', submittedAt: '2026-09-01T00:00:00',
    });
    await setDoc(doc(db, 'platformAdmins', UID_ADMIN), {
      uid: UID_ADMIN, role: 'superadmin', active: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'signatureRequests', 'token-a-1234567890abcdefghijklmnop'), {
      companyId: COMPANY_A, ownerUid: UID_A, status: 'PENDING', documentType: 'storage_receipt',
      customerName: 'Rajesh', createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    });
    await setDoc(doc(db, 'platformAuditLogs', 'log-1'), {
      actorUid: UID_ADMIN, action: 'SUBSCRIPTION_ACTIVATED', targetCompanyId: COMPANY_B,
      targetUid: UID_B, metadata: {}, appBuild: 'test', createdAt: Timestamp.now(),
    });
  });
}

const asA = () => env.authenticatedContext(UID_A).firestore();
const asB = () => env.authenticatedContext(UID_B).firestore();
const asAdmin = () => env.authenticatedContext(UID_ADMIN, { role: 'superadmin' }).firestore();
const asNobody = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(seed);

describe('1. a company reads its own records', () => {
  it('profile, backup rows and subscription', async () => {
    const db = asA();
    await assertSucceeds(getDoc(doc(db, 'companies', UID_A)));
    await assertSucceeds(getDoc(doc(db, 'companies', UID_A, 'customers', 'cust-a')));
    await assertSucceeds(getDocs(collection(db, 'companies', UID_A, 'customers')));
    await assertSucceeds(getDoc(doc(db, 'subscriptions', COMPANY_A)));
    await assertSucceeds(getDoc(doc(db, 'kycSubmissions', COMPANY_A)));
    await assertSucceeds(getDoc(doc(db, 'platformSettings', 'DEFAULT')));
  });

  it('writes its own profile and backup rows, and the tenant id never changes', async () => {
    const db = asA();
    await assertSucceeds(updateDoc(doc(db, 'companies', UID_A), { companyName: 'Sharma Packers Pvt Ltd' }));
    await assertFails(updateDoc(doc(db, 'companies', UID_A), { companyId: 'another-uuid' }));
    await assertSucceeds(setDoc(doc(db, 'companies', UID_A, 'invoices', 'inv-1'), {
      id: 'inv-1', company_id: COMPANY_A, invoice_no: 'INV/2026/0001',
    }));
    await assertSucceeds(deleteDoc(doc(db, 'companies', UID_A, 'customers', 'cust-a')));
  });

  it('cannot back up a row stamped with another tenant id', async () => {
    const db = asA();
    await assertFails(setDoc(doc(db, 'companies', UID_A, 'customers', 'stray'), customerRow(COMPANY_B, 'stray')));
    await assertFails(setDoc(doc(db, 'companies', UID_A, 'customers', 'noid'), { company_id: COMPANY_A }));
    await assertFails(setDoc(doc(db, 'companies', UID_A, 'customers', 'x'), { id: 'y', company_id: COMPANY_A }));
  });
});

describe('2 and 3. a company can neither read nor write another company', () => {
  it('profile and backup rows', async () => {
    const db = asA();
    await assertFails(getDoc(doc(db, 'companies', UID_B)));
    await assertFails(getDoc(doc(db, 'companies', UID_B, 'customers', 'cust-b')));
    await assertFails(getDocs(collection(db, 'companies', UID_B, 'customers')));
    await assertFails(getDocs(collection(db, 'companies')));
    await assertFails(updateDoc(doc(db, 'companies', UID_B), { companyName: 'Hijacked' }));
    await assertFails(setDoc(doc(db, 'companies', UID_B, 'customers', 'planted'), customerRow(COMPANY_B, 'planted')));
    await assertFails(deleteDoc(doc(db, 'companies', UID_B, 'customers', 'cust-b')));
    await assertFails(deleteDoc(doc(db, 'companies', UID_B)));
  });

  it('subscription, KYC and signature requests', async () => {
    const db = asA();
    await assertFails(getDoc(doc(db, 'subscriptions', COMPANY_B)));
    await assertFails(getDocs(collection(db, 'subscriptions')));
    await assertFails(updateDoc(doc(db, 'subscriptions', COMPANY_B), { companyName: 'x' }));
    await assertFails(getDoc(doc(db, 'kycSubmissions', COMPANY_B)));
    await assertFails(getDocs(collection(db, 'kycSubmissions')));
    await assertFails(getDocs(collection(db, 'signatureRequests')));
  });
});

describe('4. platform collections are closed to normal users', () => {
  it('platformAdmins, superAdmins, audit log', async () => {
    const db = asA();
    await assertFails(getDoc(doc(db, 'platformAdmins', UID_ADMIN)));
    await assertFails(getDocs(collection(db, 'platformAdmins')));
    await assertFails(getDoc(doc(db, 'superAdmins', UID_ADMIN)));
    await assertFails(getDocs(collection(db, 'platformAuditLogs')));
    await assertFails(getDoc(doc(db, 'platformAuditLogs', 'log-1')));
    await assertFails(addDoc(collection(db, 'platformAuditLogs'), {
      actorUid: UID_A, action: 'SUBSCRIPTION_ACTIVATED', targetCompanyId: COMPANY_A,
      targetUid: UID_A, metadata: {}, appBuild: 'x', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, 'platformSettings', 'DEFAULT'), { upiId: 'attacker@upi' }));
    await assertFails(setDoc(doc(db, 'platformSettings', 'promotions'), { promos: [] }));
  });

  it('a user may read only their own platformAdmins entry', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'platformAdmins', UID_ADMIN)));
    await assertFails(getDoc(doc(asA(), 'platformAdmins', UID_A)) .then(() => { throw new Error('unreachable'); }).catch(() => Promise.reject(new Error('denied')))).catch(() => {});
  });
});

describe('5. a company cannot change its own entitlement', () => {
  it('status, plan, dates and owner are read-only for the owner', async () => {
    const db = asA();
    const ref = doc(db, 'subscriptions', COMPANY_A);
    await assertFails(updateDoc(ref, { status: 'ACTIVE' }));
    await assertFails(updateDoc(ref, { planId: 'PLAN_YEARLY' }));
    await assertFails(updateDoc(ref, { expiryDate: '2099-12-31T00:00:00' }));
    await assertFails(updateDoc(ref, { startDate: '2026-01-01T00:00:00' }));
    await assertFails(updateDoc(ref, { ownerUid: UID_B }));
    await assertFails(updateDoc(ref, { companyId: COMPANY_B }));
  });

  it('free-copy counters may go up, never down or away', async () => {
    const db = asA();
    const ref = doc(db, 'subscriptions', COMPANY_A);
    await assertSucceeds(updateDoc(ref, {
      demoGenerationsUsed: { bill: 2 }, demoGenerationsUsedJson: '{"bill":2}', updatedAt: 'now',
    }));
    await assertSucceeds(updateDoc(ref, {
      demoGenerationsUsed: { bill: 2, quotation: 1 }, demoGenerationsUsedJson: '{"bill":2,"quotation":1}',
    }));
    await assertFails(updateDoc(ref, { demoGenerationsUsed: { bill: 0 } }));
    await assertFails(updateDoc(ref, { demoGenerationsUsed: {} }));
    await assertFails(updateDoc(ref, { demoGenerationsUsed: { bill: 'many' } }));
  });

  it('the profile copy may change; nothing else', async () => {
    const db = asA();
    const ref = doc(db, 'subscriptions', COMPANY_A);
    await assertSucceeds(updateDoc(ref, {
      companyName: 'Sharma Packers Pvt Ltd', ownerMobile: '9999999999', gstNumber: '06AAAAA0000A1Z5',
      authorizedSignatoryName: 'R Sharma', email: 'r@x.in', companyCode: '4838', updatedAt: 'now',
    }));
    await assertFails(updateDoc(ref, { somethingElse: true }));
  });

  it('a new company starts LIMITED, owned by itself, with nothing granted', async () => {
    const db = asB();
    const fresh = 'company-c-uuid';
    await assertFails(setDoc(doc(db, 'subscriptions', fresh), subscriptionDoc(fresh, UID_B, { status: 'ACTIVE' })));
    await assertFails(setDoc(doc(db, 'subscriptions', fresh), subscriptionDoc(fresh, UID_B, { expiryDate: '2099-01-01' })));
    await assertFails(setDoc(doc(db, 'subscriptions', fresh), subscriptionDoc(fresh, UID_A)));
    await assertFails(setDoc(doc(db, 'subscriptions', fresh), subscriptionDoc('other-id', UID_B)));
    await assertSucceeds(setDoc(doc(db, 'subscriptions', fresh), subscriptionDoc(fresh, UID_B)));
    await assertFails(deleteDoc(doc(db, 'subscriptions', fresh)));
  });
});

describe('6. nobody can make themselves a Super Admin from a client', () => {
  it('platformAdmins and superAdmins refuse every client write', async () => {
    const db = asA();
    const record = { uid: UID_A, role: 'superadmin', active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(db, 'platformAdmins', UID_A), record));
    await assertFails(setDoc(doc(db, 'superAdmins', UID_A), { id: UID_A, uid: UID_A, isActive: true }));
    // Not even an existing Super Admin can grant from a client.
    await assertFails(setDoc(doc(asAdmin(), 'platformAdmins', UID_B), { ...record, uid: UID_B }));
    await assertFails(deleteDoc(doc(asAdmin(), 'platformAdmins', UID_ADMIN)));
  });

  it('a self-declared claim-less user is still a normal user', async () => {
    const pretender = env.authenticatedContext(UID_A, { role: 'admin' }).firestore();
    await assertFails(getDocs(collection(pretender, 'subscriptions')));
    await assertFails(getDoc(doc(pretender, 'companies', UID_B)));
  });
});

describe('7. a Super Admin reaches the platform data the admin panel needs', () => {
  it('companies, subscriptions, KYC, settings, admins, audit log', async () => {
    const db = asAdmin();
    await assertSucceeds(getDocs(collection(db, 'companies')));
    await assertSucceeds(getDoc(doc(db, 'companies', UID_A)));
    await assertSucceeds(getDocs(collection(db, 'companies', UID_A, 'customers')));
    await assertSucceeds(getDocs(collection(db, 'subscriptions')));
    await assertSucceeds(getDocs(collection(db, 'kycSubmissions')));
    await assertSucceeds(getDocs(collection(db, 'platformAdmins')));
    await assertSucceeds(getDocs(collection(db, 'platformAuditLogs')));
    await assertSucceeds(setDoc(doc(db, 'platformSettings', 'DEFAULT'), { upiId: 'ops@upi', merchantName: 'StorageBill' }, { merge: true }));
  });

  it('activates, suspends and reviews, but never edits a company profile or its rows', async () => {
    const db = asAdmin();
    await assertSucceeds(updateDoc(doc(db, 'subscriptions', COMPANY_A), {
      status: 'ACTIVE', planId: 'PLAN_QUARTERLY', startDate: '2026-09-01', expiryDate: '2026-11-30',
    }));
    await assertSucceeds(updateDoc(doc(db, 'subscriptions', COMPANY_B), { status: 'SUSPENDED' }));
    await assertSucceeds(updateDoc(doc(db, 'kycSubmissions', COMPANY_A), { status: 'APPROVED', reviewedAt: 'now' }));
    await assertFails(updateDoc(doc(db, 'companies', UID_A), { companyName: 'Renamed by admin' }));
    await assertFails(setDoc(doc(db, 'companies', UID_A, 'customers', 'admin-row'), customerRow(COMPANY_A, 'admin-row')));
  });

  it('writes audit entries only about itself, stamped by the server, and cannot alter them', async () => {
    const db = asAdmin();
    await assertSucceeds(addDoc(collection(db, 'platformAuditLogs'), {
      actorUid: UID_ADMIN, actorMobile: '', action: 'SUBSCRIPTION_ACTIVATED', targetCompanyId: COMPANY_A,
      targetUid: UID_A, metadata: { planId: 'PLAN_QUARTERLY' }, appBuild: 'test', createdAt: serverTimestamp(),
    }));
    await assertFails(addDoc(collection(db, 'platformAuditLogs'), {
      actorUid: UID_B, action: 'SUBSCRIPTION_ACTIVATED', targetCompanyId: COMPANY_A,
      targetUid: UID_A, metadata: {}, appBuild: 'test', createdAt: serverTimestamp(),
    }));
    await assertFails(addDoc(collection(db, 'platformAuditLogs'), {
      actorUid: UID_ADMIN, action: 'X', targetCompanyId: '', targetUid: '', metadata: {}, appBuild: 'test',
      createdAt: Timestamp.fromMillis(Date.now() - 86400000),
    }));
    await assertFails(updateDoc(doc(db, 'platformAuditLogs', 'log-1'), { action: 'REWRITTEN' }));
    await assertFails(deleteDoc(doc(db, 'platformAuditLogs', 'log-1')));
  });
});

describe('8. nobody signed in gets nothing', () => {
  it('every business collection is closed', async () => {
    const db = asNobody();
    await assertFails(getDoc(doc(db, 'companies', UID_A)));
    await assertFails(getDoc(doc(db, 'companies', UID_A, 'customers', 'cust-a')));
    await assertFails(getDoc(doc(db, 'subscriptions', COMPANY_A)));
    await assertFails(getDoc(doc(db, 'platformSettings', 'DEFAULT')));
    await assertFails(getDoc(doc(db, 'counters', 'company_registration')));
    await assertFails(getDoc(doc(db, 'kycSubmissions', COMPANY_A)));
    await assertFails(getDoc(doc(db, 'platformAdmins', UID_ADMIN)));
    await assertFails(setDoc(doc(db, 'companies', 'anyone'), companyDoc('x', 'x')));
  });

  it('except one signature request by its token, which can be signed once', async () => {
    const db = asNobody();
    const ref = doc(db, 'signatureRequests', 'token-a-1234567890abcdefghijklmnop');
    await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(ref, { ownerUid: 'thief' }));
    await assertFails(updateDoc(ref, { status: 'SIGNED', signature: 'data', signerName: 'R', signedAt: serverTimestamp(), companyId: 'x' }));
    await assertSucceeds(updateDoc(ref, { status: 'SIGNED', signature: 'data:image/png;base64,AAA', signerName: 'Rajesh', signedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: 'SIGNED', signature: 'again', signerName: 'Rajesh', signedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
  });
});

describe('the App ID counter and KYC follow the app', () => {
  it('the counter moves by exactly one, forward, and is never deleted', async () => {
    const db = asA();
    const ref = doc(db, 'counters', 'company_registration');
    await assertSucceeds(runTransaction(db, async (txn) => {
      const snapshot = await txn.get(ref);
      txn.set(ref, { lastAssigned: snapshot.data().lastAssigned + 1, updatedAt: serverTimestamp() });
    }));
    await assertFails(setDoc(ref, { lastAssigned: 9999, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref, { lastAssigned: 4000, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
  });

  it('a company submits its own KYC as pending and cannot approve itself', async () => {
    const db = asB();
    await assertFails(setDoc(doc(db, 'kycSubmissions', COMPANY_B), { companyId: COMPANY_B, ownerUid: UID_B, status: 'APPROVED' }));
    await assertFails(setDoc(doc(db, 'kycSubmissions', COMPANY_B), { companyId: COMPANY_B, ownerUid: UID_A, status: 'PENDING' }));
    await assertSucceeds(setDoc(doc(db, 'kycSubmissions', COMPANY_B), { companyId: COMPANY_B, ownerUid: UID_B, status: 'PENDING' }));
    await assertFails(updateDoc(doc(asA(), 'kycSubmissions', COMPANY_A), { status: 'APPROVED' }));
    await assertSucceeds(updateDoc(doc(asA(), 'kycSubmissions', COMPANY_A), { status: 'PENDING', panBase64: 'new' }));
  });

  it('a signature request is created by its company for itself, pending, with a future expiry', async () => {
    const db = asA();
    const fresh = doc(db, 'signatureRequests', 'token-a-2234567890abcdefghijklmnop');
    const request = {
      companyId: COMPANY_A, ownerUid: UID_A, status: 'PENDING', documentType: 'bill',
      createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 86400000),
    };
    await assertFails(setDoc(fresh, { ...request, ownerUid: UID_B }));
    await assertFails(setDoc(fresh, { ...request, status: 'SIGNED' }));
    await assertFails(setDoc(fresh, { ...request, expiresAt: Timestamp.fromMillis(Date.now() - 1000) }));
    await assertSucceeds(setDoc(fresh, request));
    await assertSucceeds(deleteDoc(fresh));
  });
});
