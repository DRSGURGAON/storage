import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * Blueprint §41–§43: correcting an issued invoice with a note, collecting
 * against it without ever double-posting the payment (billing-engine.md
 * §7), and the statement that nets all three into what the customer
 * actually owes.
 */
describe('Notes, payments and the customer statement', () => {
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
  let customerId = '';
  let otherCustomerId = '';
  let taxRateId = '';
  let warehouseId = '';
  let binId = '';
  let productId = '';
  let invoiceA = { id: '', number: '', grandTotal: 0 };
  let invoiceB = { id: '', number: '', grandTotal: 0 };

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const invoiceState = async (id: string) => {
    const body = (await api().get(`/invoices/${id}`).set(auth(billingExec)).expect(200)).body;
    return { status: body.status, amountPaid: body.amountPaid, balanceDue: body.balanceDue };
  };

  const stockUp = async (customer: string, quantity: number) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId: customer, items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: binId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
  };

  /**
   * A real issued invoice over its own window. Each billing period is
   * distinct because a period once invoiced cannot be re-previewed --
   * which is the rule under test in the invoicing suite, and here just
   * means the fixture has to bill different weeks.
   */
  const issuedInvoice = async (customer: string, from: number, to: number) => {
    const run = await api().post('/billing-runs').set(auth(billingExec)).send({ customerId: customer, periodStart: day(from), periodEnd: day(to) }).expect(201);
    const invoice = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: run.body.id }).expect(201);
    await api().post(`/invoices/${invoice.body.id}/submit`).set(auth(billingExec)).expect(201);
    await api().post(`/invoices/${invoice.body.id}/approve`).set(auth(accountant)).expect(201);
    const issued = await api().post(`/invoices/${invoice.body.id}/issue`).set(auth(accountant)).expect(201);
    return { id: issued.body.id, number: issued.body.number, grandTotal: issued.body.grandTotal };
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
        .send({ companyLegalName: 'Receivables Ltd', tenantSlug: `rc-a-${suffix}`, email: `owner-a-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    otherOwner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Other Ltd', tenantSlug: `rc-b-${suffix}`, email: `owner-b-${suffix}@test.local`, fullName: 'Owner', password })
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

    await api().patch('/company').set(auth(owner)).send({ stateCode: '06', gstin: '06AABCU9603R1ZM' }).expect(200);
    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co', legalName: 'Acme Consumer Goods Pvt Ltd', placeOfSupply: '06', creditDays: 15 }).expect(201)).body.id;
    otherCustomerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Bolt Ltd', placeOfSupply: '06' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: 'A' }).expect(201);
    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: zone.body.id }).expect(201);
    binId = (await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: 'B01', parentId: rack.body.id }).expect(201)).body.id;
    productId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;

    const chargeTypes = (await api().get('/charge-types').set(auth(owner)).expect(200)).body as { id: string; code: string }[];
    taxRateId = ((await api().get('/tax-rates').set(auth(owner)).expect(200)).body as { id: string; code: string }[]).find((t) => t.code === 'GST18')!.id;
    const card = await api().post('/rate-cards').set(auth(owner)).send({ code: 'STD', name: 'Standard', scope: 'company', validFrom: day(-365), status: 'active' }).expect(201);
    await api().post(`/rate-cards/${card.body.id}/lines`).set(auth(owner)).send({ chargeTypeId: chargeTypes.find((c) => c.code === 'STORAGE')!.id, basis: 'unit_day', rate: 2 }).expect(201);

    await stockUp(customerId, 100);
    await stockUp(customerId, 50);
    await stockUp(otherCustomerId, 20);
    // Ten days of history in one move, so the two customers' accruals line up.
    await withTenant(sql, tenantId, async (tx) => {
      await tx`update stock_ledger set txn_at = txn_at - interval '10 days' where tenant_id = ${tenantId}`;
      await tx`update grns set approved_at = approved_at - interval '10 days' where tenant_id = ${tenantId}`;
    });
    invoiceA = await issuedInvoice(customerId, -10, -6);
    invoiceB = await issuedInvoice(customerId, -5, -1);
  });

  afterAll(async () => {
    await app.close();
  });

  it('records a payment exactly once however many times the button is clicked', async () => {
    const token = `pay-${suffix}-1`;
    const body = { idempotencyKey: token, customerId, amount: 500, paymentMode: 'neft', referenceNumber: 'UTR-99001' };
    const first = await api().post('/payments').set(auth(billingExec)).send(body).expect(201);
    expect(first.body.number).toMatch(/^RCPT\//);
    expect(first.body.replayed).toBe(false);

    // The retry: same token, and deliberately a *different* amount, which must
    // be ignored rather than posting a second, larger receipt.
    const retry = await api().post('/payments').set(auth(billingExec)).send({ ...body, amount: 9999 }).expect(201);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.amount).toBe(500);
    expect((await api().get(`/payments?customerId=${customerId}`).set(auth(billingExec)).expect(200)).body.total).toBe(1);

    // Unallocated, it sits on account.
    expect(first.body).toMatchObject({ allocatedAmount: 0, unallocatedAmount: 500 });
    await api().post(`/payments/${first.body.id}/cancel`).set(auth(billingExec)).expect(201);
  });

  it('reduces outstanding by recomputing amount_paid, and refuses to over-pay', async () => {
    expect(await invoiceState(invoiceA.id)).toMatchObject({ status: 'issued', amountPaid: 0, balanceDue: invoiceA.grandTotal });

    const part = Math.round(invoiceA.grandTotal / 4);
    const receipt = await api()
      .post('/payments')
      .set(auth(billingExec))
      .send({ idempotencyKey: `pay-${suffix}-2`, customerId, amount: part, paymentMode: 'upi', allocations: [{ invoiceId: invoiceA.id, amount: part }] })
      .expect(201);
    expect(receipt.body).toMatchObject({ allocatedAmount: part, unallocatedAmount: 0 });
    expect(await invoiceState(invoiceA.id)).toMatchObject({ status: 'partially_paid', amountPaid: part, balanceDue: invoiceA.grandTotal - part });

    // A second receipt cannot take the invoice past its total.
    const rest = invoiceA.grandTotal - part;
    const over = await api()
      .post('/payments')
      .set(auth(billingExec))
      .send({ idempotencyKey: `pay-${suffix}-3`, customerId, amount: rest + 100, paymentMode: 'cash', allocations: [{ invoiceId: invoiceA.id, amount: rest + 100 }] })
      .expect(400);
    expect(over.body.message).toMatch(/would over-pay it/);
    // Nothing partial leaked from the refusal.
    expect(await invoiceState(invoiceA.id)).toMatchObject({ amountPaid: part });
    expect((await api().get(`/payments?customerId=${customerId}`).set(auth(billingExec)).expect(200)).body.total).toBe(2);

    // Allocations may not total more than the receipt, nor name one invoice twice.
    await api().post('/payments').set(auth(billingExec)).send({ idempotencyKey: `pay-${suffix}-4`, customerId, amount: 10, paymentMode: 'cash', allocations: [{ invoiceId: invoiceA.id, amount: 11 }] }).expect(400);
    await api().post('/payments').set(auth(billingExec)).send({ idempotencyKey: `pay-${suffix}-5`, customerId, amount: 10, paymentMode: 'cash', allocations: [{ invoiceId: invoiceA.id, amount: 5 }, { invoiceId: invoiceA.id, amount: 5 }] }).expect(400);
    // And not against someone else's invoice.
    await api().post('/payments').set(auth(billingExec)).send({ idempotencyKey: `pay-${suffix}-6`, customerId: otherCustomerId, amount: 10, paymentMode: 'cash', allocations: [{ invoiceId: invoiceA.id, amount: 10 }] }).expect(400);

    // One receipt settling the rest of A and starting on B, allocated after the fact.
    const both = await api()
      .post('/payments')
      .set(auth(billingExec))
      .send({ idempotencyKey: `pay-${suffix}-7`, customerId, amount: rest + 50, paymentMode: 'rtgs' })
      .expect(201);
    const allocated = await api()
      .post(`/payments/${both.body.id}/allocate`)
      .set(auth(billingExec))
      .send({ allocations: [{ invoiceId: invoiceA.id, amount: rest }, { invoiceId: invoiceB.id, amount: 50 }] })
      .expect(201);
    expect(allocated.body.allocations).toHaveLength(2);
    expect(await invoiceState(invoiceA.id)).toMatchObject({ status: 'paid', amountPaid: invoiceA.grandTotal, balanceDue: 0 });
    expect(await invoiceState(invoiceB.id)).toMatchObject({ status: 'partially_paid', amountPaid: 50 });

    // Cancelling that receipt reverses both invoices in one move — recomputed, not decremented.
    await api().post(`/payments/${both.body.id}/cancel`).set(auth(billingExec)).expect(201);
    expect(await invoiceState(invoiceA.id)).toMatchObject({ status: 'partially_paid', amountPaid: part });
    expect(await invoiceState(invoiceB.id)).toMatchObject({ status: 'issued', amountPaid: 0 });
    await api().post(`/payments/${both.body.id}/cancel`).set(auth(billingExec)).expect(400);

    const receiptDoc = await api().post(`/payments/${receipt.body.id}/document`).set(auth(billingExec)).send({}).expect(201);
    expect(receiptDoc.body).toMatchObject({ documentType: 'payment_receipt', documentNumber: receipt.body.number });
    expect((await api().get(`/verify/${receiptDoc.body.qrToken}`).expect(200)).body.result).toBe('valid');
  });

  it('corrects an issued invoice with a credit note, approved above the Billing Executive', async () => {
    // Only an issued invoice gets a note; a draft is corrected directly.
    const draftRun = await api().post('/billing-runs').set(auth(billingExec)).send({ customerId, periodStart: day(-2), periodEnd: day(0) }).expect(201);
    const draftInvoice = await api().post('/invoices').set(auth(billingExec)).send({ billingRunId: draftRun.body.id }).expect(201);
    const early = await api()
      .post('/credit-debit-notes')
      .set(auth(billingExec))
      .send({ noteType: 'credit', customerId, invoiceId: draftInvoice.body.id, reason: 'too early', lines: [{ description: 'x', quantity: 1, rate: 1 }] })
      .expect(400);
    expect(early.body.message).toMatch(/correct it directly/);
    await api().post(`/invoices/${draftInvoice.body.id}/cancel`).set(auth(billingExec)).send({ reason: 'cleanup' }).expect(201);

    const note = await api()
      .post('/credit-debit-notes')
      .set(auth(billingExec))
      .send({
        noteType: 'credit', customerId, invoiceId: invoiceA.number ? invoiceA.id : undefined,
        reason: 'Storage over-charged: two free days were not applied',
        lines: [{ description: 'Storage adjustment', hsnSacCode: '996729', quantity: 100, rate: 2, taxRateId }],
      })
      .expect(201);
    expect(note.body.number).toMatch(/^CN\//);
    expect(note.body).toMatchObject({ noteType: 'credit', status: 'draft', subtotal: 200, taxTotal: 36, grandTotal: 236, invoiceNumber: invoiceA.number });
    // The note does not touch the invoice's own paid/outstanding figures.
    expect(await invoiceState(invoiceA.id)).toMatchObject({ amountPaid: Math.round(invoiceA.grandTotal / 4) });

    await api().post(`/credit-debit-notes/${note.body.id}/approve`).set(auth(accountant)).expect(400); // not submitted
    await api().post(`/credit-debit-notes/${note.body.id}/submit`).set(auth(billingExec)).expect(201);
    await api().post(`/credit-debit-notes/${note.body.id}/approve`).set(auth(billingExec)).expect(403);
    await api().post(`/credit-debit-notes/${note.body.id}/approve`).set(auth(accountant)).expect(201);
    expect((await api().post(`/credit-debit-notes/${note.body.id}/issue`).set(auth(accountant)).expect(201)).body.status).toBe('issued');
    await api().post(`/credit-debit-notes/${note.body.id}/cancel`).set(auth(billingExec)).expect(400);

    const doc = await api().post(`/credit-debit-notes/${note.body.id}/document`).set(auth(billingExec)).send({}).expect(201);
    expect(doc.body).toMatchObject({ documentType: 'credit_note', documentNumber: note.body.number });

    // A debit note is the same document in the other direction, and numbered apart from the dispatch note.
    const debit = await api()
      .post('/credit-debit-notes')
      .set(auth(billingExec))
      .send({ noteType: 'debit', customerId, reason: 'Detention charges, 4 hours', lines: [{ description: 'Vehicle detention', quantity: 4, rate: 250, taxRateId }] })
      .expect(201);
    expect(debit.body.number).toMatch(/^DN2\//);
    expect(debit.body).toMatchObject({ noteType: 'debit', grandTotal: 1180, invoiceId: null });
    for (const step of ['submit', 'approve', 'issue']) {
      await api().post(`/credit-debit-notes/${debit.body.id}/${step}`).set(auth(accountant)).expect(201);
    }
    const debitDoc = await api().post(`/credit-debit-notes/${debit.body.id}/document`).set(auth(billingExec)).send({}).expect(201);
    expect(debitDoc.body.documentType).toBe('debit_note');
  });

  it('nets invoices, notes and payments into a statement that balances', async () => {
    const statement = await api().get(`/customer-statements/${customerId}`).set(auth(accountant)).expect(200);
    const s = statement.body;
    expect(s.customer.legalName).toBe('Acme Consumer Goods Pvt Ltd');
    expect(s.openingBalance).toBe(0);

    const types = s.entries.map((e: { type: string }) => e.type);
    expect(types).toContain('invoice');
    expect(types).toContain('credit_note');
    expect(types).toContain('debit_note');
    expect(types).toContain('payment');
    // The cancelled invoice and the cancelled receipts are not the customer's problem.
    expect(s.entries.every((e: { status: string }) => e.status !== 'cancelled')).toBe(true);

    // Every row's balance is the running total, and the closing balance is the arithmetic.
    const expected = s.totals.invoiced + s.totals.debitNotes - s.totals.creditNotes - s.totals.received;
    expect(s.closingBalance).toBeCloseTo(expected, 2);
    let running = 0;
    for (const e of s.entries) {
      running = Math.round((running + e.debit - e.credit) * 100) / 100;
      expect(e.balance).toBeCloseTo(running, 2);
    }
    expect(s.ageing.notDue).toBeGreaterThan(0);

    // A window starts from an opening balance rather than from zero.
    const windowed = await api().get(`/customer-statements/${customerId}?from=${day(1)}&to=${day(30)}`).set(auth(accountant)).expect(200);
    expect(windowed.body.entries).toHaveLength(0);
    expect(windowed.body.openingBalance).toBeCloseTo(s.closingBalance, 2);
    expect(windowed.body.closingBalance).toBeCloseTo(s.closingBalance, 2);

    const doc = await api().post(`/customer-statements/${customerId}/document`).set(auth(accountant)).send({}).expect(201);
    expect(doc.body).toMatchObject({ documentType: 'customer_statement', versionNo: 1 });
    expect((await api().get(`/verify/${doc.body.qrToken}`).expect(200)).body.result).toBe('valid');
    // Reissuing is a new version of the same statement, not a second document.
    // Regenerating needs `regenerate_document`, which the Accountant does not hold.
    await api().post(`/customer-statements/${customerId}/document`).set(auth(accountant)).send({ regenerate: true }).expect(403);
    const again = await api().post(`/customer-statements/${customerId}/document`).set(auth(billingExec)).send({ regenerate: true }).expect(201);
    expect(again.body.versionNo).toBe(2);
  });

  /**
   * The §55 billing reports read the same rows the statement does, so this
   * checks them against numbers this spec has already asserted rather than
   * against themselves.
   */
  it('gives the billing reports the same numbers the statement has', async () => {
    const statement = (await api().get(`/customer-statements/${customerId}`).set(auth(accountant)).expect(200)).body;
    const run = async (code: string, query: Record<string, string> = {}) =>
      (await api().get(`/reports/run/${code}`).query({ from: day(-60), to: day(1), ...query }).set(auth(accountant)).expect(200)).body;

    const register = await run('invoice_register', { customerId });
    expect(register.rows.map((r: { number: string }) => r.number)).toEqual(
      expect.arrayContaining([invoiceA.number, invoiceB.number]),
    );
    // The register lists cancelled invoices too (it is the numbering
    // record); the statement does not, so the comparison excludes them.
    const live = register.rows
      .filter((r: { status: string }) => r.status !== 'cancelled')
      .reduce((sum: number, r: { grandTotal: number }) => sum + r.grandTotal, 0);
    expect(live).toBeCloseTo(statement.totals.invoiced, 2);
    expect(register.rows.some((r: { status: string }) => r.status === 'cancelled')).toBe(true);

    const collection = await run('collection', { customerId });
    expect(collection.totals.amount).toBeCloseTo(statement.totals.received, 2);
    // Every rupee received here was put against an invoice, so nothing sits on account.
    expect(collection.totals.unallocated).toBeCloseTo(0, 2);

    // Outstanding is unpaid *invoice* balances, which is not the same
    // number as the account's closing balance -- an unapplied credit note
    // moves the second and not the first. It agrees with the register.
    const outstanding = await run('outstanding', { customerId });
    expect(outstanding.rows[0].customer).toBe('Acme Consumer Goods Pvt Ltd');
    const dueFromRegister = register.rows
      .filter((r: { status: string }) => r.status !== 'cancelled')
      .reduce((sum: number, r: { balanceDue: number }) => sum + r.balanceDue, 0);
    expect(outstanding.rows[0].totalDue).toBeCloseTo(dueFromRegister, 2);
    expect(outstanding.rows[0].totalDue).toBeCloseTo(
      outstanding.rows[0].notDue + outstanding.rows[0].due0to30 + outstanding.rows[0].due31to60 +
        outstanding.rows[0].due61to90 + outstanding.rows[0].due90plus,
      2,
    );

    const ledger = await run('customer_statement', { customerId });
    expect(ledger.totals.debit - ledger.totals.credit).toBeCloseTo(statement.closingBalance, 2);

    // Storage is what the billing engine computed, not a re-derivation.
    const storage = await run('storage_charges', { customerId });
    expect(storage.rowCount).toBeGreaterThan(0);
    expect(storage.rows.every((r: { chargeType: string }) => r.chargeType === 'Storage')).toBe(true);

    // And the Warehouse Operator, who holds none of these codes, sees none of them.
    for (const code of ['invoice_register', 'outstanding', 'collection', 'storage_charges']) {
      await api().get(`/reports/run/${code}`).set(auth(operator)).expect(403);
    }
  });

  it('flips an invoice overdue when its due date passes, and back once it is paid', async () => {
    const invoice = await issuedInvoice(otherCustomerId, -10, -1);
    await withTenant(sql, tenantId, (tx) => tx`update invoices set due_date = current_date - 10 where id = ${invoice.id} and tenant_id = ${tenantId}`);

    // Reading the statement brings the flags up to date; the nightly job does the same thing.
    const statement = await api().get(`/customer-statements/${otherCustomerId}`).set(auth(accountant)).expect(200);
    expect(await invoiceState(invoice.id)).toMatchObject({ status: 'overdue' });
    expect(statement.body.ageing.notDue).toBe(0);
    expect(statement.body.ageing.upTo30).toBeCloseTo(invoice.grandTotal, 2);

    // Paying it in full clears the overdue flag, because the money is what decides it.
    await api()
      .post('/payments')
      .set(auth(billingExec))
      .send({ idempotencyKey: `pay-${suffix}-overdue`, customerId: otherCustomerId, amount: invoice.grandTotal, paymentMode: 'neft', allocations: [{ invoiceId: invoice.id, amount: invoice.grandTotal }] })
      .expect(201);
    expect(await invoiceState(invoice.id)).toMatchObject({ status: 'paid', balanceDue: 0 });
    const after = await api().get(`/customer-statements/${otherCustomerId}`).set(auth(accountant)).expect(200);
    expect(after.body.closingBalance).toBeCloseTo(0, 2);
    expect(after.body.ageing).toMatchObject({ notDue: 0, upTo30: 0, upTo60: 0, upTo90: 0, over90: 0 });
  });

  it('keeps receivables off the warehouse floor, filters, and isolates tenants', async () => {
    await api().post('/payments').set(auth(operator)).send({ idempotencyKey: `pay-${suffix}-x`, customerId, amount: 1, paymentMode: 'cash' }).expect(403);
    await api().get('/credit-debit-notes').set(auth(operator)).expect(403);
    await api().get(`/customer-statements/${customerId}`).set(auth(operator)).expect(403);

    expect((await api().get('/credit-debit-notes?noteType=credit').set(auth(billingExec)).expect(200)).body.total).toBe(1);
    expect((await api().get(`/credit-debit-notes?invoiceId=${invoiceA.id}`).set(auth(billingExec)).expect(200)).body.total).toBe(1);
    expect((await api().get('/payments?status=cancelled').set(auth(billingExec)).expect(200)).body.total).toBe(2);
    expect((await api().get(`/payments?from=${day(-30)}&to=${day(-20)}`).set(auth(billingExec)).expect(200)).body.total).toBe(0);

    expect((await api().get('/credit-debit-notes').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    expect((await api().get('/payments').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get(`/customer-statements/${customerId}`).set(auth(otherOwner)).expect(404);
    await api().get('/payments').expect(401);
  });
});
