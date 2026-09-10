import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * Blueprint §38–§40 and billing-engine.md §1: every charge on an invoice
 * traces back to an operational record. The storage accrual is rebuilt
 * day by day from the ledger, handling charges come from the events that
 * actually happened, and the GST split is decided once, at invoice
 * creation, from the two state codes.
 */
describe('Billing runs and invoices', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let billingExec = '';
  let accountant = '';
  let operator = '';
  let otherOwner = '';
  let tenantId = '';
  let warehouseId = '';
  let binId = '';
  let riceId = '';
  let gheeId = '';
  let acme = '';   // intra-state (same state as the company)
  let bolt = '';   // inter-state
  let cinder = ''; // inter-state, holds only the unpriced SKU
  let storageChargeTypeId = '';
  let inwardHandlingChargeTypeId = '';
  let documentationChargeTypeId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const stockUp = async (customerId: string, productId: string, quantity: number) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: binId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
    return grn.body;
  };

  /**
   * Nine days of history, made by moving what exists back rather than by
   * faking rows: the accrual reads `stock_ledger.txn_at` and the handling
   * charges read the documents' own completion timestamps, so all three
   * have to move together or the two halves of the bill disagree.
   */
  const backdate = async (days: number) => {
    await withTenant(sql, tenantId, async (tx) => {
      await tx`update stock_ledger set txn_at = txn_at - ${`${days} days`}::interval where tenant_id = ${tenantId}`;
      await tx`update grns set approved_at = approved_at - ${`${days} days`}::interval, grn_date = grn_date - ${`${days} days`}::interval where tenant_id = ${tenantId}`;
      await tx`update putaways set completed_at = completed_at - ${`${days} days`}::interval where tenant_id = ${tenantId}`;
    });
  };

  const runFor = (customerId: string, extra: Record<string, unknown> = {}) =>
    api().post('/billing-runs').set(auth(billingExec)).send({ customerId, periodStart: day(-9), periodEnd: day(0), ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Invoicing Ltd', tenantSlug: `inv-a-${suffix}`, email: `owner-a-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    otherOwner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Other Ltd', tenantSlug: `inv-b-${suffix}`, email: `owner-b-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;

    for (const [role, target] of [['billing_executive', 'be'], ['accountant', 'acc'], ['warehouse_operator', 'op']] as const) {
      const email = `${target}-${suffix}@test.local`;
      await api().post('/users').set(auth(owner)).send({ email, fullName: role, password, roleCode: role }).expect(201);
      const token = (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken;
      if (target === 'be') billingExec = token;
      else if (target === 'acc') accountant = token;
      else operator = token;
    }

    // The company's own GST registration: the invoice's tax treatment is this against the customer's.
    await api().patch('/company').set(auth(owner)).send({ stateCode: '06', gstin: '06AABCU9603R1ZM', bankName: 'HDFC Bank', bankAccountNo: '5010001234567', bankIfsc: 'HDFC0000123' }).expect(200);

    acme = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co', legalName: 'Acme Consumer Goods Pvt Ltd', placeOfSupply: '06', creditDays: 15 }).expect(201)).body.id;
    bolt = (await api().post('/customers').set(auth(owner)).send({ name: 'Bolt Ltd', placeOfSupply: '27', creditDays: 30 }).expect(201)).body.id;
    cinder = (await api().post('/customers').set(auth(owner)).send({ name: 'Cinder Foods', placeOfSupply: '27' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: 'A' }).expect(201);
    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: zone.body.id }).expect(201);
    binId = (await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: 'B01', parentId: rack.body.id }).expect(201)).body.id;
    riceId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;
    gheeId = (await api().post('/products').set(auth(owner)).send({ sku: 'GHEE-1', name: 'Ghee 1L', uomCode: 'BOX' }).expect(201)).body.id;

    const chargeTypes = (await api().get('/charge-types').set(auth(owner)).expect(200)).body as { id: string; code: string }[];
    storageChargeTypeId = chargeTypes.find((c) => c.code === 'STORAGE')!.id;
    inwardHandlingChargeTypeId = chargeTypes.find((c) => c.code === 'INWARD_HANDLING')!.id;
    documentationChargeTypeId = chargeTypes.find((c) => c.code === 'DOCUMENTATION')!.id;

    // One company-scope card. Storage is priced per SKU deliberately: ghee has
    // no line anywhere, which is what the "no applicable rate" case needs.
    const card = await api().post('/rate-cards').set(auth(owner)).send({ code: 'STD', name: 'Standard', scope: 'company', validFrom: day(-365), status: 'active' }).expect(201);
    await api().post(`/rate-cards/${card.body.id}/lines`).set(auth(owner)).send({ chargeTypeId: storageChargeTypeId, basis: 'unit_day', rate: 2, freeDays: 2, productId: riceId }).expect(201);
    await api().post(`/rate-cards/${card.body.id}/lines`).set(auth(owner)).send({ chargeTypeId: inwardHandlingChargeTypeId, basis: 'per_unit', rate: 1 }).expect(201);

    await stockUp(acme, riceId, 100);
    await stockUp(bolt, riceId, 50);
    await stockUp(cinder, gheeId, 20);
    await backdate(9);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accrues storage day by day from the ledger, adds the handling event, and keeps the whole formula', async () => {
    const run = await runFor(acme).expect(201);
    expect(run.body.status).toBe('previewed');
    expect(run.body.hasErrors).toBe(false);

    // 100 bags landed 9 days ago; 2 free days, so 8 of the period's 10 days
    // are chargeable: 800 unit-days at 2.00.
    const storage = run.body.lines.find((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'STORAGE');
    expect(storage).toMatchObject({ basis: 'unit_day', quantity: 800, days: 8, rate: 2, computedAmount: 1600, sourceType: 'stock_lot' });
    expect(storage.description).toMatch(/Storage RICE-25: 800 unit-days over 8 day\(s\)/);
    // §66: the preview renders from the stored calculation, it does not recompute.
    const trace = run.body.calculation.storage[0];
    expect(trace).toMatchObject({ sku: 'RICE-25', freeDays: 2, unitDays: 800, chargeableDays: 8 });
    expect(trace.daily).toHaveLength(10);
    expect(trace.daily.filter((d: { chargeable: boolean }) => d.chargeable)).toHaveLength(8);
    expect(trace.daily.every((d: { qty: number }) => d.qty === 100)).toBe(true);

    const handling = run.body.lines.find((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'INWARD_HANDLING');
    expect(handling).toMatchObject({ basis: 'per_unit', quantity: 100, rate: 1, computedAmount: 100, sourceType: 'grn' });
    expect(run.body.subtotal).toBe(1700);
    // UNLOADING also triggers on grn_approved but has no rate anywhere: shown, not billed, not blocking.
    expect(run.body.calculation.unpriced).toContain('UNLOADING');
    expect(run.body.lines.some((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'UNLOADING')).toBe(false);
  });

  it('replaces the previous preview rather than stacking a second one, and takes manual lines', async () => {
    const first = await runFor(acme).expect(201);
    const second = await runFor(acme, {
      manualLines: [{ chargeTypeId: documentationChargeTypeId, description: 'E-way bill filing', quantity: 2, rate: 150 }],
    }).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.subtotal).toBe(2000);
    expect(second.body.calculation.manual[0]).toMatchObject({ chargeTypeCode: 'DOCUMENTATION', quantity: 2, rate: 150, amount: 300 });
    const live = await api().get(`/billing-runs?customerId=${acme}`).set(auth(billingExec)).expect(200);
    expect(live.body.total).toBe(1);
    await api().get(`/billing-runs/${first.body.id}`).set(auth(billingExec)).expect(404);

    // A preview can be thrown away without invoicing it.
    await api().post(`/billing-runs/${second.body.id}/discard`).set(auth(billingExec)).expect(201);
    expect((await api().get(`/billing-runs/${second.body.id}`).set(auth(billingExec)).expect(200)).body.status).toBe('discarded');
    await api().post(`/billing-runs/${second.body.id}/discard`).set(auth(billingExec)).expect(400);
    await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: second.body.id }).expect(400);
  });

  it('refuses to invoice a run whose stock has no rate, and names the SKU', async () => {
    const run = await runFor(cinder).expect(201);
    expect(run.body.hasErrors).toBe(true);
    expect(run.body.calculation.errors[0]).toMatch(/No storage rate for GHEE-1/);
    // The handling line still priced (its rate card line is general), so the
    // refusal is about the *missing* rate, not about there being nothing to bill.
    expect(run.body.subtotal).toBe(20);
    expect(run.body.lines.map((l: { chargeTypeCode: string }) => l.chargeTypeCode)).toEqual(['INWARD_HANDLING']);
    const refused = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: run.body.id }).expect(400);
    expect(refused.body.message).toMatch(/unresolved rate error/);
  });

  it('invoices the run once, splits CGST+SGST in-state, and walks draft → issued', async () => {
    const run = await runFor(acme).expect(201);
    const invoice = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: run.body.id, invoiceDate: day(0) }).expect(201);
    expect(invoice.body.number).toMatch(/^INV\//);
    expect(invoice.body).toMatchObject({ status: 'draft', taxTreatment: 'intra_state', placeOfSupply: '06', subtotal: 1700 });
    // 18% on 1700 = 306, halved into CGST and SGST because both parties are in state 06.
    expect(invoice.body).toMatchObject({ cgstAmount: 153, sgstAmount: 153, igstAmount: 0, grandTotal: 2006, amountPaid: 0, balanceDue: 2006 });
    expect(invoice.body.dueDate).toBe(day(15)); // 15 credit days
    expect(invoice.body.customerSnapshot).toMatchObject({ legal_name: 'Acme Consumer Goods Pvt Ltd', place_of_supply: '06' });
    expect(invoice.body.companySnapshot).toMatchObject({ state_code: '06', gstin: '06AABCU9603R1ZM' });
    expect(invoice.body.lines).toHaveLength(2);
    expect(invoice.body.lines[0]).toMatchObject({ lineNo: 1, description: expect.stringContaining('Storage RICE-25'), taxRatePct: 18, amount: 1600, cgstAmount: 144, sgstAmount: 144, igstAmount: 0, lineTotal: 1888 });

    // §79 "prevent duplicate invoice posting": the run is spent.
    expect((await api().get(`/billing-runs/${run.body.id}`).set(auth(billingExec)).expect(200)).body).toMatchObject({ status: 'invoiced', invoiceNumber: invoice.body.number });
    const twice = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: run.body.id }).expect(400);
    expect(twice.body.message).toMatch(/cannot be invoiced again/);
    // And the period cannot quietly be re-previewed to make a second bill for it.
    const rerun = await runFor(acme).expect(400);
    expect(rerun.body.message).toMatch(/already invoiced/);

    // draft → pending_approval → approved → issued, with approval above the Billing Executive.
    await api().post(`/invoices/${invoice.body.id}/approve`).set(auth(accountant)).expect(400); // not submitted yet
    expect((await api().post(`/invoices/${invoice.body.id}/submit`).set(auth(billingExec)).expect(201)).body.status).toBe('pending_approval');
    await api().post(`/invoices/${invoice.body.id}/approve`).set(auth(billingExec)).expect(403);
    expect((await api().post(`/invoices/${invoice.body.id}/approve`).set(auth(accountant)).expect(201)).body.status).toBe('approved');
    expect((await api().post(`/invoices/${invoice.body.id}/issue`).set(auth(accountant)).expect(201)).body.status).toBe('issued');
    // Issued is the end of the line for editing: only payments and notes move it now.
    await api().post(`/invoices/${invoice.body.id}/cancel`).set(auth(billingExec)).send({ reason: 'too late' }).expect(400);

    // The Tax Invoice, and the entitlement-metered document engine behind it.
    const preview = await api().post(`/invoices/${invoice.body.id}/document/preview`).set(auth(billingExec)).expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');
    const committed = await api().post(`/invoices/${invoice.body.id}/document`).set(auth(billingExec)).send({}).expect(201);
    expect(committed.body).toMatchObject({ documentType: 'invoice', versionNo: 1, documentNumber: invoice.body.number });
    expect((await api().get(`/verify/${committed.body.qrToken}`).expect(200)).body.result).toBe('valid');
  });

  it('charges IGST out of state, and leaves an already-billed event off the next run', async () => {
    const run = await runFor(bolt).expect(201);
    expect(run.body.subtotal).toBe(850); // 50 bags × 8 days × 2, plus 50 × 1 handling
    const invoice = await api().post('/invoices').set(auth(accountant)).send({ billingRunId: run.body.id }).expect(201);
    expect(invoice.body).toMatchObject({ taxTreatment: 'inter_state', placeOfSupply: '27', cgstAmount: 0, sgstAmount: 0, igstAmount: 153 });
    expect(invoice.body.grandTotal).toBe(1003);
    expect(invoice.body.lines.every((l: { cgstAmount: number; igstAmount: number }) => l.cgstAmount === 0 && l.igstAmount > 0)).toBe(true);

    // A later period must not bill that GRN's handling a second time.
    const next = await api().post('/billing-runs').set(auth(billingExec)).send({ customerId: bolt, periodStart: day(-9), periodEnd: day(1) }).expect(201);
    expect(next.body.calculation.alreadyBilled.some((s: string) => s.startsWith('INWARD_HANDLING'))).toBe(true);
    expect(next.body.lines.some((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'INWARD_HANDLING')).toBe(false);
    expect(next.body.lines.some((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'STORAGE')).toBe(true);
    await api().post(`/billing-runs/${next.body.id}/discard`).set(auth(billingExec)).expect(201);
  });

  it('cancels a draft invoice and hands the billing run back', async () => {
    const run = await api().post('/billing-runs').set(auth(billingExec)).send({ customerId: acme, periodStart: day(-3), periodEnd: day(0) }).expect(201);
    const invoice = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: run.body.id }).expect(201);
    const cancelled = await api().post(`/invoices/${invoice.body.id}/cancel`).set(auth(billingExec)).send({ reason: 'Wrong period' }).expect(201);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancellationReason: 'Wrong period' });
    const freed = await api().get(`/billing-runs/${run.body.id}`).set(auth(billingExec)).expect(200);
    expect(freed.body).toMatchObject({ status: 'previewed', invoiceId: null });
    // Which means the corrected invoice can be raised from the same run.
    const again = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: run.body.id }).expect(201);
    expect(again.body.status).toBe('draft');
    expect(again.body.number).not.toBe(invoice.body.number);
    await api().post(`/invoices/${again.body.id}/cancel`).set(auth(billingExec)).send({ reason: 'cleanup' }).expect(201);
  });

  it('keeps billing off the warehouse floor, filters, and isolates tenants', async () => {
    await api().post('/billing-runs').set(auth(operator)).send({ customerId: acme, periodStart: day(-9), periodEnd: day(0) }).expect(403);
    await api().get('/invoices').set(auth(operator)).expect(403);

    const issued = await api().get('/invoices?status=issued').set(auth(billingExec)).expect(200);
    expect(issued.body.total).toBe(1);
    expect((await api().get(`/invoices?customerId=${bolt}`).set(auth(billingExec)).expect(200)).body.total).toBe(1);
    expect((await api().get('/invoices?q=Acme').set(auth(billingExec)).expect(200)).body.total).toBeGreaterThan(0);
    expect((await api().get(`/invoices?from=${day(-30)}&to=${day(-20)}`).set(auth(billingExec)).expect(200)).body.total).toBe(0);
    expect((await api().get('/billing-runs?status=invoiced').set(auth(billingExec)).expect(200)).body.total).toBe(2);

    expect((await api().get('/invoices').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    expect((await api().get('/billing-runs').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().post('/billing-runs').set(auth(otherOwner)).send({ customerId: acme, periodStart: day(-9), periodEnd: day(0) }).expect(404);
    await api().get('/invoices').expect(401);
  });
});
