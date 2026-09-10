import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §27, both halves: the count (which changes nothing) and the
 * adjustment (which is the only way a stock figure changes with no receipt
 * or dispatch behind it, and therefore the one record with a real approval
 * chain). Tested together because neither is much use alone -- a count
 * that nothing acts on is a spreadsheet, and an adjustment with nothing
 * behind it is the thing §50 exists to prevent.
 */
describe('Stock verifications and adjustments', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let admin = '';
  let manager = '';
  let operator = '';
  let otherOwner = '';
  let customerId = '';
  let warehouseId = '';
  let binA = '';
  let binB = '';
  let riceId = '';
  let oilId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const signup = async (slug: string, email: string) =>
    (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken as string;

  const member = async (roleCode: string) => {
    const email = `${roleCode}-${suffix}@test.local`;
    await api().post('/users').set(auth(owner)).send({ email, fullName: roleCode.replace(/_/g, ' '), password, roleCode }).expect(201);
    return (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken as string;
  };

  const makeBin = async (zone: string, bin: string) => {
    const z = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: zone }).expect(201);
    const r = await api()
      .post(`/warehouses/${warehouseId}/locations`)
      .set(auth(owner))
      .send({ level: 'rack', segment: 'R01', parentId: z.body.id })
      .expect(201);
    return (
      await api()
        .post(`/warehouses/${warehouseId}/locations`)
        .set(auth(owner))
        .send({ level: 'bin', segment: bin, parentId: r.body.id })
        .expect(201)
    ).body.id as string;
  };

  const stockUp = async (productId: string, quantity: number, locationId: string) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    }
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: locationId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
  };

  const onHand = async () =>
    Object.fromEntries(
      (await api().get('/stock?limit=100').set(auth(owner)).expect(200)).body.items.map((i: Record<string, string>) => [
        `${i.locationFullCode}:${i.sku}`,
        i.physicalQty,
      ]),
    ) as Record<string, string>;

  /** Drives a fresh adjustment all the way to approved. */
  const approvedAdjustment = async (body: Record<string, unknown>) => {
    const created = await api().post('/stock-adjustments').set(auth(owner)).send(body).expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/submit`).set(auth(owner)).expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/approve`).set(auth(owner)).expect(201);
    const after = await api().get(`/stock-adjustments/${created.body.id}`).set(auth(owner)).expect(200);
    if (after.body.status === 'pending_owner') {
      await api().post(`/stock-adjustments/${created.body.id}/approve-final`).set(auth(owner)).expect(201);
    }
    return created.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`sv-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`sv-b-${suffix}`, `owner-b-${suffix}@test.local`);
    admin = await member('admin');
    manager = await member('warehouse_manager');
    operator = await member('warehouse_operator');

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Main' }).expect(201)).body.id;
    binA = await makeBin('A', 'B01');
    binB = await makeBin('B', 'B02');
    riceId = (
      await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati', uomCode: 'BAG' }).expect(201)
    ).body.id;
    oilId = (
      await api().post('/products').set(auth(owner)).send({ sku: 'OIL-15', name: 'Sunflower Oil', uomCode: 'BOX' }).expect(201)
    ).body.id;
    await stockUp(riceId, 100, binA);
    await stockUp(oilId, 50, binB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds its own count sheet from current stock, and moves nothing by counting', async () => {
    const created = await api().post('/stock-verifications').set(auth(owner)).send({ warehouseId, customerId }).expect(201);
    expect(created.body.number).toMatch(/^SV\//);
    // Lines come from stock_lots, not from the caller: a count whose
    // subject the counter picks is not a count.
    expect(created.body.lines).toHaveLength(2);
    expect(created.body.lines.map((l: { systemQty: number }) => l.systemQty).sort((a: number, b: number) => a - b)).toEqual([
      50, 100,
    ]);
    expect(created.body.discrepancyCount).toBe(0);

    const rice = created.body.lines.find((l: { sku: string }) => l.sku === 'RICE-25');
    const counted = await api()
      .patch(`/stock-verifications/${created.body.id}/lines/${rice.id}`)
      .set(auth(owner))
      .send({ physicalQty: 94, reason: 'Damaged in rack' })
      .expect(200);
    const after = counted.body.lines.find((l: { sku: string }) => l.sku === 'RICE-25');
    // The difference is a generated column -- the client never asserts it.
    expect(after.differenceQty).toBe(-6);
    expect(counted.body.discrepancyCount).toBe(1);

    // Counting is not correcting. This is the whole point of the record.
    const balances = await onHand();
    expect(balances['WH01-A-R01-B01:RICE-25']).toBe('100.000');

    await api().post(`/stock-verifications/${created.body.id}/complete`).set(auth(owner)).expect(201);
    await api()
      .patch(`/stock-verifications/${created.body.id}/lines/${rice.id}`)
      .set(auth(owner))
      .send({ physicalQty: 1 })
      .expect(400);
  });

  it('records stock the system has no lot for at all -- a find, not a mismatch', async () => {
    const created = await api().post('/stock-verifications').set(auth(owner)).send({ warehouseId, customerId }).expect(201);
    const withFound = await api()
      .post(`/stock-verifications/${created.body.id}/lines`)
      .set(auth(owner))
      .send({ productId: oilId, locationId: binA, physicalQty: 7, reason: 'Found in wrong aisle' })
      .expect(201);

    const found = withFound.body.lines.find((l: { stockLotId: string | null }) => l.stockLotId === null);
    expect(found).toMatchObject({ systemQty: 0, physicalQty: 7, differenceQty: 7 });
    // Without this, a count could only ever report shortages.
    await api()
      .post(`/stock-verifications/${created.body.id}/lines`)
      .set(auth(owner))
      .send({ productId: oilId, locationId: binA, physicalQty: 7 })
      .expect(201);
  });

  it('raises an adjustment from a count, copying only the lines that disagree', async () => {
    const verification = await api().post('/stock-verifications').set(auth(owner)).send({ warehouseId, customerId }).expect(201);
    const rice = verification.body.lines.find((l: { sku: string }) => l.sku === 'RICE-25');
    await api()
      .patch(`/stock-verifications/${verification.body.id}/lines/${rice.id}`)
      .set(auth(owner))
      .send({ physicalQty: 97 })
      .expect(200);

    // An incomplete count is not something to act on.
    await api()
      .post('/stock-adjustments')
      .set(auth(owner))
      .send({ sourceVerificationId: verification.body.id, reason: 'Too early' })
      .expect(400);
    await api().post(`/stock-verifications/${verification.body.id}/complete`).set(auth(owner)).expect(201);

    const adjustment = await api()
      .post('/stock-adjustments')
      .set(auth(owner))
      .send({ sourceVerificationId: verification.body.id, reason: 'Physical count Sept 2026' })
      .expect(201);
    // Two lots were counted, one disagreed.
    expect(adjustment.body.lines).toHaveLength(1);
    expect(adjustment.body.lines[0].quantityDelta).toBe(-3);

    // A reason is never optional: an unexplained change to a stock figure
    // is exactly what this record exists to prevent.
    await api()
      .post('/stock-adjustments')
      .set(auth(owner))
      .send({ sourceVerificationId: verification.body.id })
      .expect(400);
  });

  it('walks draft → pending_manager → approved → posted, and only then moves stock', async () => {
    const before = await onHand();
    const created = await api()
      .post('/stock-adjustments')
      .set(auth(owner))
      .send({
        warehouseId,
        customerId,
        reason: 'Spillage in aisle A',
        lines: [{ productId: riceId, locationId: binA, quantityDelta: -6 }],
      })
      .expect(201);

    await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(owner)).expect(400);
    await api().post(`/stock-adjustments/${created.body.id}/submit`).set(auth(owner)).expect(201);
    expect((await api().get(`/stock-adjustments/${created.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('pending_manager');
    await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(owner)).expect(400);

    await api().post(`/stock-adjustments/${created.body.id}/approve`).set(auth(owner)).expect(201);
    const approved = await api().get(`/stock-adjustments/${created.body.id}`).set(auth(owner)).expect(200);
    // One approval is enough while the owner step is off (the default).
    expect(approved.body.status).toBe('approved');
    expect(approved.body.managerApprovedAt).not.toBeNull();
    // Approval authorises; it does not apply.
    expect(await onHand()).toEqual(before);

    const posted = await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(owner)).expect(201);
    expect(posted.body.status).toBe('posted');
    expect(posted.body.postedAt).not.toBeNull();
    expect((await onHand())['WH01-A-R01-B01:RICE-25']).toBe(String(Number(before['WH01-A-R01-B01:RICE-25']) - 6) + '.000');

    const ledger = await api().get(`/stock/ledger?sourceId=${created.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items).toHaveLength(1);
    // stock-engine.md §3.4: every correction is an ADJUSTMENT naming its
    // own stock_adjustments row -- there is no anonymous stock edit.
    expect(ledger.body.items[0]).toMatchObject({ txnType: 'ADJUSTMENT', qtyOut: '6.000', sourceType: 'stock_adjustment' });
  });

  it('inserts the Owner step only when the tenant has switched it on', async () => {
    await api()
      .put('/company/settings/approvals.stock_adjustment.owner_required')
      .set(auth(owner))
      .send({ value: true })
      .expect(200);

    const created = await api()
      .post('/stock-adjustments')
      .set(auth(owner))
      .send({ warehouseId, customerId, reason: 'Breakage', lines: [{ productId: riceId, locationId: binA, quantityDelta: -2 }] })
      .expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/submit`).set(auth(owner)).expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/approve`).set(auth(owner)).expect(201);

    // The setting is read per request, so turning it on takes effect on
    // the next adjustment rather than on a redeploy.
    const handedOver = await api().get(`/stock-adjustments/${created.body.id}`).set(auth(owner)).expect(200);
    expect(handedOver.body.status).toBe('pending_owner');
    await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(owner)).expect(400);

    await api().post(`/stock-adjustments/${created.body.id}/approve-final`).set(auth(owner)).expect(201);
    const complete = await api().get(`/stock-adjustments/${created.body.id}`).set(auth(owner)).expect(200);
    expect(complete.body.status).toBe('approved');
    expect(complete.body.ownerApprovedAt).not.toBeNull();

    await api().delete('/company/settings/approvals.stock_adjustment.owner_required').set(auth(owner)).expect(200);
  });

  it('gates the final approval on Owner alone -- not the Manager who approved it, and not even an Admin', async () => {
    await api()
      .put('/company/settings/approvals.stock_adjustment.owner_required')
      .set(auth(owner))
      .send({ value: true })
      .expect(200);

    // An Operator may raise one: noticing a discrepancy is floor work.
    const created = await api()
      .post('/stock-adjustments')
      .set(auth(operator))
      .send({ warehouseId, customerId, reason: 'Found broken', lines: [{ productId: riceId, locationId: binA, quantityDelta: -1 }] })
      .expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/approve`).set(auth(operator)).expect(403);
    await api().post(`/stock-adjustments/${created.body.id}/submit`).set(auth(operator)).expect(201);

    await api().post(`/stock-adjustments/${created.body.id}/approve`).set(auth(manager)).expect(201);
    // approve_stock_adjustment_final is Owner-only in the matrix -- one of
    // just two permissions Admin does not hold.
    await api().post(`/stock-adjustments/${created.body.id}/approve-final`).set(auth(manager)).expect(403);
    await api().post(`/stock-adjustments/${created.body.id}/approve-final`).set(auth(admin)).expect(403);
    await api().post(`/stock-adjustments/${created.body.id}/approve-final`).set(auth(owner)).expect(201);

    // Posting is the approver's act, not the requester's.
    await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(operator)).expect(403);
    await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(manager)).expect(201);

    await api().delete('/company/settings/approvals.stock_adjustment.owner_required').set(auth(owner)).expect(200);
  });

  it('refuses a posting that would go negative, and leaves the approval standing', async () => {
    const before = await onHand();
    const id = await approvedAdjustment({
      warehouseId,
      customerId,
      reason: 'Write off the lot',
      lines: [{ productId: riceId, locationId: binA, quantityDelta: -9999 }],
    });

    const refused = await api().post(`/stock-adjustments/${id}/post`).set(auth(owner)).expect(400);
    expect(refused.body.message).toMatch(/negative/i);

    // This is why approval and posting are separate acts. Had approval
    // posted in the same breath, this failure would have rolled back a
    // decision two people already made.
    expect((await api().get(`/stock-adjustments/${id}`).set(auth(owner)).expect(200)).body.status).toBe('approved');
    expect(await onHand()).toEqual(before);
    expect((await api().get(`/stock/ledger?sourceId=${id}`).set(auth(owner)).expect(200)).body.total).toBe(0);
  });

  it('links each resolved count line back to the adjustment that fixed it', async () => {
    const verification = await api().post('/stock-verifications').set(auth(owner)).send({ warehouseId, customerId }).expect(201);
    const oil = verification.body.lines.find((l: { sku: string }) => l.sku === 'OIL-15');
    await api()
      .patch(`/stock-verifications/${verification.body.id}/lines/${oil.id}`)
      .set(auth(owner))
      .send({ physicalQty: Number(oil.systemQty) - 1 })
      .expect(200);
    await api().post(`/stock-verifications/${verification.body.id}/complete`).set(auth(owner)).expect(201);

    const id = await approvedAdjustment({ sourceVerificationId: verification.body.id, reason: 'Count correction' });
    await api().post(`/stock-adjustments/${id}/post`).set(auth(owner)).expect(201);

    const closed = await api().get(`/stock-verifications/${verification.body.id}`).set(auth(owner)).expect(200);
    const resolved = closed.body.lines.filter((l: { differenceQty: number }) => l.differenceQty !== 0);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every((l: { stockAdjustmentId: string | null }) => l.stockAdjustmentId === id)).toBe(true);
  });

  it('renders the count sheet blank before the count and filled in after -- the tenth template', async () => {
    const verification = await api().post('/stock-verifications').set(auth(owner)).send({ warehouseId }).expect(201);

    const blank = await api().post(`/stock-verifications/${verification.body.id}/document/preview`).set(auth(owner)).expect(201);
    const blankPdf = Buffer.from(blank.body);
    expect(blankPdf.subarray(0, 4).toString()).toBe('%PDF');

    await api().post(`/stock-verifications/${verification.body.id}/complete`).set(auth(owner)).expect(201);
    const filled = await api().post(`/stock-verifications/${verification.body.id}/document/preview`).set(auth(owner)).expect(201);
    expect(Buffer.from(filled.body).subarray(0, 4).toString()).toBe('%PDF');
    // The two are genuinely different documents: the blank sheet hides the
    // system quantity so the counter is counting rather than confirming.
    expect(Buffer.from(filled.body).length).not.toBe(blankPdf.length);

    const committed = await api().post(`/stock-verifications/${verification.body.id}/document`).set(auth(owner)).send({}).expect(201);
    expect(committed.body).toMatchObject({ documentType: 'stock_verification', versionNo: 1 });
    expect((await api().get(`/verify/${committed.body.qrToken}`).expect(200)).body.result).toBe('valid');
  });

  it('rejects, cancels, and keeps tenants apart', async () => {
    const created = await api()
      .post('/stock-adjustments')
      .set(auth(owner))
      .send({ warehouseId, customerId, reason: 'Unsure', lines: [{ productId: riceId, locationId: binA, quantityDelta: 5 }] })
      .expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/submit`).set(auth(owner)).expect(201);
    await api().post(`/stock-adjustments/${created.body.id}/reject`).set(auth(owner)).send({}).expect(400);
    await api()
      .post(`/stock-adjustments/${created.body.id}/reject`)
      .set(auth(owner))
      .send({ reason: 'Recount first' })
      .expect(201);
    expect((await api().get(`/stock-adjustments/${created.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('rejected');
    await api().post(`/stock-adjustments/${created.body.id}/post`).set(auth(owner)).expect(400);

    expect((await api().get('/stock-verifications').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    expect((await api().get('/stock-adjustments').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get(`/stock-adjustments/${created.body.id}`).set(auth(otherOwner)).expect(404);
    await api().get('/stock-verifications').expect(401);
    await api().get('/stock-adjustments').expect(401);
  });
});
