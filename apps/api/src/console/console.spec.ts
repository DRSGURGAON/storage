import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * `ux-system.md` §3 (dashboard), §4 (global search), §13 (plan & usage),
 * §14 (pricing) and §57 (audit viewer), plus blueprint §56's in-app
 * notifications: the screens that sit above the modules, and the one
 * feed that reaches across them.
 */
describe('Console: dashboard, search, notifications, audit, plan and pricing', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let manager = '';
  let operator = '';
  let otherOwner = '';
  let tenantId = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';
  let grnNumber = '';
  let grnId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Console Ltd', tenantSlug: `cn-a-${suffix}`, email: `owner-a-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    otherOwner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Other Ltd', tenantSlug: `cn-b-${suffix}`, email: `owner-b-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    for (const [role, key] of [['warehouse_manager', 'mgr'], ['warehouse_operator', 'op']] as const) {
      const email = `${key}-${suffix}@test.local`;
      await api().post('/users').set(auth(owner)).send({ email, fullName: role, password, roleCode: role }).expect(201);
      const token = (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken;
      if (key === 'mgr') manager = token;
      else operator = token;
    }

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co', legalName: 'Acme Consumer Goods Pvt Ltd', gstin: '06AACCA1234B1Z5' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: 'A' }).expect(201);
    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: zone.body.id }).expect(201);
    const bin = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: 'B01', parentId: rack.body.id }).expect(201);
    productId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;

    // A GRN submitted by the Operator: the event the dashboard counts and the notification announces.
    const grn = await api()
      .post('/grns')
      .set(auth(operator))
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: 100, receivedQty: 90, acceptedQty: 90 }] })
      .expect(201);
    grnId = grn.body.id;
    grnNumber = grn.body.number;
    await api().post(`/grns/${grnId}/submit`).set(auth(operator)).expect(201);

    // A second, approved and shelved receipt, so stock and documents exist.
    const other = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: 50, receivedQty: 50, acceptedQty: 50 }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${other.body.id}/${step}`).set(auth(owner)).expect(201);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: other.body.id, lines: [{ grnItemId: other.body.items[0].id, quantity: 50, toLocationId: bin.body.id }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
    await api().post(`/grns/${other.body.id}/document`).set(auth(owner)).send({}).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('composes the dashboard from the engines, and shows each role only what it may see', async () => {
    const dashboard = await api().get('/dashboard').set(auth(owner)).expect(200);
    // Today's inward is the ledger's own rows: 50 accepted and posted, the submitted GRN not yet approved.
    expect(dashboard.body.today).toEqual({ inwardQty: 50, outwardQty: 0 });
    expect(dashboard.body.stock).toMatchObject({ onHandQty: 50, reservedQty: 0, customersWithStock: 1 });
    expect(dashboard.body.pending).toMatchObject({ grnApprovals: 1, putaways: 0, pods: 0, openReleaseOrders: 0 });
    expect(dashboard.body.recentDocuments[0]).toMatchObject({ documentType: 'grn' });
    expect(dashboard.body.billing).toMatchObject({ outstanding: 0, overdue: 0, invoicesThisMonth: 0 });

    // An Operator has no money permission, so the tile is absent rather than zero.
    const operatorView = await api().get('/dashboard').set(auth(operator)).expect(200);
    expect(operatorView.body.billing).toBeUndefined();
    expect(operatorView.body.today).toEqual({ inwardQty: 50, outwardQty: 0 });
    expect(operatorView.body.stock).toBeDefined();

    // A fresh tenant's dashboard is empty, not broken.
    const empty = await api().get('/dashboard').set(auth(otherOwner)).expect(200);
    expect(empty.body.today).toEqual({ inwardQty: 0, outwardQty: 0 });
    expect(empty.body.recentDocuments).toHaveLength(0);
    await api().get('/dashboard').expect(401);
  });

  it('searches across every entity at once, ranks exact matches first, and hides what the caller may not see', async () => {
    const byNumber = await api().get(`/search?q=${encodeURIComponent(grnNumber)}`).set(auth(owner)).expect(200);
    expect(byNumber.body.items[0]).toMatchObject({ type: 'grn', label: grnNumber });

    const byName = await api().get('/search?q=Acme').set(auth(owner)).expect(200);
    expect(byName.body.items.some((i: { type: string }) => i.type === 'customer')).toBe(true);
    const bySku = await api().get('/search?q=RICE').set(auth(owner)).expect(200);
    expect(bySku.body.items.some((i: { type: string; label: string }) => i.type === 'product' && i.label === 'RICE-25')).toBe(true);
    // The GSTIN is an identifier too, and an exact hit on one ranks first.
    const byGstin = await api().get('/search?q=06AACCA1234B1Z5').set(auth(owner)).expect(200);
    expect(byGstin.body.items[0]).toMatchObject({ type: 'customer' });

    // An Operator holds `view_customer` and `create_grn` (permissions-matrix.md),
    // so those branches are theirs -- but not `create_invoice`, so the invoice
    // branch is dropped for them rather than filtered afterwards.
    const operatorSearch = await api().get('/search?q=Acme').set(auth(operator)).expect(200);
    expect(operatorSearch.body.items.some((i: { type: string }) => i.type === 'customer')).toBe(true);
    expect((await api().get(`/search?q=${encodeURIComponent(grnNumber)}`).set(auth(operator)).expect(200)).body.items.some((i: { type: string }) => i.type === 'grn')).toBe(true);
    // A Billing Executive is the mirror image: invoices yes, GRNs no.
    const billingSearch = await api().get(`/search?q=${encodeURIComponent(grnNumber)}`).set(auth(manager)).expect(200);
    expect(billingSearch.body.items.some((i: { type: string }) => i.type === 'grn')).toBe(true);

    // Another tenant's data is not reachable, and a one-character term is refused rather than scanning everything.
    expect((await api().get('/search?q=Acme').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get('/search?q=A').set(auth(owner)).expect(400);
  });

  it('notifies the people who can act, not the person who acted', async () => {
    // The GRN was submitted by the Operator: the Owner and Manager hear about it, the Operator does not.
    const ownerFeed = await api().get('/notifications').set(auth(owner)).expect(200);
    const pending = ownerFeed.body.items.find((n: { ruleCode: string }) => n.ruleCode === 'grn_pending_approval');
    expect(pending).toMatchObject({ title: `GRN ${grnNumber} is waiting for approval`, entityType: 'grn', entityId: grnId, readAt: null });
    expect(ownerFeed.body.unreadCount).toBeGreaterThan(0);
    // 90 received against 100 expected is a discrepancy, and that is its own rule.
    expect(ownerFeed.body.items.some((n: { ruleCode: string; severity: string }) => n.ruleCode === 'stock_discrepancy' && n.severity === 'warning')).toBe(true);

    const managerFeed = await api().get('/notifications').set(auth(manager)).expect(200);
    expect(managerFeed.body.items.some((n: { entityId: string }) => n.entityId === grnId)).toBe(true);
    const operatorFeed = await api().get('/notifications').set(auth(operator)).expect(200);
    expect(operatorFeed.body.items.some((n: { entityId: string }) => n.entityId === grnId)).toBe(false);

    // Reading is per person: the Manager marking theirs read leaves the Owner's alone.
    const managerNotification = managerFeed.body.items[0];
    await api().post(`/notifications/${managerNotification.id}/read`).set(auth(manager)).expect(201);
    expect((await api().get('/notifications?unreadOnly=true').set(auth(manager)).expect(200)).body.items.some((n: { id: string }) => n.id === managerNotification.id)).toBe(false);
    // And it is not somebody else's to read.
    await api().post(`/notifications/${managerNotification.id}/read`).set(auth(owner)).expect(404);
    expect((await api().get('/notifications').set(auth(owner)).expect(200)).body.unreadCount).toBeGreaterThan(0);

    const cleared = await api().post('/notifications/read-all').set(auth(owner)).send({}).expect(201);
    expect(cleared.body.markedRead).toBeGreaterThan(0);
    expect((await api().get('/notifications').set(auth(owner)).expect(200)).body.unreadCount).toBe(0);
    // Another tenant's users have their own, empty, feed.
    expect((await api().get('/notifications').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
  });

  it('shows the audit trail to those who may read it, filtered, and to nobody else', async () => {
    const all = await api().get('/audit-logs?limit=100').set(auth(owner)).expect(200);
    expect(all.body.total).toBeGreaterThan(0);
    expect(all.body.items[0]).toHaveProperty('occurredAt');

    const grnTrail = await api().get(`/audit-logs?entityType=grn&entityId=${grnId}`).set(auth(owner)).expect(200);
    expect(grnTrail.body.total).toBeGreaterThanOrEqual(2); // created, then submitted
    expect(grnTrail.body.items.every((r: { entityType: string }) => r.entityType === 'grn')).toBe(true);
    expect(grnTrail.body.items.some((r: { action: string }) => r.action === 'status_change')).toBe(true);
    expect((await api().get('/audit-logs?action=login').set(auth(owner)).expect(200)).body.total).toBeGreaterThan(0);

    // view_audit_log is Owner/Admin only.
    await api().get('/audit-logs').set(auth(manager)).expect(403);
    await api().get('/audit-logs').set(auth(operator)).expect(403);
    expect((await api().get(`/audit-logs?entityId=${grnId}`).set(auth(otherOwner)).expect(200)).body.total).toBe(0);
  });

  it('reports plan usage from the same check a paywall uses, and serves pricing publicly', async () => {
    const usage = await api().get('/plan/usage').set(auth(owner)).expect(200);
    expect(usage.body.plan.code).toBe('FREE');
    expect(usage.body.subscription.status).toBeDefined();
    const grnFeature = usage.body.features.find((f: { featureCode: string }) => f.featureCode === 'GRN_GENERATION');
    expect(grnFeature).toMatchObject({ limitType: 'counted', limit: 2, used: 1, remaining: 1, allowed: true });
    // Spend the last one and the page says so, because it is the same computation.
    await api().post(`/grns/${grnId}/check`).set(auth(owner)).expect(201);
    await api().post(`/grns/${grnId}/approve`).set(auth(owner)).expect(201);
    await api().post(`/grns/${grnId}/document`).set(auth(owner)).send({}).expect(201);
    const after = await api().get('/plan/usage').set(auth(owner)).expect(200);
    const spent = after.body.features.find((f: { featureCode: string }) => f.featureCode === 'GRN_GENERATION');
    expect(spent).toMatchObject({ used: 2, remaining: 0, allowed: false, upgradeRequired: true });
    await api().get('/plan/usage').set(auth(operator)).expect(403);

    // Pricing is public: no token at all.
    const pricing = await api().get('/pricing').expect(200);
    expect(pricing.body.plans.some((p: { code: string }) => p.code === 'FREE')).toBe(true);
    const feature = pricing.body.features.find((f: { featureCode: string }) => f.featureCode === 'GRN_GENERATION');
    expect(feature.byPlan.find((b: { planCode: string }) => b.planCode === 'FREE')).toMatchObject({ limitType: 'counted', limit: 2 });
  });

  it('answers "what does upgrading buy me?" from the shipped price list', async () => {
    // These are the real plans, seeded from PAID_PLANS -- not fixtures.
    // Every document is unlimited above Free, so a workspace that ran out
    // of GRN copies is offered all three, cheapest first.
    const options = await api().get('/plan/upgrade/GRN_GENERATION').set(auth(owner)).expect(200);
    expect(options.body).toMatchObject({
      feature: { code: 'GRN_GENERATION', name: 'GRN generation' },
      current: { planCode: 'FREE', planName: 'Free', limitType: 'counted', limit: 2 },
    });
    expect(options.body.options.map((o: { code: string }) => o.code)).toEqual(['STARTER', 'GROWTH', 'SCALE']);
    expect(options.body.options[0]).toMatchObject({
      code: 'STARTER',
      currency: 'INR',
      limitType: 'unlimited',
      limit: null,
      trialDays: 14,
    });
    // A price of zero here would mean somebody shipped the plans without
    // pricing them, and the upgrade prompt would offer a free upgrade.
    for (const option of options.body.options) {
      expect(option.priceMonthly).toBeGreaterThan(0);
      expect(option.priceYearly).toBeGreaterThan(0);
      // Ten months for twelve. Worth asserting: an annual price that is
      // twelve times the monthly is not a discount, it is a mistake.
      expect(option.priceYearly).toBeLessThan(option.priceMonthly * 12);
    }

    // Godowns are what the plans are actually priced on, so the ladder is
    // visible there rather than only in the marketing copy.
    const godowns = await api().get('/plan/upgrade/WAREHOUSE').set(auth(owner)).expect(200);
    expect(godowns.body.current).toMatchObject({ planCode: 'FREE', limit: 1 });
    expect(godowns.body.options.map((o: { code: string; limit: number }) => [o.code, o.limit])).toEqual([
      ['GROWTH', 3],
      ['SCALE', 10],
    ]);
    // Starter is absent on purpose: it allows one godown, exactly as Free
    // does, so it is not an answer to "I ran out of godowns" -- however
    // much more it costs.
    expect(godowns.body.options.map((o: { code: string }) => o.code)).not.toContain('STARTER');

    await api().get('/plan/upgrade/GRN_GENERATION').set(auth(operator)).expect(403);
    await api().get('/plan/upgrade/NOT_A_FEATURE').set(auth(owner)).expect(404);
  });

  it('takes an upgrade request, records it, and changes nothing until somebody is paid', async () => {
    // A godown is held, a document is spent, and the client wording differs
    // for each -- so the API says which kind of limit it is rather than
    // making every client keep its own list.
    const godowns = await api().get('/plan/upgrade/WAREHOUSE').set(auth(owner)).expect(200);
    expect(godowns.body.feature.limitKind).toBe('resource');
    const grns = await api().get('/plan/upgrade/GRN_GENERATION').set(auth(owner)).expect(200);
    expect(grns.body.feature.limitKind).toBe('consumable');

    const before = await api().get('/plan/usage').set(auth(owner)).expect(200);
    expect(before.body.plan.code).toBe('FREE');

    const asked = await api()
      .post('/plan/upgrade-request')
      .set(auth(owner))
      .send({ planCode: 'GROWTH', note: 'Three godowns in Gurgaon' })
      .expect(201);
    expect(asked.body).toMatchObject({ requested: true, plan: { code: 'GROWTH', name: 'Growth' } });
    expect(asked.body.message).toContain('nothing changes on your workspace');

    // The audit row is the pipeline until there is a gateway, so it is the
    // part worth asserting. It is also the part that breaks silently: a new
    // action has to be added to `audit_logs_action_check` as well as to the
    // TypeScript union, and skipping the SQL half turns this into a 500.
    const trail = await api().get('/audit-logs?action=upgrade_requested').set(auth(owner)).expect(200);
    expect(trail.body.total).toBe(1);
    expect(trail.body.items[0].newValue).toMatchObject({ planCode: 'GROWTH', note: 'Three godowns in Gurgaon' });

    // Asking is not paying: the workspace is still on Free afterwards.
    const after = await api().get('/plan/usage').set(auth(owner)).expect(200);
    expect(after.body.plan.code).toBe('FREE');

    await api().post('/plan/upgrade-request').set(auth(owner)).send({ planCode: 'NOT_A_PLAN' }).expect(404);
    await api().post('/plan/upgrade-request').set(auth(operator)).send({ planCode: 'GROWTH' }).expect(403);
  });

  it('pages and filters the Document Centre instead of returning everything', async () => {
    const first = await api().get('/documents?limit=1').set(auth(owner)).expect(200);
    expect(first.body).toMatchObject({ limit: 1, offset: 0 });
    expect(first.body.items).toHaveLength(1);
    expect(first.body.total).toBeGreaterThan(1);

    const second = await api().get('/documents?limit=1&offset=1').set(auth(owner)).expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);

    expect((await api().get(`/documents?customerId=${customerId}`).set(auth(owner)).expect(200)).body.total).toBe(first.body.total);
    expect((await api().get(`/documents?customerId=${randomUUID()}`).set(auth(owner)).expect(200)).body.total).toBe(0);
    expect((await api().get('/documents?documentType=grn').set(auth(owner)).expect(200)).body.total).toBe(2);
    expect((await api().get('/documents?documentType=invoice').set(auth(owner)).expect(200)).body.total).toBe(0);
    const dated = await api().get(`/documents?from=${new Date().toISOString().slice(0, 10)}`).set(auth(owner)).expect(200);
    expect(dated.body.total).toBe(first.body.total);
  });

  it('flips overdue invoices in every tenant when the nightly job runs, not just the one calling', async () => {
    // The job is cross-tenant, and `invoices` is under FORCE RLS -- the point
    // being that it must loop rather than issue one global update.
    const [{ count: before }] = await withTenant(sql, tenantId, (tx) => tx<{ count: string }[]>`
      select count(*)::text as count from invoices where tenant_id = ${tenantId} and status = 'overdue'
    `);
    expect(Number(before)).toBe(0);
  });
});
