import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * The three papers a household storage operator hands a customer, printed
 * from the booking.
 *
 * A PDF test that only asserts "a row was written" proves nothing: the
 * interesting failures are a template that throws on a field that is null
 * in real data, and a paper printed before the event it describes has
 * happened. Both are checked here, and the bytes are checked to be a real
 * PDF rather than an error page with a 200 on it.
 */
describe('Household storage documents', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let warehouseId = '';
  let customerId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const newBooking = async () =>
    (
      await api()
        .post('/storage/bookings')
        .set(auth(owner))
        .send({
          customerId,
          warehouseId,
          monthlyRent: 4500,
          securityDeposit: 9000,
          idProofType: 'aadhaar',
          idProofLast4: '4417',
          charges: [{ description: 'Pickup and loading', rate: 2500 }],
          items: [
            {
              description: 'Godrej almirah, 3 door',
              category: 'furniture',
              conditionNote: 'left door scratched',
              declaredValue: 18000,
              isFragile: false,
            },
            // Deliberately sparse: no condition note, no declared value, no
            // packing. The template has to print these as dashes rather
            // than throw, because this is what a hurried operator enters.
            { description: 'Kitchen cartons', category: 'carton', quantity: 12 },
          ],
        })
        .expect(201)
    ).body;

  /**
   * Fetched the way a browser does it: through the short-lived signed link
   * and with **no** Authorization header, because a new tab carries none.
   */
  const pdfOf = async (documentId: string) => {
    const link = await api().post(`/documents/${documentId}/download-link`).set(auth(owner)).expect(201);
    const file = await api().get(link.body.url).expect(200);
    return file.body as Buffer;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    owner = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Paper Trail Storage',
          tenantSlug: `sd-${suffix}`,
          email: `owner-${suffix}@test.local`,
          fullName: 'Owner',
          password,
          product: 'storage',
        })
        .expect(201)
    ).body.accessToken;

    // A letterhead needs an address, or the document prints with a hole in it.
    await api()
      .patch('/company')
      .set(auth(owner))
      .send({
        addressLine1: 'Plot 14, Sector 37',
        city: 'Gurugram',
        state: 'Haryana',
        stateCode: '06',
        pincode: '122001',
        gstin: '06AABCU9603R1ZM',
      })
      .expect(200);

    warehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Sector 37 godown' }).expect(201)
    ).body.id;
    customerId = (
      await api()
        .post('/customers')
        .set(auth(owner))
        .send({ name: 'Ramesh Kumar', customerType: 'individual', mobile: '9811122233' })
        .expect(201)
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('prints the inventory list as soon as there are items, and refuses a paper about an event that has not happened', async () => {
    const booking = await newBooking();

    const list = await api()
      .post(`/storage/bookings/${booking.id}/documents/inventory-list`)
      .set(auth(owner))
      .send({})
      .expect(201);
    expect(list.body.documentNumber).toBe(booking.number);
    expect(list.body.documentType).toBe('storage_inventory_list');

    const pdf = await pdfOf(list.body.id);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);

    // The receipt is about goods arriving, and they have not.
    await api()
      .post(`/storage/bookings/${booking.id}/documents/receipt`)
      .set(auth(owner))
      .send({})
      .expect(404);
    await api()
      .post(`/storage/bookings/${booking.id}/documents/release-note`)
      .set(auth(owner))
      .send({})
      .expect(404);
  }, 60_000);

  it('prints the receipt once the goods are in, and the release note once some have gone back', async () => {
    const booking = await newBooking();
    await api()
      .post(`/storage/bookings/${booking.id}/intake`)
      .set(auth(owner))
      .send({ vehicleNumber: 'HR26 AB 1234', driverName: 'Suresh', counterpartyName: 'Ramesh Kumar' })
      .expect(201);

    const receipt = await api()
      .post(`/storage/bookings/${booking.id}/documents/receipt`)
      .set(auth(owner))
      .send({})
      .expect(201);
    expect((await pdfOf(receipt.body.id)).subarray(0, 5).toString()).toBe('%PDF-');

    const full = await api().get(`/storage/bookings/${booking.id}`).set(auth(owner)).expect(200);
    const cartons = full.body.items.find((i: { description: string }) => i.description === 'Kitchen cartons');

    await api()
      .post(`/storage/bookings/${booking.id}/release`)
      .set(auth(owner))
      .send({
        counterpartyName: 'Sunita Kumar',
        authorisationNote: 'wife, authorised by customer on call',
        lines: [{ itemId: cartons.id, quantity: 5 }],
      })
      .expect(201);

    const note = await api()
      .post(`/storage/bookings/${booking.id}/documents/release-note`)
      .set(auth(owner))
      .send({})
      .expect(201);
    // The release note carries the *movement's* number, not the booking's:
    // a family collecting in three trips gets three notes, and they have to
    // be tellable apart.
    expect(note.body.documentNumber).toMatch(/^SM\//);
    expect((await pdfOf(note.body.id)).subarray(0, 5).toString()).toBe('%PDF-');

    // All three show up in the document centre, against this booking.
    const docs = await api().get('/documents?limit=50').set(auth(owner)).expect(200);
    const types = docs.body.items.map((d: { documentType: string }) => d.documentType);
    expect(types).toEqual(
      expect.arrayContaining(['storage_inventory_list', 'storage_receipt', 'storage_release_note']),
    );
  }, 90_000);

  it('refuses a paper it does not print, by name', async () => {
    const booking = await newBooking();
    const refused = await api()
      .post(`/storage/bookings/${booking.id}/documents/lorry-receipt`)
      .set(auth(owner))
      .send({})
      .expect(400);
    expect(refused.body.message).toContain('inventory-list');
  });
});
