import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import type postgres from 'postgres';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * The upload path, end to end, against the real filesystem storage
 * provider and the real database — a photo goes up, comes back byte for
 * byte, and is refused to everyone it should be.
 */
describe('Attachments', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  let storageDir = '';
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let otherOwner = '';
  let tenantId = '';
  let customerId = '';
  let otherCustomerId = '';

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${owner}` });

  /** A real 1×1 PNG, not a made-up buffer: the content type has to match what is inside. */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-'));
    process.env.ATTACHMENTS_DIR = storageDir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Attach Ltd', tenantSlug: `at-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;

    await api().post('/users').set(auth())
      .send({ email: `op-${suffix}@test.local`, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: `op-${suffix}@test.local`, password }).expect(201)).body.accessToken;

    customerId = (
      await api().post('/customers').set(auth()).send({ name: 'Alpha Traders' }).expect(201)
    ).body.id;

    // A second workspace, for the cross-tenant cases.
    otherOwner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Other Ltd', tenantSlug: `at2-${suffix}`, email: `other-${suffix}@test.local`, fullName: 'Other', password })
        .expect(201)
    ).body.accessToken;
    otherCustomerId = (
      await api().post('/customers').set({ Authorization: `Bearer ${otherOwner}` }).send({ name: 'Beta Foods' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    if (storageDir) await fs.rm(storageDir, { recursive: true, force: true });
    delete process.env.ATTACHMENTS_DIR;
  });

  const upload = (token: string, fields: Record<string, string>, bytes = png, filename = 'kyc.png', type = 'image/png') => {
    const req = api().post('/attachments').set({ Authorization: `Bearer ${token}` });
    for (const [key, value] of Object.entries(fields)) req.field(key, value);
    return req.attach('file', bytes, { filename, contentType: type });
  };

  let attachmentId = '';

  it('stores a file against a record and reads the same bytes back', async () => {
    const saved = await upload(owner, { ownerType: 'customer', ownerId: customerId, category: 'gst_certificate' }).expect(201);
    expect(saved.body).toMatchObject({
      ownerType: 'customer',
      ownerId: customerId,
      category: 'gst_certificate',
      fileName: 'kyc.png',
      contentType: 'image/png',
      sizeBytes: png.length,
      linkedAs: null,
    });
    attachmentId = saved.body.id;

    const listed = await api().get('/attachments').query({ ownerType: 'customer', ownerId: customerId }).set(auth()).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: attachmentId, uploadedBy: 'Owner' });

    const file = await api().get(`/attachments/${attachmentId}/file`).set(auth()).expect(200);
    expect(Buffer.from(file.body)).toEqual(png);
    expect(file.headers['content-type']).toContain('image/png');
    expect(file.headers['content-disposition']).toBe('inline; filename="kyc.png"');

    // `?download=1` is the only difference between showing and saving.
    const download = await api().get(`/attachments/${attachmentId}/file`).query({ download: '1' }).set(auth()).expect(200);
    expect(download.headers['content-disposition']).toBe('attachment; filename="kyc.png"');

    // And it really is on disk under the storage provider, not in the row.
    const [row] = await withTenant(sql, tenantId, (tx) => tx<{ storage_key: string; sha256: string }[]>`
      select storage_key, sha256 from attachments where id = ${attachmentId}
    `);
    expect(await fs.readFile(path.join(storageDir, row.storage_key))).toEqual(png);
    expect(row.sha256).toHaveLength(64);
  });

  it('needs the permission that governs the record it is attached to', async () => {
    // A warehouse operator holds every operations permission and no
    // masters one beyond viewing, so a customer's KYC document is refused
    // — but the same operator may photograph a gate entry.
    await upload(operator, { ownerType: 'customer', ownerId: customerId, category: 'kyc' }).expect(403);
    await api().get('/attachments').query({ ownerType: 'customer', ownerId: customerId })
      .set({ Authorization: `Bearer ${operator}` })
      .expect(200);
    await api().delete(`/attachments/${attachmentId}`).set({ Authorization: `Bearer ${operator}` }).expect(403);
  });

  it('refuses an owner type nothing can be attached to, an unknown category, and a file type a browser should not be handed', async () => {
    await upload(owner, { ownerType: 'wishlist', ownerId: customerId, category: 'photo' }).expect(400);
    await upload(owner, { ownerType: 'customer', ownerId: customerId, category: 'blackmail' }).expect(400);
    await upload(owner, { ownerType: 'customer', ownerId: customerId, category: 'photo' }, Buffer.from('<script>'), 'x.html', 'text/html')
      .expect(400);
    // The document engine's own rows are not this API's to touch.
    await upload(owner, { ownerType: 'quotation', ownerId: customerId, category: 'document' }).expect(400);
  });

  it('cannot attach to, list, read or delete another workspace', async () => {
    await upload(owner, { ownerType: 'customer', ownerId: otherCustomerId, category: 'photo' }).expect(404);
    const otherAuth = { Authorization: `Bearer ${otherOwner}` };
    expect((await api().get('/attachments').query({ ownerType: 'customer', ownerId: customerId }).set(otherAuth).expect(200)).body)
      .toHaveLength(0);
    await api().get(`/attachments/${attachmentId}/file`).set(otherAuth).expect(404);
    await api().delete(`/attachments/${attachmentId}`).set(otherAuth).expect(404);
  });

  it('points the owning record at a linked category, and unpoints it on delete', async () => {
    // The company letterhead is the cheapest example of the same
    // mechanism a POD signature uses (`pods.signature_attachment_id`).
    const logo = await upload(owner, { ownerType: 'company', ownerId: tenantId, category: 'logo' }, png, 'logo.png').expect(201);
    expect(logo.body.linkedAs).toBe('logo_attachment_id');

    const linked = () => withTenant(sql, tenantId, (tx) => tx<{ logo_attachment_id: string | null }[]>`
      select logo_attachment_id from tenants where id = ${tenantId}
    `);
    expect((await linked())[0].logo_attachment_id).toBe(logo.body.id);

    // A second logo takes the link with it...
    const replacement = await upload(owner, { ownerType: 'company', ownerId: tenantId, category: 'logo' }, png, 'logo2.png').expect(201);
    expect((await linked())[0].logo_attachment_id).toBe(replacement.body.id);

    // ...so deleting the *first* one must not clear a link to the second.
    await api().delete(`/attachments/${logo.body.id}`).set(auth()).expect(200);
    expect((await linked())[0].logo_attachment_id).toBe(replacement.body.id);

    await api().delete(`/attachments/${replacement.body.id}`).set(auth()).expect(200);
    expect((await linked())[0].logo_attachment_id).toBeNull();
  });

  it('deletes the row, the bytes and audits it', async () => {
    const [before] = await withTenant(sql, tenantId, (tx) => tx<{ storage_key: string }[]>`
      select storage_key from attachments where id = ${attachmentId}
    `);
    await api().delete(`/attachments/${attachmentId}`).set(auth()).expect(200);
    // The file goes too: a row deleted on its own leaves bytes behind
    // forever, which on object storage is a bill nobody can explain.
    await expect(fs.stat(path.join(storageDir, before.storage_key))).rejects.toThrow();
    expect((await api().get('/attachments').query({ ownerType: 'customer', ownerId: customerId }).set(auth()).expect(200)).body)
      .toHaveLength(0);
    await api().get(`/attachments/${attachmentId}/file`).set(auth()).expect(404);

    const audited = await withTenant(sql, tenantId, (tx) => tx<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${tenantId} and entity_type = 'attachment'
      order by occurred_at
    `);
    expect(audited.map((a) => a.action)).toContain('create');
    expect(audited.map((a) => a.action)).toContain('delete');
  });
});
