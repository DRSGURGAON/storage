import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * document-engine.md: the PDF generation/versioning/QR-verification
 * engine, proven here against the Quotation template (the first document
 * type registered). Covers preview vs. commit, idempotent retry, the
 * regenerate -> new-version -> old-version-revoked chain, the public
 * /verify/:qrToken endpoint (valid/revoked/not_found), the Document
 * Centre read endpoints, cross-tenant isolation, permission gating, and
 * the FREE-plan 2-copy paywall (dev-phases.md Phase 3 exit check).
 */
describe('Document engine', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let customerId = '';
  let storageChargeTypeId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  const createQuotation = async (token: string, custId: string, chargeTypeId: string) => {
    const res = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: custId,
        lines: [{ chargeTypeId, description: 'Storage', basis: 'lumpsum', rate: 100 }],
      })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`doc-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`doc-b-${suffix}`, `owner-b-${suffix}@test.local`);

    customerId = (
      await api().post('/customers').set('Authorization', `Bearer ${owner}`).send({ name: 'Acme Co' }).expect(201)
    ).body.id;
    await api()
      .post(`/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ kind: 'billing', addressLine1: '123 Main St', city: 'Gurgaon', isDefault: true })
      .expect(201);
    await api()
      .post(`/customers/${customerId}/contacts`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Rakesh', mobile: '9876543210', isPrimary: true })
      .expect(201);

    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    storageChargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('previews a PDF without writing a document row, and consuming no entitlement', async () => {
    const quotationId = await createQuotation(owner, customerId, storageChargeTypeId);

    const res = await api()
      .post(`/quotations/${quotationId}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.isBuffer(res.body) || res.body instanceof Uint8Array).toBe(true);
    expect(res.body.length).toBeGreaterThan(1000);
    // %PDF magic bytes -- confirms a real PDF, not an error page.
    expect(Buffer.from(res.body).subarray(0, 4).toString()).toBe('%PDF');

    const list = await api()
      .get(`/documents?sourceId=${quotationId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('commits a document, is idempotent on retry, and regenerate creates a new version and revokes the old QR', async () => {
    const quotationId = await createQuotation(owner, customerId, storageChargeTypeId);

    const first = await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(first.body.versionNo).toBe(1);
    expect(first.body.isLatest).toBe(true);
    expect(first.body.documentNumber).toMatch(/^QT\//);
    const firstQrToken = first.body.qrToken;

    // Plain retry (no regenerate): idempotent no-op, same row, no re-render, no re-consumption.
    const retry = await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.versionNo).toBe(1);

    const download = await api()
      .get(`/documents/${first.body.id}/download`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(download.body).subarray(0, 4).toString()).toBe('%PDF');

    const regenerated = await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ regenerate: true })
      .expect(201);
    expect(regenerated.body.versionNo).toBe(2);
    expect(regenerated.body.isLatest).toBe(true);
    expect(regenerated.body.qrToken).not.toBe(firstQrToken);

    const oldVersion = await api()
      .get(`/documents/${first.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(oldVersion.body.isLatest).toBe(false);
    expect(oldVersion.body.supersededByDocumentId).toBe(regenerated.body.id);

    const list = await api()
      .get(`/documents?sourceId=${quotationId}&latestOnly=false`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(list.body).toHaveLength(2);

    const latestOnlyList = await api()
      .get(`/documents?sourceId=${quotationId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(latestOnlyList.body).toHaveLength(1);
    expect(latestOnlyList.body[0].id).toBe(regenerated.body.id);

    // Public verify: current version valid, superseded version revoked, unknown token not_found.
    const validVerify = await api().get(`/verify/${regenerated.body.qrToken}`).expect(200);
    expect(validVerify.body).toMatchObject({ result: 'valid', documentNumber: first.body.documentNumber });
    expect(validVerify.body.issuedBy).toBeTruthy();
    expect(validVerify.body).not.toHaveProperty('lines');
    expect(validVerify.body).not.toHaveProperty('grandTotal');

    const revokedVerify = await api().get(`/verify/${firstQrToken}`).expect(200);
    expect(revokedVerify.body).toMatchObject({ result: 'revoked', documentNumber: first.body.documentNumber });

    const notFoundVerify = await api().get(`/verify/${randomUUID()}`).expect(200);
    expect(notFoundVerify.body).toEqual({ result: 'not_found' });
  });

  it('refuses regenerate when no document has ever been committed for the source', async () => {
    const quotationId = await createQuotation(owner, customerId, storageChargeTypeId);
    await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ regenerate: true })
      .expect(400);
  });

  it('blocks preview and commit with a 402 paywall once the FREE plan 2-copy limit is used up', async () => {
    const slug = `doc-paywall-${suffix}`;
    const email = `owner-paywall-${suffix}@test.local`;
    const paywallOwner = await signup(slug, email);

    const paywallCustomer = (
      await api().post('/customers').set('Authorization', `Bearer ${paywallOwner}`).send({ name: 'Beta Co' }).expect(201)
    ).body.id;
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${paywallOwner}`).expect(200);
    const chargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;

    // Use up the 2 free copies.
    for (let i = 0; i < 2; i++) {
      const quotationId = await createQuotation(paywallOwner, paywallCustomer, chargeTypeId);
      await api()
        .post(`/quotations/${quotationId}/document`)
        .set('Authorization', `Bearer ${paywallOwner}`)
        .send({})
        .expect(201);
    }

    // Third source: both preview and commit are blocked before any PDF is built.
    const thirdQuotationId = await createQuotation(paywallOwner, paywallCustomer, chargeTypeId);

    const previewBlocked = await api()
      .post(`/quotations/${thirdQuotationId}/document/preview`)
      .set('Authorization', `Bearer ${paywallOwner}`)
      .expect(402);
    expect(previewBlocked.body).toMatchObject({
      paywall: true,
      featureCode: 'QUOTATION_GENERATION',
      reason: 'LIMIT_REACHED',
      remaining: 0,
    });

    const commitBlocked = await api()
      .post(`/quotations/${thirdQuotationId}/document`)
      .set('Authorization', `Bearer ${paywallOwner}`)
      .send({})
      .expect(402);
    expect(commitBlocked.body).toMatchObject({ paywall: true, featureCode: 'QUOTATION_GENERATION', reason: 'LIMIT_REACHED' });

    const list = await api()
      .get(`/documents?sourceId=${thirdQuotationId}`)
      .set('Authorization', `Bearer ${paywallOwner}`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it("tenant B cannot view, download, or list tenant A's documents", async () => {
    const quotationId = await createQuotation(owner, customerId, storageChargeTypeId);
    const committed = await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);

    await api().get(`/documents/${committed.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);
    await api().get(`/documents/${committed.body.id}/download`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const otherList = await api()
      .get(`/documents?sourceId=${quotationId}`)
      .set('Authorization', `Bearer ${otherOwner}`)
      .expect(200);
    expect(otherList.body).toHaveLength(0);

    // Cross-tenant document/preview and generate attempts also 404 (the source quotation isn't tenant B's).
    await api().post(`/quotations/${quotationId}/document/preview`).set('Authorization', `Bearer ${otherOwner}`).expect(404);
    await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({})
      .expect(404);
  });

  it('a Warehouse Operator cannot preview or generate a quotation document, but can still view/list via the broad view_documents permission', async () => {
    // A dedicated tenant, not the shared `owner`/`operator` one -- by this point in the
    // file, `owner`'s tenant has already used both of its FREE-plan QUOTATION_GENERATION
    // copies (the "commits a document" and "tenant B cannot see" tests above), and this
    // test needs its own Owner-authenticated commit to succeed so it can assert the
    // *permission* denial specifically, not an unrelated paywall denial.
    const slug = `doc-perm-${suffix}`;
    const permOwner = await signup(slug, `owner-perm-${suffix}@test.local`);
    const opEmail = `op-perm-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${permOwner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' })
      .expect(201);
    const permOperator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body
      .accessToken;

    const permCustomer = (
      await api().post('/customers').set('Authorization', `Bearer ${permOwner}`).send({ name: 'Gamma Co' }).expect(201)
    ).body.id;
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${permOwner}`).expect(200);
    const chargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;

    const quotationId = await createQuotation(permOwner, permCustomer, chargeTypeId);
    const committed = await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${permOwner}`)
      .send({})
      .expect(201);

    // Preview/generate live on the quotation's own routes, gated on view_quotation/
    // create_quotation -- an Operator has neither (permissions-matrix.md).
    await api().post(`/quotations/${quotationId}/document/preview`).set('Authorization', `Bearer ${permOperator}`).expect(403);
    await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${permOperator}`)
      .send({})
      .expect(403);
    // The Document Centre's read side is gated on the broader view_documents instead,
    // which an Operator does hold (documents.controller.ts's own comment on why).
    const viewed = await api().get(`/documents/${committed.body.id}`).set('Authorization', `Bearer ${permOperator}`).expect(200);
    expect(viewed.body.id).toBe(committed.body.id);
    await api().get('/documents').set('Authorization', `Bearer ${permOperator}`).expect(200);
  });

  it('404s a preview/generate/get against a nonexistent source or document id', async () => {
    await api()
      .post(`/quotations/${randomUUID()}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(404);
    await api()
      .post(`/quotations/${randomUUID()}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(404);
    await api().get(`/documents/${randomUUID()}`).set('Authorization', `Bearer ${owner}`).expect(404);
  });

  it('rejects unauthenticated access to documents and quotation document routes, but not the public verify route', async () => {
    await api().get('/documents').expect(401);
    await api().post(`/quotations/${randomUUID()}/document`).send({}).expect(401);
    // No auth required -- verify is deliberately public.
    await api().get(`/verify/${randomUUID()}`).expect(200);
  });
});
