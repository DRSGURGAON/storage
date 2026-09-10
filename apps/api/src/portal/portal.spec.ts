import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type postgres from 'postgres';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withPortalTenant, withTenant } from '../db/tenant-context';

/**
 * Blueprint §53 and `tenancy-and-security.md` §2: a portal login sees its
 * own customer's goods, documents and money, and there is no request it
 * can make -- to the portal or to the staff API -- that reaches anyone
 * else's.
 */
describe('Customer portal', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  let tenantId = '';
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let acmePortal = '';
  let boltPortal = '';
  let acme = '';
  let bolt = '';
  let warehouseId = '';
  let binId = '';
  let productId = '';
  let acmeDispatchId = '';
  let acmeDocumentId = '';
  let boltDocumentId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const shipTo = async (customerId: string, quantity: number) => {
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
    const document = await api().post(`/grns/${grn.body.id}/document`).set(auth(owner)).send({}).expect(201);

    const order = (await api().post('/release-orders').set(auth(owner)).send({ customerId, warehouseId, lines: [{ productId, requestedQty: quantity / 2 }] }).expect(201)).body;
    await api().post(`/release-orders/${order.id}/approve`).set(auth(owner)).expect(201);
    await api().post(`/release-orders/${order.id}/reserve`).set(auth(owner)).send({}).expect(201);
    const pick = (await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201)).body;
    await api().post(`/pick-lists/${pick.id}/confirm`).set(auth(owner)).send({ lines: [{ lineId: pick.lines[0].id, pickQty: quantity / 2 }] }).expect(201);
    await api().post(`/pick-lists/${pick.id}/complete`).set(auth(owner)).expect(201);
    const dispatch = (await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201)).body;
    const pass = (await api().post('/gate-passes').set(auth(owner)).send({ dispatchId: dispatch.id }).expect(201)).body;
    await api().post(`/gate-passes/${pass.id}/gate-out`).set(auth(owner)).expect(201);
    return { dispatchId: dispatch.id, documentId: document.body.id };
  };

  const portalLogin = async (email: string, customerId: string) => {
    await api().post('/users').set(auth(owner)).send({ email, fullName: 'Portal User', password, roleCode: 'customer', customerId }).expect(201);
    return (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);
    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Portal Ltd', tenantSlug: `pt-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;

    acme = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co', legalName: 'Acme Consumer Goods Pvt Ltd' }).expect(201)).body.id;
    bolt = (await api().post('/customers').set(auth(owner)).send({ name: 'Bolt Ltd' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: 'A' }).expect(201);
    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: zone.body.id }).expect(201);
    binId = (await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: 'B01', parentId: rack.body.id }).expect(201)).body.id;
    productId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;

    const acmeShipment = await shipTo(acme, 100);
    acmeDispatchId = acmeShipment.dispatchId;
    acmeDocumentId = acmeShipment.documentId;
    boltDocumentId = (await shipTo(bolt, 40)).documentId;

    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    acmePortal = await portalLogin(`acme-${suffix}@test.local`, acme);
    boltPortal = await portalLogin(`bolt-${suffix}@test.local`, bolt);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a customer for a portal membership, and refuses one everywhere else', async () => {
    await api().post('/users').set(auth(owner)).send({ email: `x1-${suffix}@test.local`, fullName: 'No Customer', password, roleCode: 'customer' }).expect(400);
    await api().post('/users').set(auth(owner)).send({ email: `x2-${suffix}@test.local`, fullName: 'Bad Customer', password, roleCode: 'customer', customerId: randomUUID() }).expect(404);
    await api().post('/users').set(auth(owner)).send({ email: `x3-${suffix}@test.local`, fullName: 'Staff', password, roleCode: 'warehouse_operator', customerId: acme }).expect(400);
    // A portal membership is scoped by customer, not by warehouse.
    await api().post('/users').set(auth(owner)).send({ email: `x4-${suffix}@test.local`, fullName: 'Both', password, roleCode: 'customer', customerId: acme, warehouseIds: [warehouseId] }).expect(400);

    const members = await api().get("/users").set(auth(owner)).expect(200);
    const portalMember = (members.body.items ?? members.body).find((m: { email: string }) => m.email === `acme-${suffix}@test.local`);
    expect(portalMember).toMatchObject({ customerId: acme, role: { code: 'customer' } });
  });

  it('shows the customer their own stock, receipts, dispatches, invoices and documents', async () => {
    const me = await api().get('/portal/me').set(auth(acmePortal)).expect(200);
    expect(me.body.customer).toMatchObject({ id: acme, legalName: 'Acme Consumer Goods Pvt Ltd' });
    expect(me.body.warehouseOperator).toBe('Portal Ltd');
    expect(me.body.summary).toMatchObject({ approvedGrns: 1, dispatches: 1, stockOnHand: 50, openReleaseOrders: 1 });

    const stock = await api().get('/portal/stock').set(auth(acmePortal)).expect(200);
    expect(stock.body.total).toBe(1);
    expect(stock.body.items[0]).toMatchObject({ sku: 'RICE-25', physicalQty: 50, availableQty: 50, warehouseCode: 'WH01' });

    const receipts = await api().get('/portal/goods-receipts').set(auth(acmePortal)).expect(200);
    expect(receipts.body.total).toBe(1);
    expect(receipts.body.items[0]).toMatchObject({ acceptedQty: 100, status: 'approved' });

    const dispatches = await api().get('/portal/dispatches').set(auth(acmePortal)).expect(200);
    expect(dispatches.body.total).toBe(1);
    expect(dispatches.body.items[0]).toMatchObject({ id: acmeDispatchId, status: 'gate_out', delivery: null });

    const orders = await api().get('/portal/release-orders').set(auth(acmePortal)).expect(200);
    expect(orders.body.items[0]).toMatchObject({ requestedQty: 50, dispatchedQty: 50, status: 'dispatched' });

    const documents = await api().get('/portal/documents').set(auth(acmePortal)).expect(200);
    expect(documents.body.items.map((d: { id: string }) => d.id)).toContain(acmeDocumentId);
    expect(documents.body.items.map((d: { id: string }) => d.id)).not.toContain(boltDocumentId);
    const download = await api().get(`/portal/documents/${acmeDocumentId}/download`).set(auth(acmePortal)).expect(200);
    expect(Buffer.from(download.body).subarray(0, 4).toString()).toBe('%PDF');

    const statement = await api().get('/portal/statement').set(auth(acmePortal)).expect(200);
    expect(statement.body.customer.id).toBe(acme);
    expect(statement.body.closingBalance).toBe(0);
    expect((await api().get('/portal/invoices').set(auth(acmePortal)).expect(200)).body.total).toBe(0);
  });

  it('cannot see the other customer, whichever door it tries', async () => {
    // Bolt's portal sees only Bolt.
    const boltStock = await api().get('/portal/stock').set(auth(boltPortal)).expect(200);
    expect(boltStock.body.items[0]).toMatchObject({ physicalQty: 20 });
    expect((await api().get('/portal/me').set(auth(boltPortal)).expect(200)).body.customer.id).toBe(bolt);
    expect((await api().get('/portal/dispatches').set(auth(boltPortal)).expect(200)).body.items.some((d: { id: string }) => d.id === acmeDispatchId)).toBe(false);

    // Acme's own document id, requested by Bolt's portal, is not a file.
    await api().get(`/portal/documents/${acmeDocumentId}/download`).set(auth(boltPortal)).expect(404);

    // And the staff API is closed to a portal session: the customer role holds no permission codes.
    for (const path of ['/stock', '/grns', '/customers', '/invoices', '/documents', '/dispatches', '/release-orders']) {
      await api().get(path).set(auth(acmePortal)).expect(403);
    }
    await api().get(`/customer-statements/${acme}`).set(auth(acmePortal)).expect(403);
    await api().post('/customers').set(auth(acmePortal)).send({ name: 'Sneaky' }).expect(403);

    // Staff cannot use the portal either -- it is not a filtered view of the staff API.
    const refused = await api().get('/portal/me').set(auth(owner)).expect(403);
    expect(refused.body.message).toMatch(/customer-portal logins/);
    await api().get('/portal/stock').expect(401);
  });

  it('raises a return request against its own dispatch, and only for what that dispatch carried', async () => {
    const tooMuch = await api()
      .post('/portal/return-requests')
      .set(auth(acmePortal))
      .send({ originalDispatchId: acmeDispatchId, reason: 'Damaged in transit', lines: [{ productId, quantity: 51 }] })
      .expect(400);
    expect(tooMuch.body.message).toMatch(/Only 50 of that product/);
    // Another customer's dispatch is simply not found.
    await api()
      .post('/portal/return-requests')
      .set(auth(boltPortal))
      .send({ originalDispatchId: acmeDispatchId, reason: 'Not mine', lines: [{ productId, quantity: 1 }] })
      .expect(404);

    const created = await api()
      .post('/portal/return-requests')
      .set(auth(acmePortal))
      .send({ originalDispatchId: acmeDispatchId, reason: 'Ten bags damaged in transit', lines: [{ productId, quantity: 10 }] })
      .expect(201);
    expect(created.body.number).toMatch(/^RR\//);
    expect(created.body.status).toBe('requested');

    // Staff see it in their own queue, attributed to the right customer, and approve it as usual.
    const staffView = await api().get('/return-requests').set(auth(owner)).expect(200);
    expect(staffView.body.items[0]).toMatchObject({ id: created.body.id, customerId: acme, status: 'requested' });
    await api().post(`/return-requests/${created.body.id}/approve`).set(auth(owner)).expect(201);
    // The portal cannot approve its own request.
    await api().post(`/return-requests/${created.body.id}/approve`).set(auth(acmePortal)).expect(403);
  });

  /**
   * The database half of `tenancy-and-security.md` §2. Everything above
   * proves the *service* keeps the two customers apart; this proves the
   * separation survives the service getting it wrong. Each query below is
   * deliberately written without a `customer_id` filter -- the mistake the
   * portal is one typo away from -- and run inside `withPortalTenant`, the
   * way a portal request runs.
   */
  it('§2: a portal transaction cannot read another customer, even with the filter left out', async () => {
    const unfiltered = (tx: postgres.TransactionSql) =>
      Promise.all([
        tx<{ customer_id: string }[]>`select customer_id from stock_lots where tenant_id = ${tenantId}`,
        tx<{ customer_id: string }[]>`select customer_id from grns where tenant_id = ${tenantId}`,
        tx<{ customer_id: string }[]>`select customer_id from dispatches where tenant_id = ${tenantId}`,
        tx<{ id: string }[]>`select id from customers where tenant_id = ${tenantId}`,
      ]);

    // Staff context: both customers are there, which is what makes the next assertion mean something.
    const staff = await withTenant(sql, tenantId, unfiltered);
    expect(new Set(staff[0].map((r) => r.customer_id))).toEqual(new Set([acme, bolt]));
    expect(staff[3]).toHaveLength(2);

    // Portal context, same queries: only ever the one customer.
    const asAcme = await withPortalTenant(sql, tenantId, acme, unfiltered);
    for (const rows of asAcme.slice(0, 3) as { customer_id: string }[][]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.customer_id === acme)).toBe(true);
    }
    expect((asAcme[3] as { id: string }[]).map((r) => r.id)).toEqual([acme]);

    const asBolt = await withPortalTenant(sql, tenantId, bolt, unfiltered);
    expect((asBolt[0] as { customer_id: string }[]).every((r) => r.customer_id === bolt)).toBe(true);
    expect((asBolt[3] as { id: string }[]).map((r) => r.id)).toEqual([bolt]);

    // A shared master stays readable -- the portal's own stock list has to be able to name the product.
    const products = await withPortalTenant(sql, tenantId, acme, (tx) =>
      tx<{ id: string }[]>`select id from products where tenant_id = ${tenantId} and customer_id is null`,
    );
    expect(products.length).toBeGreaterThan(0);

    // And a write claiming another customer is refused by WITH CHECK, not merely unwritten.
    await expect(
      withPortalTenant(sql, tenantId, acme, (tx) =>
        tx`insert into return_requests (id, tenant_id, number, request_date, customer_id, warehouse_id, original_dispatch_id, reason)
           values (gen_random_uuid(), ${tenantId}, ${'RR/FORGED/1'}, current_date, ${bolt}, ${warehouseId}, ${acmeDispatchId}, 'forged')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('hands the customer a signed link it can forward, scoped to itself', async () => {
    const minted = await api().post(`/portal/documents/${acmeDocumentId}/download-link`).set(auth(acmePortal)).expect(201);
    const fetched = await api().get(minted.body.url).expect(200);
    expect(Buffer.from(fetched.body).subarray(0, 4).toString()).toBe('%PDF');

    // The other customer cannot mint one for a document that is not theirs...
    await api().post(`/portal/documents/${acmeDocumentId}/download-link`).set(auth(boltPortal)).expect(404);
    // ...and staff minting one for Bolt's document produces a link that opens
    // Bolt's document and nothing else, however it is passed around.
    const staffLink = await api().post(`/documents/${boltDocumentId}/download-link`).set(auth(owner)).expect(201);
    await api().get(staffLink.body.url).expect(200);
  });

  it('stops working the moment the membership is disabled', async () => {
    const members = await api().get("/users").set(auth(owner)).expect(200);
    const membership = (members.body.items ?? members.body).find((m: { email: string }) => m.email === `bolt-${suffix}@test.local`);
    await api().patch(`/users/${membership.id}`).set(auth(owner)).send({ status: 'disabled' }).expect(200);
    // The token is still signed and unexpired; the membership is what decides.
    const refused = await api().get('/portal/me').set(auth(boltPortal)).expect(403);
    expect(refused.body.message).toMatch(/no longer active/);
  });
});
