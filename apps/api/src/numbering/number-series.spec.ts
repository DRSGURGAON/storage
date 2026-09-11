import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DOCUMENT_TYPE_PREFIXES } from './numbering-defaults';

/**
 * numbering.md §2's "tenants may edit prefix/format/padding/starting
 * number per document type from Settings" — which was true of the columns
 * and of nothing else until now.
 */
describe('Number series configuration', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let customerId = '';

  const api = () => request(app.getHttpServer());
  const auth = (token = owner) => ({ Authorization: `Bearer ${token}` });
  const seriesFor = async (documentType: string) =>
    (await api().get('/number-series').set(auth()).expect(200)).body
      .find((s: { documentType: string }) => s.documentType === documentType);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    owner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Series Ltd', tenantSlug: `ns-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    await api().post('/users').set(auth())
      .send({ email: `op-${suffix}@test.local`, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: `op-${suffix}@test.local`, password }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists every document type it can number, used or not', async () => {
    const body = (await api().get('/number-series').set(auth()).expect(200)).body;
    // A young workspace has allocated a CUSTOMER code at most; the rest
    // have no row yet, and a screen that showed only existing rows would
    // hide the twenty-odd series it is about to create.
    // Exactly one row per document type this application numbers --
    // whether or not it has ever been used. Counted from the map rather
    // than written here: a hard-coded number turns "a new document type
    // was added" into a failing test that says nothing about what broke.
    const expected = Object.keys(DOCUMENT_TYPE_PREFIXES).length;
    expect(body).toHaveLength(expected);
    expect(new Set(body.map((s: { documentType: string }) => s.documentType)).size).toBe(expected);
    expect(await seriesFor('GRN_GENERATION')).toMatchObject({
      prefix: 'GRN',
      format: '{prefix}/{fy}/{seq:6}',
      fyStyle: 'YY-YY',
      resetPolicy: 'yearly',
      nextSeq: 1,
      isConfigured: false,
    });
    // The one type with its own shipped defaults comes back with them.
    expect(await seriesFor('CUSTOMER')).toMatchObject({ prefix: 'CUST', format: '{prefix}{seq:4}', fyStyle: 'NONE' });
  });

  it('changes a prefix before the first document is ever numbered', async () => {
    const saved = await api().put('/number-series/GRN_GENERATION').set(auth())
      .send({ prefix: 'GR', padding: 4 })
      .expect(200);
    expect(saved.body).toMatchObject({ prefix: 'GR', padding: 4, nextSeq: 1, isConfigured: true });

    // And the engine numbers with it, because the engine has always read
    // this row -- there was simply no way to write it.
    const warehouseId = (
      await api().post('/warehouses').set(auth()).send({ code: 'WH01', name: 'Main' }).expect(201)
    ).body.id;
    customerId = (await api().post('/customers').set(auth()).send({ name: 'Alpha' }).expect(201)).body.id;
    const productId = (
      await api().post('/products').set(auth()).send({ sku: `SKU-${suffix}`, name: 'Widget', uomCode: 'NOS' }).expect(201)
    ).body.id;
    const grn = await api().post('/grns').set(auth())
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: 1, receivedQty: 1, acceptedQty: 1 }] })
      .expect(201);
    expect(grn.body.number).toMatch(/^GR\/\d{2}-\d{2}\/0001$/);
  });

  it('raises the next number but refuses to lower it', async () => {
    // Migrating from a system that already printed 4,120 invoices.
    const raised = await api().put('/number-series/INVOICE_GENERATION').set(auth())
      .send({ nextSeq: 4121 })
      .expect(200);
    expect(raised.body.nextSeq).toBe(4121);

    const refused = await api().put('/number-series/INVOICE_GENERATION').set(auth())
      .send({ nextSeq: 7 })
      .expect(400);
    expect(refused.body.message).toContain('raised but not lowered');

    // Setting it to exactly where it is is not a lowering, and is allowed.
    await api().put('/number-series/INVOICE_GENERATION').set(auth()).send({ nextSeq: 4121 }).expect(200);
  });

  it('refuses a format with no running number in it, and a type it does not number', async () => {
    await api().put('/number-series/GRN_GENERATION').set(auth())
      .send({ format: '{prefix}/{fy}' })
      .expect(400);
    await api().put('/number-series/BILL_OF_LADING').set(auth()).send({ prefix: 'BL' }).expect(400);
    await api().put('/number-series/GRN_GENERATION').set(auth()).send({ prefix: 'much too long a prefix' }).expect(400);
  });

  it('is Settings-only: an Operator can neither read nor change the series', async () => {
    await api().get('/number-series').set(auth(operator)).expect(403);
    await api().put('/number-series/GRN_GENERATION').set(auth(operator)).send({ prefix: 'XX' }).expect(403);
  });

  it('audits the change, since a numbering change is visible on every later document', async () => {
    const logs = (await api().get('/audit-logs?entityType=number_series').set(auth()).expect(200)).body;
    expect(logs.items.length).toBeGreaterThan(0);
    expect(logs.items.some((l: { newValue: { prefix: string } }) => l.newValue?.prefix === 'GR')).toBe(true);
  });
});
