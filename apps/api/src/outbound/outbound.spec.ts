import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §32–§36, and the §79 outbound cases that end at the gate:
 * "dispatch 40 → stock 60", "prevent dispatch above available", and the
 * OUTWARD posting happening exactly once whichever document fires it.
 */
describe('Outbound: packing, dispatch, loading, gate pass, POD', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let otherOwner = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';
  let binA = '';
  let vehicleId = '';
  let driverId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const signup = async (slug: string, email: string) =>
    (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken as string;

  const makeBin = async (zone: string, bin: string) => {
    const z = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: zone }).expect(201);
    const r = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: z.body.id }).expect(201);
    return (await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: bin, parentId: r.body.id }).expect(201)).body.id as string;
  };

  const stockUp = async (quantity: number, locationId: string) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: locationId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
  };

  const totals = async () =>
    (await api().get(`/stock?productId=${productId}&limit=100`).set(auth(owner)).expect(200)).body.items.reduce(
      (acc: { physical: number; reserved: number; available: number }, l: { physicalQty: string; reservedQty: string; availableQty: string }) => ({
        physical: acc.physical + Number(l.physicalQty),
        reserved: acc.reserved + Number(l.reservedQty),
        available: acc.available + Number(l.availableQty),
      }),
      { physical: 0, reserved: 0, available: 0 },
    );

  /** A reserved and fully picked order for `qty` bags. */
  const pickedOrder = async (qty: number) => {
    const order = (
      await api()
        .post('/release-orders')
        .set(auth(owner))
        .send({ customerId, warehouseId, vehicleId, driverId, consigneeName: 'Acme Depot', lines: [{ productId, requestedQty: qty }] })
        .expect(201)
    ).body;
    await api().post(`/release-orders/${order.id}/approve`).set(auth(owner)).expect(201);
    await api().post(`/release-orders/${order.id}/reserve`).set(auth(owner)).send({}).expect(201);
    const pick = (await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201)).body;
    await api()
      .post(`/pick-lists/${pick.id}/confirm`)
      .set(auth(owner))
      .send({ lines: pick.lines.map((l: { id: string; requiredQty: number }) => ({ lineId: l.id, pickQty: l.requiredQty })) })
      .expect(201);
    await api().post(`/pick-lists/${pick.id}/complete`).set(auth(owner)).expect(201);
    return { order, pick };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`ob-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`ob-b-${suffix}`, `owner-b-${suffix}@test.local`);
    const opEmail = `op-${suffix}@test.local`;
    await api().post('/users').set(auth(owner)).send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' }).expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    productId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG', weightKg: 25 }).expect(201)).body.id;
    const transporterId = (await api().post('/transporters').set(auth(owner)).send({ name: 'Safexpress' }).expect(201)).body.id;
    vehicleId = (await api().post('/vehicles').set(auth(owner)).send({ vehicleNumber: 'HR26DK1234', transporterId }).expect(201)).body.id;
    driverId = (await api().post('/drivers').set(auth(owner)).send({ name: 'Ram Singh' }).expect(201)).body.id;
    binA = await makeBin('A', 'B01');
    await stockUp(100, binA);
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks the chain and posts OUTWARD once at gate-out: dispatch 40 → stock 60', async () => {
    // Nothing on a draft order can be dispatched or packed.
    const draft = (await api().post('/release-orders').set(auth(owner)).send({ customerId, warehouseId, lines: [{ productId, requestedQty: 1 }] }).expect(201)).body;
    await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: draft.id }).expect(400);
    await api().post('/packing-lists').set(auth(owner)).send({ releaseOrderId: draft.id }).expect(400);
    await api().post(`/release-orders/${draft.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);

    const { order, pick } = await pickedOrder(40);
    expect(await totals()).toEqual({ physical: 100, reserved: 40, available: 60 });

    // Packing list defaults to the picked quantities and computes weight from the product master.
    const packing = await api().post('/packing-lists').set(auth(owner)).send({ releaseOrderId: order.id, totalPackages: 40 }).expect(201);
    expect(packing.body.number).toMatch(/^PK\//);
    expect(packing.body.lines[0]).toMatchObject({ quantity: 40, weightKg: 1000 });
    expect(packing.body.totalWeightKg).toBe(1000);

    // Dispatch above what is picked is refused by name; the default takes all of it.
    const lineId = order.lines[0].id;
    const over = await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id, lines: [{ releaseOrderLineId: lineId, quantity: 41 }] }).expect(400);
    expect(over.body.message).toMatch(/cannot dispatch 41 -- only 40 is picked/);
    const dispatch = await api()
      .post('/dispatches')
      .set(auth(operator))
      .send({ releaseOrderId: order.id, pickListId: pick.id, packingListId: packing.body.id, lrNumber: 'LR-7781' })
      .expect(201);
    expect(dispatch.body).toMatchObject({ status: 'draft', vehicleNumber: 'HR26DK1234', driverName: 'Ram Singh', transporterName: 'Safexpress' });
    expect(dispatch.body.number).toMatch(/^DN\//);
    expect(dispatch.body.lines[0].quantity).toBe(40);
    // The same goods cannot be put on a second note while the first is open.
    await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(400);
    // And with the default posting point, a dispatch cannot declare itself gone.
    const noConfirm = await api().post(`/dispatches/${dispatch.body.id}/confirm`).set(auth(owner)).expect(400);
    expect(noConfirm.body.message).toMatch(/gate-out/);
    await api().post('/pods').set(auth(owner)).send({ dispatchId: dispatch.body.id }).expect(400);

    // Loading: every line ticked, or it is not loaded.
    const sheet = await api().post('/loading-sheets').set(auth(operator)).send({ dispatchId: dispatch.body.id, sealNumber: 'SEAL-99' }).expect(201);
    expect(sheet.body.number).toMatch(/^LS\//);
    await api().post(`/loading-sheets/${sheet.body.id}/complete`).set(auth(operator)).expect(400);
    await api().post(`/loading-sheets/${sheet.body.id}/confirm`).set(auth(operator)).send({ lines: [{ lineId: sheet.body.lines[0].id, loaded: false }] }).expect(201);
    const notYet = await api().post(`/loading-sheets/${sheet.body.id}/complete`).set(auth(operator)).expect(400);
    expect(notYet.body.message).toMatch(/1 line\(s\) not yet loaded: RICE-25/);
    await api().post(`/loading-sheets/${sheet.body.id}/confirm`).set(auth(operator)).send({ lines: [{ lineId: sheet.body.lines[0].id, loaded: true, weightKg: 1000 }] }).expect(201);
    await api().post('/loading-sheets').set(auth(owner)).send({ dispatchId: dispatch.body.id }).expect(400); // one per dispatch
    expect((await api().post(`/loading-sheets/${sheet.body.id}/complete`).set(auth(operator)).expect(201)).body.status).toBe('loaded');
    expect((await api().get(`/dispatches/${dispatch.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('loaded');

    // Gate pass carries the sheet's seal; nothing has moved yet.
    const pass = await api().post('/gate-passes').set(auth(operator)).send({ dispatchId: dispatch.body.id, invoiceNumber: 'INV-001' }).expect(201);
    expect(pass.body).toMatchObject({ status: 'pending', sealNumber: 'SEAL-99', lrNumber: 'LR-7781' });
    expect(pass.body.number).toMatch(/^GP\//);
    expect(await totals()).toEqual({ physical: 100, reserved: 40, available: 60 });

    // §79: the truck leaves, physical drops by 40 and the reservation goes with it.
    const out = await api().post(`/gate-passes/${pass.body.id}/gate-out`).set(auth(operator)).expect(201);
    expect(out.body.status).toBe('gate_out');
    expect(out.body.stockPostedAt).not.toBeNull();
    expect(await totals()).toEqual({ physical: 60, reserved: 0, available: 60 });
    const ledger = await api().get(`/stock/ledger?sourceId=${dispatch.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0]).toMatchObject({ txnType: 'OUTWARD', qtyOut: '40.000', reservedDelta: '-40.000', balancePhysicalQty: '60.000', balanceReservedQty: '0.000' });
    let ro = await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200);
    expect(ro.body.status).toBe('dispatched');
    expect(ro.body.lines[0].dispatchedQty).toBe(40);
    // It cannot leave twice, and a dispatched order can no longer be cancelled.
    await api().post(`/gate-passes/${pass.body.id}/gate-out`).set(auth(owner)).expect(400);
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'too late' }).expect(400);
    await api().post(`/dispatches/${dispatch.body.id}/cancel`).set(auth(owner)).expect(400);

    // POD: status derived from the lines, dispatch and order completed.
    const pod = await api().post('/pods').set(auth(operator)).send({ dispatchId: dispatch.body.id }).expect(201);
    expect(pod.body.number).toMatch(/^POD\//);
    expect(pod.body.lines[0]).toMatchObject({ dispatchedQty: 40, receivedQty: 40 });
    await api().post(`/pods/${pod.body.id}/capture`).set(auth(operator)).send({ lines: [{ lineId: pod.body.lines[0].id, receivedQty: 41 }] }).expect(400);
    await api().post(`/pods/${pod.body.id}/capture`).set(auth(operator)).send({ lines: [{ lineId: pod.body.lines[0].id, receivedQty: 30, damagedQty: 31 }] }).expect(400);
    const captured = await api()
      .post(`/pods/${pod.body.id}/capture`)
      .set(auth(operator))
      .send({ receiverName: 'R. Mehta', lines: [{ lineId: pod.body.lines[0].id, receivedQty: 38, damagedQty: 2, remarks: 'two bags torn' }] })
      .expect(201);
    expect(captured.body.status).toBe('damaged');
    expect(captured.body.lines[0]).toMatchObject({ receivedQty: 38, shortageQty: 2, damagedQty: 2 });
    await api().post(`/pods/${pod.body.id}/capture`).set(auth(owner)).send({}).expect(400); // captured once
    expect((await api().get(`/dispatches/${dispatch.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('completed');
    ro = await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200);
    expect(ro.body.status).toBe('completed');
    // A shortage at the consignee changes nothing in the warehouse.
    expect(await totals()).toEqual({ physical: 60, reserved: 0, available: 60 });

    // The receiver's signature, taken on a phone at the tailgate, reaches
    // the printed POD. Asserted on the HTML rather than the PDF because a
    // PDF's streams are compressed -- what matters is that the template
    // asked for the attachment and the engine inlined it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await api()
      .post('/attachments')
      .set(auth(operator))
      .field('ownerType', 'pod')
      .field('ownerId', pod.body.id)
      .field('category', 'signature')
      .attach('file', png, { filename: 'signature.png', contentType: 'image/png' })
      .expect(201);
    const { DocumentTemplateRegistry } = await import('../documents/document-template.registry');
    const { inlineImages, loadCompanyContext } = await import('../documents/company-context');
    const { AttachmentsService } = await import('../attachments/attachments.service');
    const { withTenant } = await import('../db/tenant-context');
    const { PG_CONNECTION } = await import('../db/db.module');
    const tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    const attachments = app.get(AttachmentsService);
    const podHtml = await withTenant(app.get(PG_CONNECTION), tenantId, async (tx) => {
      const template = app.get(DocumentTemplateRegistry).get('pod');
      const loaded = (await template.loadData(tx, tenantId, pod.body.id))!;
      const images = await inlineImages(tx, tenantId, loaded.imageAttachmentIds, (key) =>
        attachments.readByStorageKey(key),
      );
      const company = await loadCompanyContext(tx, tenantId, (key) => attachments.readByStorageKey(key));
      return template.renderHtml(loaded, { company, qrDataUri: '', qrToken: 'x', images });
    });
    expect(podHtml).toContain('Signed by the receiver');
    expect(podHtml).toContain('data:image/png;base64,');

    // Five templates: packing list, dispatch note, loading sheet, gate pass, POD.
    for (const [path, type] of [
      [`/packing-lists/${packing.body.id}`, 'packing_list'],
      [`/dispatches/${dispatch.body.id}`, 'dispatch_note'],
      [`/loading-sheets/${sheet.body.id}`, 'loading_sheet'],
      [`/gate-passes/${pass.body.id}`, 'gate_pass'],
      [`/pods/${pod.body.id}`, 'pod'],
    ]) {
      const preview = await api().post(`${path}/document/preview`).set(auth(owner)).expect(201);
      expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');
      const committed = await api().post(`${path}/document`).set(auth(owner)).send({}).expect(201);
      expect(committed.body).toMatchObject({ documentType: type, versionNo: 1 });
      expect((await api().get(`/verify/${committed.body.qrToken}`).expect(200)).body.result).toBe('valid');
    }
    // Four documents rendered through headless Chromium make this the
    // slowest test in the suite: the default 5s limit fails it under load
    // rather than because anything is wrong.
  }, 60_000);

  it('posts at dispatch confirmation when the tenant says so, still exactly once, and rolls partial dispatches up', async () => {
    await api().put('/company/settings/workflow.outward_posting_point').set(auth(owner)).send({ value: 'dispatch' }).expect(200);
    const { order } = await pickedOrder(20);
    const lineId = order.lines[0].id;
    expect(await totals()).toEqual({ physical: 60, reserved: 20, available: 40 });

    const first = await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id, lines: [{ releaseOrderLineId: lineId, quantity: 12 }] }).expect(201);
    // The remainder is what is left after the open note's claim.
    const second = await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201);
    expect(second.body.lines[0].quantity).toBe(8);
    await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id, lines: [{ releaseOrderLineId: lineId, quantity: 1 }] }).expect(400);

    const confirmed = await api().post(`/dispatches/${first.body.id}/confirm`).set(auth(owner)).expect(201);
    expect(confirmed.body.status).toBe('gate_out');
    expect(await totals()).toEqual({ physical: 48, reserved: 8, available: 40 });
    expect((await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200)).body.status).toBe('picked');

    // A gate pass afterwards is a paper record: it posts nothing.
    const pass = await api().post('/gate-passes').set(auth(owner)).send({ dispatchId: first.body.id }).expect(201);
    const out = await api().post(`/gate-passes/${pass.body.id}/gate-out`).set(auth(owner)).expect(201);
    expect(out.body.stockPostedAt).toBeNull();
    expect((await api().get(`/stock/ledger?sourceId=${first.body.id}`).set(auth(owner)).expect(200)).body.total).toBe(1);
    expect(await totals()).toEqual({ physical: 48, reserved: 8, available: 40 });

    await api().post(`/dispatches/${second.body.id}/confirm`).set(auth(owner)).expect(201);
    expect(await totals()).toEqual({ physical: 40, reserved: 0, available: 40 });
    expect((await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200)).body.status).toBe('dispatched');
    await api().delete('/company/settings/workflow.outward_posting_point').set(auth(owner)).expect(200);
  });

  it('cancels a draft dispatch with its sheet and pass, freeing the goods for another', async () => {
    const { order } = await pickedOrder(5);
    const dispatch = await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201);
    const edited = await api().patch(`/dispatches/${dispatch.body.id}`).set(auth(owner)).send({ lines: [{ releaseOrderLineId: order.lines[0].id, quantity: 3 }], remarks: 'Split' }).expect(200);
    expect(edited.body.lines[0].quantity).toBe(3);
    // The other 2 are free for a second note now, but not 3.
    await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id, lines: [{ releaseOrderLineId: order.lines[0].id, quantity: 3 }] }).expect(400);
    const sheet = await api().post('/loading-sheets').set(auth(owner)).send({ dispatchId: dispatch.body.id }).expect(201);
    const pass = await api().post('/gate-passes').set(auth(owner)).send({ dispatchId: dispatch.body.id }).expect(201);
    // Lines are frozen under an open sheet, whose lines are copies of them.
    const frozen = await api().patch(`/dispatches/${dispatch.body.id}`).set(auth(owner)).send({ lines: [{ releaseOrderLineId: order.lines[0].id, quantity: 4 }] }).expect(400);
    expect(frozen.body.message).toMatch(/is open against this dispatch/);
    await api().patch(`/dispatches/${dispatch.body.id}`).set(auth(owner)).send({ remarks: 'Header edits are fine' }).expect(200);
    await api().post(`/dispatches/${dispatch.body.id}/cancel`).set(auth(owner)).expect(201);
    expect((await api().get(`/loading-sheets/${sheet.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('cancelled');
    expect((await api().get(`/gate-passes/${pass.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('cancelled');
    await api().patch(`/dispatches/${dispatch.body.id}`).set(auth(owner)).send({ remarks: 'x' }).expect(400);

    const again = await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201);
    expect(again.body.lines[0].quantity).toBe(5);
    // The one-per-dispatch keys are freed with the cancellation.
    await api().post('/loading-sheets').set(auth(owner)).send({ dispatchId: again.body.id }).expect(201);
    await api().post('/gate-passes').set(auth(owner)).send({ dispatchId: again.body.id }).expect(201);
    // Stock is untouched throughout: only gate-out moves it.
    expect(await totals()).toEqual({ physical: 40, reserved: 5, available: 35 });
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(400); // a note is open
    await api().post(`/dispatches/${again.body.id}/cancel`).set(auth(owner)).expect(201);
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);
    expect(await totals()).toEqual({ physical: 40, reserved: 0, available: 40 });
  });

  it('keeps gate-out to its permission, filters, and isolates tenants', async () => {
    const { order } = await pickedOrder(2);
    const dispatch = await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201);
    const pass = await api().post('/gate-passes').set(auth(owner)).send({ dispatchId: dispatch.body.id }).expect(201);

    const completed = await api().get('/dispatches?status=completed').set(auth(owner)).expect(200);
    expect(completed.body.total).toBe(1);
    expect((await api().get(`/gate-passes?dispatchId=${dispatch.body.id}`).set(auth(owner)).expect(200)).body.total).toBe(1);
    expect((await api().get('/pods?status=damaged').set(auth(owner)).expect(200)).body.total).toBe(1);
    expect((await api().get(`/loading-sheets?q=LS/`).set(auth(owner)).expect(200)).body.total).toBeGreaterThan(0);
    expect((await api().get(`/packing-lists?releaseOrderId=${order.id}`).set(auth(owner)).expect(200)).body.total).toBe(0);

    expect((await api().get('/dispatches').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get(`/dispatches/${dispatch.body.id}`).set(auth(otherOwner)).expect(404);
    await api().post('/gate-passes').set(auth(otherOwner)).send({ dispatchId: dispatch.body.id }).expect(404);
    await api().post(`/gate-passes/${pass.body.id}/gate-out`).set(auth(otherOwner)).expect(404);
    await api().post('/pods').set(auth(otherOwner)).send({ dispatchId: dispatch.body.id }).expect(404);
    await api().get('/dispatches').expect(401);

    // A picked order cancels, but not while a dispatch note is open against it.
    const blocked = await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'cleanup' }).expect(400);
    expect(blocked.body.message).toMatch(/is open against this order/);
    await api().post(`/dispatches/${dispatch.body.id}/cancel`).set(auth(owner)).expect(201);
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'cleanup' }).expect(201);
  });
});
