import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §55's reports, run against records this spec actually creates
 * -- a gate entry that arrived, an inward, a GRN that was approved -- so
 * the numbers are checked against something known rather than against
 * whatever happened to be in the database.
 */
describe('Reports library', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';
  const today = new Date().toISOString().slice(0, 10);

  const api = () => request(app.getHttpServer());
  const auth = (token = owner) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    owner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Reports Ltd', tenantSlug: `rp-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;

    await api().post('/users').set(auth())
      .send({ email: `op-${suffix}@test.local`, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: `op-${suffix}@test.local`, password }).expect(201)).body.accessToken;

    customerId = (await api().post('/customers').set(auth()).send({ name: 'Alpha Traders' }).expect(201)).body.id;
    warehouseId = (
      await api().post('/warehouses').set(auth()).send({ name: 'Main', code: 'MAIN', city: 'Gurugram' }).expect(201)
    ).body.id;
    productId = (
      await api().post('/products').set(auth())
        .send({ customerId, sku: `RICE-${suffix}`, name: 'Basmati Rice 25kg', uomCode: 'BAG' })
        .expect(201)
    ).body.id;

    // One vehicle in, one inward received short, one GRN approved.
    const gate = await api().post('/gate-entries').set(auth())
      .send({ warehouseId, direction: 'in', purpose: 'inward', customerId, vehicleNumber: 'HR 26 DK 1234' })
      .expect(201);
    const inward = await api().post('/inwards').set(auth())
      .send({
        gateEntryId: gate.body.id,
        supplierName: 'Acme Distributors',
        items: [{ productId, expectedQty: 100, receivedQty: 95, acceptedQty: 91, rejectedQty: 4 }],
      })
      .expect(201);
    await api().post(`/inwards/${inward.body.id}/receive`).set(auth()).expect(201);
    const grn = await api().post('/grns').set(auth()).send({ inwardId: inward.body.id }).expect(201);
    expect(grn.body.hasDiscrepancy).toBe(true);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set(auth()).expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('covers all four of §55\'s groups, and the twenty-three reports it lists', async () => {
    const catalogue = (await api().get('/reports/catalogue').set(auth()).expect(200)).body;
    expect(new Set(catalogue.map((r: { group: string }) => r.group))).toEqual(
      new Set(['operations', 'stock', 'billing', 'documents']),
    );
    // §55's own count: 5 operations, 8 stock, 6 billing, 4 documents. The
    // Owner holds every permission, so the catalogue is the whole list.
    expect(catalogue).toHaveLength(23);
    const perGroup = (group: string) => catalogue.filter((r: { group: string }) => r.group === group).length;
    expect([perGroup('operations'), perGroup('stock'), perGroup('billing'), perGroup('documents')]).toEqual([5, 8, 6, 4]);
    // Every definition declares columns and a permission; a report with
    // neither would run and then show nothing, or run for everybody.
    for (const report of catalogue) {
      expect(report.columns.length).toBeGreaterThan(0);
      expect(report.description.length).toBeGreaterThan(20);
    }
  });

  it('offers a catalogue of what this caller can actually run', async () => {
    const catalogue = (await api().get('/reports/catalogue').set(auth()).expect(200)).body;
    expect(catalogue.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['daily_inward', 'daily_outward', 'gate_entry_register', 'grn_register', 'dispatch_register',
        'current_stock', 'customer_stock', 'stock_ledger', 'stock_movement', 'stock_ageing', 'location_stock',
        'stock_verification_register', 'stock_adjustment_register',
        'storage_charges', 'handling_charges', 'invoice_register', 'outstanding', 'collection', 'customer_statement',
        'document_register', 'pending_pod', 'pending_approvals', 'agreement_expiry']),
    );
    const daily = catalogue.find((r: { code: string }) => r.code === 'daily_inward');
    expect(daily).toMatchObject({ group: 'operations', filters: expect.arrayContaining(['dateRange']) });
    expect(daily.columns[0]).toMatchObject({ key: 'day', label: 'Date' });
  });

  it('counts the day this spec just made', async () => {
    const body = (await api().get('/reports/run/daily_inward').query({ from: today, to: today }).set(auth()).expect(200)).body;
    expect(body).toMatchObject({ code: 'daily_inward', rowCount: 1, filters: { from: today, to: today } });
    expect(body.rows[0]).toMatchObject({ gateEntries: 1, inwards: 1, grns: 1, receivedQty: 95, acceptedQty: 91, rejectedQty: 4 });
    // Totals come from the columns that declare themselves summable.
    expect(body.totals).toMatchObject({ receivedQty: 95, acceptedQty: 91 });
  });

  it('defaults an open date range to the last thirty days rather than everything', async () => {
    const body = (await api().get('/reports/run/grn_register').set(auth()).expect(200)).body;
    expect(body.filters.to).toBe(today);
    expect(Date.parse(body.filters.to) - Date.parse(body.filters.from)).toBe(30 * 86400 * 1000);
    expect(body.rows[0]).toMatchObject({ customer: 'Alpha Traders', supplier: 'Acme Distributors', receivedQty: 95, acceptedQty: 91, shortQty: 5, discrepancy: 'yes' });
  });

  it('refuses a report that does not exist, and a backwards date range', async () => {
    await api().get('/reports/run/profit_and_loss').set(auth()).expect(404);
    await api().get('/reports/run/grn_register').query({ from: today, to: '2020-01-01' }).set(auth()).expect(400);
  });

  it('exports the same rows as CSV, and only to someone allowed to take them out', async () => {
    const csv = await api().get('/reports/run/grn_register/csv').query({ from: today, to: today }).set(auth()).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('grn_register-');
    const [header, first] = csv.text.split('\r\n');
    expect(header.split(',')).toEqual(['Number', 'Date', 'Warehouse', 'Customer', 'Supplier', 'Received', 'Accepted', 'Short', 'Damaged', 'Discrepancy', 'Status']);
    expect(first).toContain('Alpha Traders');
    expect(first).toContain('91');

    // A Warehouse Operator holds neither `view_reports` nor
    // `export_reports` (permissions-matrix.md), so both are refused. The
    // two codes are still checked separately -- the catalogue and the run
    // want `view_reports`, the file wants `export_reports` -- because
    // taking a report out of the building is its own decision, even though
    // no seeded role currently splits them.
    await api().get('/reports/catalogue').set(auth(operator)).expect(403);
    await api().get('/reports/run/grn_register').query({ from: today, to: today }).set(auth(operator)).expect(403);
    await api().get('/reports/run/grn_register/csv').query({ from: today, to: today }).set(auth(operator)).expect(403);
  });

  it('reads stock off the engine\'s own tables, not a recount', async () => {
    const current = (await api().get('/reports/run/current_stock').set(auth()).expect(200)).body;
    // 91 accepted on the one approved GRN, and that is the balance the
    // stock screen shows too -- the report joins `stock_lots`, it does not
    // re-add the receipts.
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0]).toMatchObject({ sku: `RICE-${suffix}`, physicalQty: 91, reservedQty: 0, availableQty: 91 });
    expect(current.totals).toMatchObject({ physicalQty: 91 });

    const byCustomer = (await api().get('/reports/run/customer_stock').set(auth()).expect(200)).body;
    expect(byCustomer.rows[0]).toMatchObject({ customer: 'Alpha Traders', skus: 1, physicalQty: 91 });

    const ledger = (await api().get('/reports/run/stock_ledger').query({ from: today, to: today }).set(auth()).expect(200)).body;
    expect(ledger.rows[0]).toMatchObject({ txnType: 'INWARD', qtyIn: 91, qtyOut: 0, balance: 91, sourceType: 'grn' });

    // Opening zero, in 91, closing 91 -- the movement report reconciles.
    const movement = (await api().get('/reports/run/stock_movement').query({ from: today, to: today }).set(auth()).expect(200)).body;
    expect(movement.rows[0]).toMatchObject({ openingQty: 0, inQty: 91, outQty: 0, closingQty: 91 });

    const ageing = (await api().get('/reports/run/stock_ageing').set(auth()).expect(200)).body;
    expect(ageing.rows[0]).toMatchObject({ sku: `RICE-${suffix}`, physicalQty: 91, bucket: '0-30' });

    // Nothing has been put away, so the lot is not in a location yet --
    // and the report says that rather than hiding the stock.
    const location = (await api().get('/reports/run/location_stock').set(auth()).expect(200)).body;
    expect(location.rows[0]).toMatchObject({ location: '(not put away)', physicalQty: 91 });
  });

  it('reports nothing where nothing is outstanding', async () => {
    const pod = (await api().get('/reports/run/pending_pod').set(auth()).expect(200)).body;
    expect(pod).toMatchObject({ rowCount: 0, totals: null });
    const expiry = (await api().get('/reports/run/agreement_expiry').set(auth()).expect(200)).body;
    expect(expiry.rowCount).toBe(0);
    for (const code of ['stock_verification_register', 'stock_adjustment_register']) {
      expect((await api().get(`/reports/run/${code}`).set(auth()).expect(200)).body.rowCount).toBe(0);
    }
  });

  it('lists the documents this workspace has issued', async () => {
    const before = (await api().get('/reports/run/document_register').set(auth()).expect(200)).body;
    expect(before.rowCount).toBe(0);

    const grnId = (await api().get('/grns').set(auth()).expect(200)).body.items[0].id;
    await api().post(`/grns/${grnId}/document`).set(auth()).send({}).expect(201);

    const after = (await api().get('/reports/run/document_register').set(auth()).expect(200)).body;
    expect(after.rowCount).toBe(1);
    expect(after.rows[0]).toMatchObject({ documentType: 'grn', versionNo: 1, isLatest: 'current', generatedBy: 'Owner', verifications: 0 });
  });
});
