import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * The monthly rent invoice.
 *
 * Three things decide whether an operator trusts a bill: a part-month is
 * charged by the day rather than rounded up to a month, the same month
 * cannot be billed twice, and a one-time charge appears on exactly one
 * invoice. All three are tested here against real invoices with real GST
 * on them.
 */
describe('Household storage rent invoices', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let tenantId = '';
  let warehouseId = '';
  let customerId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A booking whose goods arrived on a date we choose, so the arithmetic is checkable. */
  const bookingInStorageSince = async (startDate: string, monthlyRent = 3000) => {
    const booking = (
      await api()
        .post('/storage/bookings')
        .set(auth(owner))
        .send({
          customerId,
          warehouseId,
          monthlyRent,
          charges: [{ description: 'Pickup and loading', rate: 2000 }],
          items: [{ description: 'Household goods', category: 'carton', quantity: 20 }],
        })
        .expect(201)
    ).body;
    await api()
      .post(`/storage/bookings/${booking.id}/intake`)
      .set(auth(owner))
      .send({ movementDate: startDate })
      .expect(201);
    return booking;
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
        .send({
          companyLegalName: 'Rent Book Storage',
          tenantSlug: `rb-${suffix}`,
          email: `owner-${suffix}@test.local`,
          fullName: 'Owner',
          password,
          product: 'storage',
        })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;

    // Paid, so the free plan's three-customer limit is not what this suite
    // is testing.
    await withTenant(sql, tenantId, async (tx) => {
      const [plan] = await tx<{ id: string }[]>`select id from plans where code = 'STORAGE_GODOWN'`;
      await tx`update tenant_subscriptions set plan_id = ${plan.id} where tenant_id = ${tenantId}`;
    });

    await api()
      .patch('/company')
      .set(auth(owner))
      .send({ addressLine1: 'Plot 14', city: 'Gurugram', state: 'Haryana', stateCode: '06', pincode: '122001' })
      .expect(200);

    warehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Main godown' }).expect(201)
    ).body.id;
    customerId = (
      await api()
        .post('/customers')
        .set(auth(owner))
        .send({ name: 'Ramesh Kumar', customerType: 'individual', mobile: '9811100022', stateCode: '06' })
        .expect(201)
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('charges a part-month by the day, not by rounding up to a month', async () => {
    const booking = await bookingInStorageSince('2026-06-20', 3000);

    // 20 June to 30 June is 11 days of a 30-day month: 3000 × 11/30 = 1100.
    const preview = await api()
      .post(`/storage/bookings/${booking.id}/invoice/preview`)
      .set(auth(owner))
      .send({ periodEnd: '2026-06-30' })
      .expect(201);
    expect(preview.body).toMatchObject({
      periodStart: '2026-06-20',
      periodEnd: '2026-06-30',
      days: 11,
      rentAmount: 1100,
    });
    expect(preview.body.description).toBe('Storage rent — Jun 2026 (11 days)');
    // The pickup fee is waiting to ride along.
    expect(preview.body.charges).toHaveLength(1);
    expect(preview.body.subtotal).toBe(3100);

    const raised = await api()
      .post(`/storage/bookings/${booking.id}/invoice`)
      .set(auth(owner))
      .send({ periodEnd: '2026-06-30' })
      .expect(201);
    expect(raised.body.invoice.number).toMatch(/^INV\//);
    // Handed over at the counter, not left in a drafts queue: the owner
    // who raised it is the one who approves invoices.
    expect(raised.body.invoice.status).toBe('issued');
    // 3100 + 18% GST, both halves of it, because customer and godown are
    // in the same state.
    expect(raised.body.invoice.subtotal).toBe(3100);
    expect(raised.body.invoice.cgstAmount).toBe(279);
    expect(raised.body.invoice.sgstAmount).toBe(279);
    expect(raised.body.invoice.igstAmount).toBe(0);
    expect(raised.body.invoice.grandTotal).toBe(3658);
  }, 60_000);

  it('bills the next month in full, and refuses to bill a month twice', async () => {
    const booking = await bookingInStorageSince('2026-07-01', 4500);

    const july = await api()
      .post(`/storage/bookings/${booking.id}/invoice`)
      .set(auth(owner))
      .send({ periodEnd: '2026-07-31' })
      .expect(201);
    expect(july.body).toMatchObject({ periodStart: '2026-07-01', periodEnd: '2026-07-31', rentAmount: 4500 });

    // The same period again: refused, and the message says how far the
    // booking is billed rather than just "no".
    const again = await api()
      .post(`/storage/bookings/${booking.id}/invoice`)
      .set(auth(owner))
      .send({ periodStart: '2026-07-01', periodEnd: '2026-07-31' })
      .expect(400);
    expect(again.body.message).toContain('already billed up to 2026-07-31');

    // August picks up automatically from the day after, with no dates typed.
    const august = await api()
      .post(`/storage/bookings/${booking.id}/invoice`)
      .set(auth(owner))
      .send({ periodEnd: '2026-08-31' })
      .expect(201);
    expect(august.body).toMatchObject({ periodStart: '2026-08-01', periodEnd: '2026-08-31', rentAmount: 4500 });

    // The pickup fee was on July's invoice and is not on August's.
    const invoices = await api().get(`/storage/bookings/${booking.id}/invoices`).set(auth(owner)).expect(200);
    expect(invoices.body).toHaveLength(2);
    const [aug, jul] = invoices.body;
    expect(jul.grandTotal).toBeGreaterThan(aug.grandTotal);
    expect(aug.grandTotal).toBe(5310); // 4500 + 18%
  }, 90_000);

  it('will not bill rent before the goods arrived, or on a booking with no goods at all', async () => {
    const notYet = (
      await api()
        .post('/storage/bookings')
        .set(auth(owner))
        .send({
          customerId,
          warehouseId,
          monthlyRent: 2000,
          items: [{ description: 'Household goods', category: 'carton' }],
        })
        .expect(201)
    ).body;
    const refused = await api()
      .post(`/storage/bookings/${notYet.id}/invoice`)
      .set(auth(owner))
      .send({})
      .expect(400);
    expect(refused.body.message).toContain('goods have not arrived');

    const booking = await bookingInStorageSince('2026-09-10', 2000);
    const early = await api()
      .post(`/storage/bookings/${booking.id}/invoice`)
      .set(auth(owner))
      .send({ periodStart: '2026-09-01', periodEnd: '2026-09-30' })
      .expect(400);
    expect(early.body.message).toContain('only arrived on 2026-09-10');
  }, 60_000);

  it('prints the invoice as a PDF and shows it on the customer statement', async () => {
    const booking = await bookingInStorageSince('2026-05-01', 5000);
    const raised = await api()
      .post(`/storage/bookings/${booking.id}/invoice`)
      .set(auth(owner))
      .send({ periodEnd: '2026-05-31' })
      .expect(201);

    const doc = await api()
      .post(`/invoices/${raised.body.invoice.id}/document`)
      .set(auth(owner))
      .send({})
      .expect(201);
    const link = await api().post(`/documents/${doc.body.id}/download-link`).set(auth(owner)).expect(201);
    const pdf = await api().get(link.body.url).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // And it is money the customer owes, on the same statement the 3PL
    // side uses -- not a parallel ledger.
    const statement = await api()
      .get(`/customer-statements/${customerId}?from=2026-01-01&to=2026-12-31`)
      .set(auth(owner))
      .expect(200);
    const numbers = statement.body.entries.map((e: { number: string }) => e.number);
    expect(numbers).toContain(raised.body.invoice.number);
    // The rent is a debit against the customer, not a credit or a zero row.
    const row = statement.body.entries.find((e: { number: string }) => e.number === raised.body.invoice.number);
    expect(row).toMatchObject({ type: 'invoice', credit: 0 });
    expect(row.debit).toBe(raised.body.invoice.grandTotal);
    expect(statement.body.closingBalance).toBeGreaterThan(0);
  }, 90_000);
});
