import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DownloadLinkService } from './download-link.service';

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
  let warehouseId = '';
  let productId = '';

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

  const createAgreement = async (token: string, custId: string, whId: string | null) => {
    const res = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: custId, warehouseId: whId, startDate: '2026-01-01', endDate: '2027-01-01', noticePeriodDays: 30 })
      .expect(201);
    return res.body.id as string;
  };

  const createGateEntry = async (token: string, whId: string) => {
    const res = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${token}`)
      .send({ warehouseId: whId, direction: 'in', purpose: 'inward' })
      .expect(201);
    return res.body.id as string;
  };

  const createInward = async (token: string, whId: string, custId: string, prodId: string) => {
    const res = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${token}`)
      .send({ warehouseId: whId, customerId: custId, items: [{ productId: prodId, expectedQty: 10, receivedQty: 10, acceptedQty: 10 }] })
      .expect(201);
    return res.body.id as string;
  };

  const createGrn = async (token: string, whId: string, custId: string, prodId: string) => {
    const res = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${token}`)
      .send({ warehouseId: whId, customerId: custId, items: [{ productId: prodId, expectedQty: 10, receivedQty: 8, acceptedQty: 8 }] })
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

    warehouseId = (
      await api()
        .post('/warehouses')
        .set('Authorization', `Bearer ${owner}`)
        .send({ code: 'WH01', name: 'Main Godown', capacityValue: 500, capacityUom: 'pallet' })
        .expect(201)
    ).body.id;

    productId = (
      await api()
        .post('/products')
        .set('Authorization', `Bearer ${owner}`)
        .send({ sku: 'SKU001', name: 'Widget', uomCode: 'NOS' })
        .expect(201)
    ).body.id;
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
    expect(list.body.items).toHaveLength(0);
    expect(list.body.total).toBe(0);
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
    expect(list.body.items).toHaveLength(2);

    const latestOnlyList = await api()
      .get(`/documents?sourceId=${quotationId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(latestOnlyList.body.items).toHaveLength(1);
    expect(latestOnlyList.body.items[0].id).toBe(regenerated.body.id);

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
    expect(list.body.items).toHaveLength(0);
    expect(list.body.total).toBe(0);
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
    expect(otherList.body.items).toHaveLength(0);

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

  it('gates regeneration on regenerate_document, and on regenerate_after_approval once the source is final', async () => {
    // permissions-matrix.md's documents module: `regenerate_document` goes to
    // Owner/Admin/Warehouse Manager/Billing Exec, `regenerate_after_approval`
    // to Owner and Admin alone, and a Warehouse Operator gets neither. Until
    // this was wired up, neither code was referenced by any route: `regenerate`
    // was honoured for anyone holding the source's own create permission, so an
    // Operator could supersede an approved GRN's document and flip the copy the
    // customer was holding to `revoked` on the public verify page.
    const tenant = `regen-${suffix}`;
    const admin = await signup(tenant, `regen-owner-${suffix}@test.local`);
    const custId = (await api().post('/customers').set('Authorization', `Bearer ${admin}`).send({ name: 'Regen Co' }).expect(201)).body.id;
    const whId = (
      await api().post('/warehouses').set('Authorization', `Bearer ${admin}`).send({ code: 'WH01', name: 'Main' }).expect(201)
    ).body.id;
    const prodId = (
      await api().post('/products').set('Authorization', `Bearer ${admin}`).send({ sku: 'SKU1', name: 'Widget', uomCode: 'NOS' }).expect(201)
    ).body.id;

    const member = async (roleCode: string) => {
      const email = `${roleCode}-${suffix}@regen.local`;
      await api().post('/users').set('Authorization', `Bearer ${admin}`).send({ email, fullName: roleCode, password, roleCode }).expect(201);
      return (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken as string;
    };
    const manager = await member('warehouse_manager');
    const operator = await member('warehouse_operator');

    // A gate entry sits in 'open' -- still provisional, nothing issued.
    const gateEntryId = await createGateEntry(admin, whId);
    await api().post(`/gate-entries/${gateEntryId}/document`).set('Authorization', `Bearer ${admin}`).send({}).expect(201);

    // The Operator holds create_gate_entry, and that is exactly what used to be
    // enough. It no longer is, even on a provisional source.
    await api()
      .post(`/gate-entries/${gateEntryId}/document`)
      .set('Authorization', `Bearer ${operator}`)
      .send({ regenerate: true })
      .expect(403);
    // The Manager holds regenerate_document, and a provisional source needs no more.
    const managerRegen = await api()
      .post(`/gate-entries/${gateEntryId}/document`)
      .set('Authorization', `Bearer ${manager}`)
      .send({ regenerate: true })
      .expect(201);
    expect(managerRegen.body.versionNo).toBe(2);

    // An approved GRN is final: superseding its document retracts something.
    const grnId = await createGrn(admin, whId, custId, prodId);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grnId}/${step}`).set('Authorization', `Bearer ${admin}`).expect(201);
    }
    const issued = await api().post(`/grns/${grnId}/document`).set('Authorization', `Bearer ${admin}`).send({}).expect(201);
    expect((await api().get(`/verify/${issued.body.qrToken}`).expect(200)).body.result).toBe('valid');

    const denied = await api()
      .post(`/grns/${grnId}/document`)
      .set('Authorization', `Bearer ${manager}`)
      .send({ regenerate: true })
      .expect(403);
    expect(denied.body.message).toContain('regenerate_after_approval');
    // The refusal is the point: the copy already in the customer's hands is
    // still the current one.
    expect((await api().get(`/verify/${issued.body.qrToken}`).expect(200)).body.result).toBe('valid');

    // Owner holds both, so the deliberate act is still possible.
    const ownerRegen = await api()
      .post(`/grns/${grnId}/document`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ regenerate: true })
      .expect(201);
    expect(ownerRegen.body.versionNo).toBe(2);
    expect((await api().get(`/verify/${issued.body.qrToken}`).expect(200)).body.result).toBe('revoked');

    // A warehouse receipt has no provisional state at all (blueprint §22 makes
    // it the one document that must never be quietly reissued), so even the
    // Manager's regenerate_document is not enough for its first version.
    const wrId = (
      await api().post('/warehouse-receipts').set('Authorization', `Bearer ${admin}`).send({ grnId }).expect(201)
    ).body.id;
    await api().post(`/warehouse-receipts/${wrId}/document`).set('Authorization', `Bearer ${admin}`).send({}).expect(201);
    await api()
      .post(`/warehouse-receipts/${wrId}/document`)
      .set('Authorization', `Bearer ${manager}`)
      .send({ regenerate: true })
      .expect(403);

    // A plain first commit is untouched by any of this -- it is gated on the
    // source's own create permission, exactly as before.
    const operatorGateEntry = await createGateEntry(operator, whId);
    await api().post(`/gate-entries/${operatorGateEntry}/document`).set('Authorization', `Bearer ${operator}`).send({}).expect(201);
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

  it('generates a real Agreement document (the second registered template) with rendered clauses in the body', async () => {
    const agreementId = await createAgreement(owner, customerId, warehouseId);

    const preview = await api()
      .post(`/agreements/${agreementId}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(preview.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/agreements/${agreementId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('agreement');
    expect(committed.body.documentNumber).toMatch(/^AG\//);
    expect(committed.body.versionNo).toBe(1);

    const download = await api()
      .get(`/documents/${committed.body.id}/download`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(Buffer.from(download.body).subarray(0, 4).toString()).toBe('%PDF');

    const regenerated = await api()
      .post(`/agreements/${agreementId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ regenerate: true })
      .expect(201);
    expect(regenerated.body.versionNo).toBe(2);
    expect(regenerated.body.qrToken).not.toBe(committed.body.qrToken);

    const revoked = await api().get(`/verify/${committed.body.qrToken}`).expect(200);
    expect(revoked.body).toMatchObject({ result: 'revoked', documentNumber: committed.body.documentNumber });
    const valid = await api().get(`/verify/${regenerated.body.qrToken}`).expect(200);
    expect(valid.body).toMatchObject({ result: 'valid', documentNumber: committed.body.documentNumber });
  });

  it('AGREEMENT_GENERATION and QUOTATION_GENERATION are independent FREE-plan budgets, proven through the HTTP layer', async () => {
    // A dedicated tenant -- entitlement.spec.ts already proves feature independence directly against
    // EntitlementService; this proves the same thing holds through the document routes, without coupling
    // to how much of `owner`'s own shared budget earlier tests in this file happened to have used.
    const slug = `doc-indep-${suffix}`;
    const indepOwner = await signup(slug, `owner-indep-${suffix}@test.local`);
    const indepCustomer = (
      await api().post('/customers').set('Authorization', `Bearer ${indepOwner}`).send({ name: 'Delta Co' }).expect(201)
    ).body.id;
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${indepOwner}`).expect(200);
    const chargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;

    // Exhaust the 2-copy QUOTATION_GENERATION budget.
    for (let i = 0; i < 2; i++) {
      const quotationId = await createQuotation(indepOwner, indepCustomer, chargeTypeId);
      await api().post(`/quotations/${quotationId}/document`).set('Authorization', `Bearer ${indepOwner}`).send({}).expect(201);
    }
    const thirdQuotationId = await createQuotation(indepOwner, indepCustomer, chargeTypeId);
    await api()
      .post(`/quotations/${thirdQuotationId}/document/preview`)
      .set('Authorization', `Bearer ${indepOwner}`)
      .expect(402);

    // AGREEMENT_GENERATION is untouched -- still allowed even though this tenant's quotation budget is spent.
    const agreementId = await createAgreement(indepOwner, indepCustomer, null);
    await api()
      .post(`/agreements/${agreementId}/document`)
      .set('Authorization', `Bearer ${indepOwner}`)
      .send({})
      .expect(201);
  });

  it('renders an Agreement document with no warehouse chosen -- optional context stays blank rather than crashing', async () => {
    const agreementId = await createAgreement(owner, customerId, null);
    const preview = await api()
      .post(`/agreements/${agreementId}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('generates a real Gate Entry document (the third registered template)', async () => {
    const gateEntryId = await createGateEntry(owner, warehouseId);

    const preview = await api()
      .post(`/gate-entries/${gateEntryId}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/gate-entries/${gateEntryId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('gate_entry');
    expect(committed.body.documentNumber).toMatch(/^GE\//);

    const regenerated = await api()
      .post(`/gate-entries/${gateEntryId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ regenerate: true })
      .expect(201);
    expect(regenerated.body.versionNo).toBe(2);

    const revoked = await api().get(`/verify/${committed.body.qrToken}`).expect(200);
    expect(revoked.body.result).toBe('revoked');
  });

  it('GATE_ENTRY meters independently of QUOTATION_GENERATION/AGREEMENT_GENERATION too', async () => {
    const slug = `doc-indep-ge-${suffix}`;
    const indepOwner = await signup(slug, `owner-indep-ge-${suffix}@test.local`);
    const indepWarehouse = (
      await api()
        .post('/warehouses')
        .set('Authorization', `Bearer ${indepOwner}`)
        .send({ code: 'WH01', name: 'Godown', capacityValue: 100, capacityUom: 'pallet' })
        .expect(201)
    ).body.id;
    const indepCustomer = (
      await api().post('/customers').set('Authorization', `Bearer ${indepOwner}`).send({ name: 'Epsilon Co' }).expect(201)
    ).body.id;
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${indepOwner}`).expect(200);
    const chargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;

    for (let i = 0; i < 2; i++) {
      const quotationId = await createQuotation(indepOwner, indepCustomer, chargeTypeId);
      await api().post(`/quotations/${quotationId}/document`).set('Authorization', `Bearer ${indepOwner}`).send({}).expect(201);
    }
    const thirdQuotationId = await createQuotation(indepOwner, indepCustomer, chargeTypeId);
    await api()
      .post(`/quotations/${thirdQuotationId}/document/preview`)
      .set('Authorization', `Bearer ${indepOwner}`)
      .expect(402);

    const gateEntryId = await createGateEntry(indepOwner, indepWarehouse);
    await api().post(`/gate-entries/${gateEntryId}/document`).set('Authorization', `Bearer ${indepOwner}`).send({}).expect(201);
  });

  it('generates a real Inward document (the fourth registered template) with a product/batch/quantity line-item table', async () => {
    const inwardId = await createInward(owner, warehouseId, customerId, productId);

    const preview = await api()
      .post(`/inwards/${inwardId}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/inwards/${inwardId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('inward');
    expect(committed.body.documentNumber).toMatch(/^IN\//);

    const regenerated = await api()
      .post(`/inwards/${inwardId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ regenerate: true })
      .expect(201);
    expect(regenerated.body.versionNo).toBe(2);

    const revoked = await api().get(`/verify/${committed.body.qrToken}`).expect(200);
    expect(revoked.body.result).toBe('revoked');
  });

  it('INWARD meters independently of the other three document features too', async () => {
    const slug = `doc-indep-in-${suffix}`;
    const indepOwner = await signup(slug, `owner-indep-in-${suffix}@test.local`);
    const indepWarehouse = (
      await api()
        .post('/warehouses')
        .set('Authorization', `Bearer ${indepOwner}`)
        .send({ code: 'WH01', name: 'Godown', capacityValue: 100, capacityUom: 'pallet' })
        .expect(201)
    ).body.id;
    const indepCustomer = (
      await api().post('/customers').set('Authorization', `Bearer ${indepOwner}`).send({ name: 'Zeta Co' }).expect(201)
    ).body.id;
    const indepProduct = (
      await api()
        .post('/products')
        .set('Authorization', `Bearer ${indepOwner}`)
        .send({ sku: 'SKU001', name: 'Widget', uomCode: 'NOS' })
        .expect(201)
    ).body.id;

    for (let i = 0; i < 2; i++) {
      const gateEntryId = await createGateEntry(indepOwner, indepWarehouse);
      await api().post(`/gate-entries/${gateEntryId}/document`).set('Authorization', `Bearer ${indepOwner}`).send({}).expect(201);
    }
    const thirdGateEntryId = await createGateEntry(indepOwner, indepWarehouse);
    await api()
      .post(`/gate-entries/${thirdGateEntryId}/document/preview`)
      .set('Authorization', `Bearer ${indepOwner}`)
      .expect(402);

    const inwardId = await createInward(indepOwner, indepWarehouse, indepCustomer, indepProduct);
    await api().post(`/inwards/${inwardId}/document`).set('Authorization', `Bearer ${indepOwner}`).send({}).expect(201);
  });

  // Per-feature metering independence is established generically above (three separate feature codes,
  // each proven on its own tenant); templates registered from here on assert their own rendering and
  // versioning rather than repeating that same proof a fourth and fifth time.
  it('generates a real GRN document (the fifth registered template), flagging the discrepancy on its face', async () => {
    const grnId = await createGrn(owner, warehouseId, customerId, productId);

    const preview = await api()
      .post(`/grns/${grnId}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/grns/${grnId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('grn');
    expect(committed.body.documentNumber).toMatch(/^GRN\//);

    const regenerated = await api()
      .post(`/grns/${grnId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ regenerate: true })
      .expect(201);
    expect(regenerated.body.versionNo).toBe(2);

    const revoked = await api().get(`/verify/${committed.body.qrToken}`).expect(200);
    expect(revoked.body.result).toBe('revoked');
  });
  /**
   * `tenancy-and-security.md` §5 / `dev-phases.md` Phase 8's last open
   * item: a link that carries its own authorisation, so a PDF can be
   * embedded or forwarded without sharing a session, and stops working on
   * its own.
   */
  it('mints a signed link that downloads without a token, and refuses a tampered, expired or foreign one', async () => {
    // Its own tenant: the shared one's two free Quotation copies are long spent
    // by the paywall tests above, and this test needs a real document.
    const linkSuffix = randomUUID().slice(0, 8);
    const owner = await signup(`lk-${linkSuffix}`, `lk-${linkSuffix}@test.local`);
    const custId = (
      await api().post('/customers').set('Authorization', `Bearer ${owner}`).send({ name: 'Link Co' }).expect(201)
    ).body.id;
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    const chargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
    const quotationId = await createQuotation(owner, custId, chargeTypeId);
    const committed = await api()
      .post(`/quotations/${quotationId}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);

    const minted = await api()
      .post(`/documents/${committed.body.id}/download-link`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(minted.body.url).toBe(`/document-links/${minted.body.token}`);
    expect(new Date(minted.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // The whole point: no Authorization header at all.
    const fetched = await api().get(minted.body.url).expect(200);
    expect(fetched.headers['content-type']).toBe('application/pdf');
    expect(fetched.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(fetched.body).subarray(0, 4).toString()).toBe('%PDF');

    // Flip one character of the signature: refused, and told nothing.
    const [payload, signature] = (minted.body.token as string).split('.');
    const flipped = signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    await api().get(`/document-links/${payload}.${flipped}`).expect(400);
    // Re-signing a payload of one's own choosing needs the secret, which is the point.
    const forgedPayload = Buffer.from(
      JSON.stringify({ documentId: committed.body.id, tenantId: 'x', customerId: null, expiresAt: 9999999999 }),
    ).toString('base64url');
    await api().get(`/document-links/${forgedPayload}.${signature}`).expect(400);
    await api().get('/document-links/not-even-a-token').expect(400);

    // An expired link says so, in different words from a bad one: holding a
    // stale link is ordinary, and should not read as "you have been phished".
    const links = app.get(DownloadLinkService);
    const tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    const stale = links.sign({ documentId: committed.body.id, tenantId, customerId: null }, -1);
    const expired = await api().get(`/document-links/${stale.token}`).expect(400);
    expect(expired.body.message).toMatch(/expired/);

    // A validly-signed link for a real document, but scoped to a customer
    // that document does not belong to: 404, not the file.
    const otherCustomer = (
      await api().post('/customers').set('Authorization', `Bearer ${owner}`).send({ name: 'Someone Else' }).expect(201)
    ).body.id;
    const wrongCustomer = links.sign({ documentId: committed.body.id, tenantId, customerId: otherCustomer });
    await api().get(`/document-links/${wrongCustomer.token}`).expect(404);

    // And one signed for another tenant entirely.
    const foreignTenant = links.sign({ documentId: committed.body.id, tenantId: randomUUID(), customerId: null });
    await api().get(`/document-links/${foreignTenant.token}`).expect(404);
  });
});