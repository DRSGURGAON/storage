import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { putOnPlan } from '../testing/subscription';
import { withTenant } from '../db/tenant-context';

/**
 * Blueprint §78's acceptance scenario, walked once, end to end, through
 * the HTTP API — receive goods, shelve them, ship some, prove delivery,
 * bill the customer, take the money — plus the rows of §79's critical-case
 * list that no single module's spec is the natural home for.
 *
 * The module specs prove each mechanism in isolation and in detail; this
 * one proves they compose. Where §79 is already covered elsewhere the row
 * is not repeated here — `test-plan.md` maps each row to its spec.
 */
describe('Acceptance: the §78 walkthrough and §79 cross-module cases', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let manager = '';
  let operator = '';
  let accountant = '';
  let tenantId = '';
  let customerId = '';
  let warehouseA = '';
  let warehouseB = '';
  let binA = '';
  let binB = '';
  let riceId = '';
  let gheeId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const bin = async (warehouseId: string, zone: string, code: string) => {
    const z = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: zone }).expect(201);
    const r = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: z.body.id }).expect(201);
    return (await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: code, parentId: r.body.id }).expect(201)).body.id as string;
  };
  const lots = async (productId: string) =>
    (await api().get(`/stock?productId=${productId}&limit=100`).set(auth(owner)).expect(200)).body.items as Record<string, string | null>[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Acceptance Warehousing Pvt Ltd', tenantSlug: `ac-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    // §78's walkthrough runs across two godowns, which is a paid feature:
    // plans are priced per godown and Free allows one. Signed up, then
    // upgraded -- the order a real customer does it in.
    await putOnPlan(sql, `ac-${suffix}`);
    for (const [role, key] of [['warehouse_manager', 'mgr'], ['warehouse_operator', 'op'], ['accountant', 'acc']] as const) {
      const email = `${key}-${suffix}@test.local`;
      await api().post('/users').set(auth(owner)).send({ email, fullName: role, password, roleCode: role }).expect(201);
      const token = (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken;
      if (key === 'mgr') manager = token;
      else if (key === 'op') operator = token;
      else accountant = token;
    }
    await api().patch('/company').set(auth(owner)).send({ stateCode: '06', gstin: '06AABCU9603R1ZM' }).expect(200);

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co', legalName: 'Acme Consumer Goods Pvt Ltd', placeOfSupply: '06', creditDays: 15 }).expect(201)).body.id;
    warehouseA = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    warehouseB = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH02', name: 'Bhiwandi' }).expect(201)).body.id;
    binA = await bin(warehouseA, 'A', 'B01');
    binB = await bin(warehouseB, 'D', 'B09');
    riceId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;
    gheeId = (await api().post('/products').set(auth(owner)).send({ sku: 'GHEE-1', name: 'Ghee 1L', uomCode: 'BOX', batchTracked: true }).expect(201)).body.id;

    const chargeTypes = (await api().get('/charge-types').set(auth(owner)).expect(200)).body as { id: string; code: string }[];
    const card = await api().post('/rate-cards').set(auth(owner)).send({ code: 'STD', name: 'Standard', scope: 'company', validFrom: day(-365), status: 'active' }).expect(201);
    await api().post(`/rate-cards/${card.body.id}/lines`).set(auth(owner)).send({ chargeTypeId: chargeTypes.find((c) => c.code === 'STORAGE')!.id, basis: 'unit_day', rate: 2 }).expect(201);
    await api().post(`/rate-cards/${card.body.id}/lines`).set(auth(owner)).send({ chargeTypeId: chargeTypes.find((c) => c.code === 'INWARD_HANDLING')!.id, basis: 'per_unit', rate: 1 }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks §78 end to end: gate entry → GRN → put-away → release → dispatch → POD → invoice → payment', async () => {
    // ---- Arrival ----------------------------------------------------------
    const gateEntry = await api()
      .post('/gate-entries')
      .set(auth(operator))
      .send({ warehouseId: warehouseA, direction: 'in', customerId, purpose: 'inward', vehicleNumber: 'HR26DK1234', driverName: 'Ram Singh' })
      .expect(201);
    expect(gateEntry.body.number).toMatch(/^GE\//);

    const inward = await api()
      .post('/inwards')
      .set(auth(operator))
      .send({ warehouseId: warehouseA, customerId, gateEntryId: gateEntry.body.id, items: [{ productId: riceId, expectedQty: 100, receivedQty: 100, acceptedQty: 100 }] })
      .expect(201);
    expect(inward.body.customerId).toBe(customerId); // auto-filled from the gate entry (§3)
    // A GRN comes from a *received* inward, not a draft one.
    await api().post(`/inwards/${inward.body.id}/receive`).set(auth(operator)).expect(201);

    // ---- Receipt: the Operator raises, the Manager signs off (§50) --------
    const grn = await api().post('/grns').set(auth(operator)).send({ inwardId: inward.body.id }).expect(201);
    expect(grn.body.items[0]).toMatchObject({ expectedQty: 100, receivedQty: 100, acceptedQty: 100 });
    await api().post(`/grns/${grn.body.id}/submit`).set(auth(operator)).expect(201);
    await api().post(`/grns/${grn.body.id}/approve`).set(auth(operator)).expect(403); // §79: no approve_grn, no approval
    await api().post(`/grns/${grn.body.id}/check`).set(auth(manager)).expect(201);
    await api().post(`/grns/${grn.body.id}/approve`).set(auth(manager)).expect(201);

    // §79: receive 100 → stock = 100, unallocated until put away.
    let stock = await lots(riceId);
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({ physicalQty: '100.000', locationId: null });

    // §79: editing an approved transaction is refused.
    await api().patch(`/grns/${grn.body.id}`).set(auth(manager)).send({ remarks: 'after the fact' }).expect(400);

    // ---- Shelving ---------------------------------------------------------
    const putaway = await api()
      .post('/putaways')
      .set(auth(operator))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity: 100, toLocationId: binA }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(operator)).expect(201);
    const receipt = await api().post('/warehouse-receipts').set(auth(manager)).send({ grnId: grn.body.id }).expect(201);
    expect(receipt.body.number).toMatch(/^WR\//);

    // ---- Release, pick, dispatch -----------------------------------------
    const order = await api()
      .post('/release-orders')
      .set(auth(manager))
      .send({ customerId, warehouseId: warehouseA, consigneeName: 'Acme Depot', lines: [{ productId: riceId, requestedQty: 40 }] })
      .expect(201);
    await api().post(`/release-orders/${order.body.id}/approve`).set(auth(manager)).expect(201);
    await api().post(`/release-orders/${order.body.id}/reserve`).set(auth(manager)).send({}).expect(201);

    // §79: reserve 40 → physical still 100, available 60.
    stock = await lots(riceId);
    expect(stock[0]).toMatchObject({ physicalQty: '100.000', reservedQty: '40.000', availableQty: '60.000' });

    const pick = await api().post('/pick-lists').set(auth(operator)).send({ releaseOrderId: order.body.id }).expect(201);
    await api().post(`/pick-lists/${pick.body.id}/confirm`).set(auth(operator)).send({ lines: [{ lineId: pick.body.lines[0].id, pickQty: 40 }] }).expect(201);
    await api().post(`/pick-lists/${pick.body.id}/complete`).set(auth(operator)).expect(201);

    const dispatch = await api().post('/dispatches').set(auth(operator)).send({ releaseOrderId: order.body.id, lrNumber: 'LR-5501' }).expect(201);
    const sheet = await api().post('/loading-sheets').set(auth(operator)).send({ dispatchId: dispatch.body.id, sealNumber: 'SEAL-11' }).expect(201);
    await api().post(`/loading-sheets/${sheet.body.id}/confirm`).set(auth(operator)).send({ lines: [{ lineId: sheet.body.lines[0].id, loaded: true }] }).expect(201);
    await api().post(`/loading-sheets/${sheet.body.id}/complete`).set(auth(operator)).expect(201);
    const pass = await api().post('/gate-passes').set(auth(operator)).send({ dispatchId: dispatch.body.id }).expect(201);
    await api().post(`/gate-passes/${pass.body.id}/gate-out`).set(auth(operator)).expect(201);

    // A gate pass is the one searchable record with no screen of its own --
    // it is read on its dispatch -- so the hit carries that dispatch, or it
    // is a result nobody can open (ux-system.md §4).
    const passHit = await api()
      .get(`/search?q=${encodeURIComponent(pass.body.number)}`)
      .set(auth(operator))
      .expect(200);
    expect(passHit.body.items[0]).toMatchObject({
      type: 'gate_pass',
      label: pass.body.number,
      parentId: dispatch.body.id,
    });
    const dispatchHit = await api()
      .get(`/search?q=${encodeURIComponent(dispatch.body.number)}`)
      .set(auth(operator))
      .expect(200);
    expect(dispatchHit.body.items[0]).toMatchObject({ type: 'dispatch', parentId: null });

    // §79: dispatch 40 → stock = 60, and the reservation left with the goods.
    stock = await lots(riceId);
    expect(stock[0]).toMatchObject({ physicalQty: '60.000', reservedQty: '0.000', availableQty: '60.000' });

    // ---- Proof of delivery ------------------------------------------------
    const pod = await api().post('/pods').set(auth(operator)).send({ dispatchId: dispatch.body.id }).expect(201);
    const delivered = await api()
      .post(`/pods/${pod.body.id}/capture`)
      .set(auth(operator))
      .send({ receiverName: 'R. Mehta', lines: [{ lineId: pod.body.lines[0].id, receivedQty: 40 }] })
      .expect(201);
    expect(delivered.body.status).toBe('delivered');
    expect((await api().get(`/release-orders/${order.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('completed');

    // ---- Billing ----------------------------------------------------------
    // Five days of history so the accrual has something to accrue over.
    await withTenant(sql, tenantId, async (tx) => {
      await tx`update stock_ledger set txn_at = txn_at - interval '5 days' where tenant_id = ${tenantId}`;
      await tx`update grns set approved_at = approved_at - interval '5 days' where tenant_id = ${tenantId}`;
    });
    const run = await api().post('/billing-runs').set(auth(accountant)).send({ customerId, periodStart: day(-5), periodEnd: day(0) }).expect(201);
    expect(run.body.hasErrors).toBe(false);
    expect(run.body.lines.some((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'STORAGE')).toBe(true);
    expect(run.body.lines.some((l: { chargeTypeCode: string }) => l.chargeTypeCode === 'INWARD_HANDLING')).toBe(true);

    const invoice = await api().post('/invoices').set(auth(accountant)).send({ billingRunId: run.body.id }).expect(201);
    expect(invoice.body).toMatchObject({ taxTreatment: 'intra_state', status: 'draft' });
    // §79: a retried "Create Invoice" makes one invoice, not two.
    await api().post('/invoices').set(auth(accountant)).send({ billingRunId: run.body.id }).expect(400);
    await api().post(`/invoices/${invoice.body.id}/submit`).set(auth(accountant)).expect(201);
    await api().post(`/invoices/${invoice.body.id}/approve`).set(auth(accountant)).expect(201);
    await api().post(`/invoices/${invoice.body.id}/issue`).set(auth(accountant)).expect(201);

    // ---- Payment ----------------------------------------------------------
    const half = Math.round(invoice.body.grandTotal / 2);
    await api()
      .post('/payments')
      .set(auth(accountant))
      .send({ idempotencyKey: `acc-${suffix}-1`, customerId, amount: half, paymentMode: 'neft', allocations: [{ invoiceId: invoice.body.id, amount: half }] })
      .expect(201);
    // §79: payment reduces balance_due.
    const partly = await api().get(`/invoices/${invoice.body.id}`).set(auth(accountant)).expect(200);
    expect(partly.body).toMatchObject({ status: 'partially_paid', amountPaid: half, balanceDue: invoice.body.grandTotal - half });

    const statement = await api().get(`/customer-statements/${customerId}`).set(auth(accountant)).expect(200);
    expect(statement.body.closingBalance).toBeCloseTo(invoice.body.grandTotal - half, 2);
    expect(statement.body.entries.map((e: { type: string }) => e.type)).toEqual(['invoice', 'payment']);

    // ---- The paper trail --------------------------------------------------
    const documents = await api().get('/documents?limit=100').set(auth(owner)).expect(200);
    const types = documents.body.items.map((d: { documentType: string }) => d.documentType);
    for (const expected of ['gate_entry', 'grn', 'warehouse_receipt', 'invoice']) {
      expect(types).not.toContain(expected); // nothing is generated implicitly...
    }
    for (const [path, type] of [
      [`/grns/${grn.body.id}`, 'grn'],
      [`/warehouse-receipts/${receipt.body.id}`, 'warehouse_receipt'],
      [`/dispatches/${dispatch.body.id}`, 'dispatch_note'],
      [`/invoices/${invoice.body.id}`, 'invoice'],
    ]) {
      const committed = await api().post(`${path}/document`).set(auth(owner)).send({}).expect(201);
      expect(committed.body.documentType).toBe(type);
      expect((await api().get(`/verify/${committed.body.qrToken}`).expect(200)).body.result).toBe('valid');
    }

    // §79: the audit log recorded the critical changes.
    const trail = await api().get(`/audit-logs?entityType=grn&entityId=${grn.body.id}`).set(auth(owner)).expect(200);
    expect(trail.body.items.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['create', 'status_change']));
    expect((await api().get('/audit-logs?action=document_generate&limit=100').set(auth(owner)).expect(200)).body.total).toBeGreaterThan(0);
  });

  it('§79: a document keeps the party details it was issued with, even after the master changes', async () => {
    const invoiceList = await api().get('/invoices').set(auth(accountant)).expect(200);
    const invoiceId = invoiceList.body.items[0].id;
    const before = await api().get(`/invoices/${invoiceId}`).set(auth(accountant)).expect(200);
    expect(before.body.customerSnapshot.legal_name).toBe('Acme Consumer Goods Pvt Ltd');

    // The customer renames itself and moves state after the invoice was issued.
    await api().patch(`/customers/${customerId}`).set(auth(owner)).send({ legalName: 'Acme Foods (India) Limited', placeOfSupply: '27' }).expect(200);
    expect((await api().get(`/customers/${customerId}`).set(auth(owner)).expect(200)).body.legalName).toBe('Acme Foods (India) Limited');

    // The issued invoice is unmoved: the snapshot and the tax treatment it was computed with both stand.
    const after = await api().get(`/invoices/${invoiceId}`).set(auth(accountant)).expect(200);
    expect(after.body.customerSnapshot.legal_name).toBe('Acme Consumer Goods Pvt Ltd');
    expect(after.body.taxTreatment).toBe('intra_state');
    expect(after.body.cgstAmount).toBe(before.body.cgstAmount);

    // And so is the PDF, which renders from that snapshot rather than from the master.
    const committed = await api().get('/documents?documentType=invoice').set(auth(owner)).expect(200);
    const download = await api().get(`/documents/${committed.body.items[0].id}/download`).set(auth(owner)).expect(200);
    expect(Buffer.from(download.body).subarray(0, 4).toString()).toBe('%PDF');
    expect(download.body.length).toBeGreaterThan(1000);
  });

  it('§79: two warehouses and two batches of one SKU keep separate balances', async () => {
    const receive = async (warehouseId: string, locationId: string, productId: string, quantity: number, batch?: Record<string, string>) => {
      const grn = await api()
        .post('/grns')
        .set(auth(owner))
        .send({ warehouseId, customerId, items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity, ...batch }] })
        .expect(201);
      for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
      const putaway = await api()
        .post('/putaways')
        .set(auth(owner))
        .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: locationId }] })
        .expect(201);
      await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
    };

    // The same SKU in two warehouses: WH02's arrival must not touch WH01's balance.
    const before = Object.fromEntries((await lots(riceId)).map((l) => [l.warehouseCode as string, Number(l.physicalQty)]));
    await receive(warehouseB, binB, riceId, 25);
    const after = Object.fromEntries((await lots(riceId)).map((l) => [l.warehouseCode as string, Number(l.physicalQty)]));
    expect(after.WH01).toBe(before.WH01);
    expect(after.WH02).toBe(25);

    // Two batches of one SKU in one bin never merge.
    await receive(warehouseA, binA, gheeId, 30, { batchNo: 'G-A', expiryDate: '2027-06-30' });
    await receive(warehouseA, binA, gheeId, 20, { batchNo: 'G-B', expiryDate: '2028-06-30' });
    const gheeLots = await lots(gheeId);
    const byBatch = Object.fromEntries(gheeLots.map((l) => [l.batchNo as string, l.physicalQty]));
    expect(byBatch).toEqual({ 'G-A': '30.000', 'G-B': '20.000' });

    // And a reservation draws from one batch, not from a merged pool.
    const order = await api()
      .post('/release-orders')
      .set(auth(owner))
      .send({ customerId, warehouseId: warehouseA, lines: [{ productId: gheeId, requestedQty: 25 }] })
      .expect(201);
    await api().post(`/release-orders/${order.body.id}/approve`).set(auth(owner)).expect(201);
    await api().post(`/release-orders/${order.body.id}/reserve`).set(auth(owner)).send({ allocationPolicy: 'fefo' }).expect(201);
    const ledger = await api().get(`/stock/ledger?sourceId=${order.body.id}`).set(auth(owner)).expect(200);
    // FEFO takes all 30... no: it takes 25 of the sooner-expiring G-A and stops.
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0]).toMatchObject({ batchNo: 'G-A', reservedDelta: '25.000' });
    const afterReserve = Object.fromEntries((await lots(gheeId)).map((l) => [l.batchNo as string, l.availableQty]));
    expect(afterReserve).toEqual({ 'G-A': '5.000', 'G-B': '20.000' });
    await api().post(`/release-orders/${order.body.id}/cancel`).set(auth(owner)).send({ reason: 'cleanup' }).expect(201);
  });

  it('§79: a cancelled receipt nets back to exactly the pre-GRN balance', async () => {
    const before = (await lots(riceId)).reduce((sum, l) => sum + Number(l.physicalQty), 0);
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId: warehouseA, customerId, items: [{ productId: riceId, expectedQty: 15, receivedQty: 15, acceptedQty: 15 }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    expect((await lots(riceId)).reduce((sum, l) => sum + Number(l.physicalQty), 0)).toBe(before + 15);

    const reversed = await api().post(`/grns/${grn.body.id}/reverse`).set(auth(owner)).expect(201);
    expect(reversed.body.status).toBe('reversed');
    // Exactly back, not approximately: the reversal is additive, one offsetting row per original.
    expect((await lots(riceId)).reduce((sum, l) => sum + Number(l.physicalQty), 0)).toBe(before);
    const ledger = await api().get(`/stock/ledger?sourceId=${grn.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items).toHaveLength(2);
    expect(ledger.body.items[1].reversalOfId).toBe(ledger.body.items[0].id);
  });
});
