import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §11: the SKU master. Covers the three sub-resources (uoms seeded
 * at signup, categories, products) and the two nullable-uniqueness scopes
 * fixed in schema/85_integrity_fixes.sql (shared SKU vs per-customer SKU).
 */
describe('Products (UOMs, Categories, SKUs)', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let customerId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`prod-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`prod-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const opEmail = `op-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    const cust = await api()
      .post('/customers')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Acme Co' })
      .expect(201);
    customerId = cust.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeds 8 default UOMs at signup, and a tenant can add its own', async () => {
    const res = await api().get('/uoms').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(res.body).toHaveLength(8);
    expect(res.body.map((u: { code: string }) => u.code)).toContain('NOS');

    const created = await api()
      .post('/uoms')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'drum', name: 'Drum' })
      .expect(201);
    expect(created.body.code).toBe('DRUM');

    await api().post('/uoms').set('Authorization', `Bearer ${owner}`).send({ code: 'DRUM', name: 'Dup' }).expect(409);
  });

  it('creates categories, including nested ones, and rejects an unknown parent', async () => {
    const parent = await api()
      .post('/product-categories')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Electronics' })
      .expect(201);

    const child = await api()
      .post('/product-categories')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Mobiles', parentId: parent.body.id })
      .expect(201);
    expect(child.body.parentId).toBe(parent.body.id);

    await api()
      .post('/product-categories')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Orphan', parentId: randomUUID() })
      .expect(404);

    const list = await api().get('/product-categories').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(list.body.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Electronics', 'Mobiles']));
  });

  it('creates a shared product and computes volume_cbm server-side from dimensions', async () => {
    const res = await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-001', name: 'Widget', uomCode: 'NOS', lengthCm: 10, widthCm: 20, heightCm: 30 })
      .expect(201);
    expect(res.body.customerId).toBeNull();
    expect(res.body.volumeCbm).toBeCloseTo(0.006);

    // A client-supplied volume_cbm must be ignored -- it's derived, not trusted (schema/10_masters.sql comment).
    const spoofed = await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-002', name: 'No Dims', uomCode: 'NOS' })
      .expect(201);
    expect(spoofed.body.volumeCbm).toBeNull();
  });

  it('recomputes volume_cbm from merged dimensions on a partial update, and leaves it alone otherwise', async () => {
    const created = await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-500', name: 'Box', uomCode: 'NOS', lengthCm: 10, widthCm: 10 })
      .expect(201);
    expect(created.body.volumeCbm).toBeNull();

    const withHeight = await api()
      .patch(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ heightCm: 5 })
      .expect(200);
    expect(withHeight.body.volumeCbm).toBeCloseTo(0.0005);

    const renamed = await api()
      .patch(`/products/${created.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Box Renamed' })
      .expect(200);
    expect(renamed.body.volumeCbm).toBeCloseTo(0.0005);
    expect(renamed.body.name).toBe('Box Renamed');
  });

  it('allows the same SKU as both a shared product and a customer-owned product, but not twice in either scope', async () => {
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-100', name: 'Shared Widget', uomCode: 'NOS' })
      .expect(201);
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-100', name: 'Dup Shared', uomCode: 'NOS' })
      .expect(409);

    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-100', name: 'Customer Widget', uomCode: 'NOS', customerId })
      .expect(201);
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-100', name: 'Dup Customer', uomCode: 'NOS', customerId })
      .expect(409);
  });

  it('validates uomCode, categoryId and customerId references and rejects malformed SKUs', async () => {
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-200', name: 'Bad UOM', uomCode: 'NOPE' })
      .expect(404);
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-201', name: 'Bad Cat', uomCode: 'NOS', categoryId: randomUUID() })
      .expect(404);
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-202', name: 'Bad Cust', uomCode: 'NOS', customerId: randomUUID() })
      .expect(404);
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'bad sku!', name: 'Bad SKU', uomCode: 'NOS' })
      .expect(400);
  });

  it('searches by SKU/name/barcode and filters by customer scope, with pagination', async () => {
    await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SRCH-001', name: 'Findable Gadget', uomCode: 'NOS', barcode: '1234567890' })
      .expect(201);

    const byName = await api().get('/products?q=findable').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byName.body.items.map((p: { sku: string }) => p.sku)).toEqual(['SRCH-001']);

    const byBarcode = await api().get('/products?q=1234567890').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byBarcode.body.items.map((p: { sku: string }) => p.sku)).toEqual(['SRCH-001']);

    const shared = await api().get('/products?customerId=shared').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(shared.body.items.every((p: { customerId: null }) => p.customerId === null)).toBe(true);

    const forCustomer = await api()
      .get(`/products?customerId=${customerId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(forCustomer.body.items.every((p: { customerId: string }) => p.customerId === customerId)).toBe(true);
    expect(forCustomer.body.total).toBeGreaterThan(0);

    const paged = await api().get('/products?limit=1&offset=0').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(paged.body.items).toHaveLength(1);
  });

  it("tenant B cannot see or fetch tenant A's products, and gets its own independent UOM/category/SKU namespace", async () => {
    const created = await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'ISO-001', name: 'Isolation Test', uomCode: 'NOS' })
      .expect(201);

    await api().get(`/products/${created.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const list = await api().get('/products?q=isolation').set('Authorization', `Bearer ${otherOwner}`).expect(200);
    expect(list.body.total).toBe(0);

    // Tenant B has its own 8 seeded UOMs and can reuse the same SKU string.
    const bUoms = await api().get('/uoms').set('Authorization', `Bearer ${otherOwner}`).expect(200);
    expect(bUoms.body).toHaveLength(8);

    await api()
      .post('/products')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ sku: 'ISO-001', name: 'Tenant B Own SKU', uomCode: 'NOS' })
      .expect(201);
  });

  it('an operator can view but not create products, and the denial is audited', async () => {
    await api().get('/products').set('Authorization', `Bearer ${operator}`).expect(200);

    const denied = await api()
      .post('/products')
      .set('Authorization', `Bearer ${operator}`)
      .send({ sku: 'DENY-001', name: 'Should Not Exist', uomCode: 'NOS' })
      .expect(403);
    expect(denied.body.message).toMatch(/create_product/);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/products').expect(401);
    await api().get('/uoms').expect(401);
    await api().get('/product-categories').expect(401);
  });
});
