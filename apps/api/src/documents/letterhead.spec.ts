import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import type postgres from 'postgres';
import { AppModule } from '../app.module';
import { AttachmentsService } from '../attachments/attachments.service';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { loadCompanyContext } from './company-context';
import { renderDocumentShell } from './html/layout';

/**
 * document-engine.md §3's header band is "[Logo] Company legal name &
 * GSTIN / …", and the signature block has always drawn a line to sign on.
 * Phase 12a made those three images uploadable; this is the half that
 * prints them.
 */
describe('Letterhead: logo, signature and stamp', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  let storageDir = '';
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let tenantId = '';

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const context = () =>
    withTenant(sql, tenantId, (tx) =>
      loadCompanyContext(tx, tenantId, (key) => app.get(AttachmentsService).readByStorageKey(key)),
    );

  const upload = (category: string) =>
    api()
      .post('/attachments')
      .set(auth())
      .field('ownerType', 'company')
      .field('ownerId', tenantId)
      .field('category', category)
      .attach('file', png, { filename: `${category}.png`, contentType: 'image/png' })
      .expect(201);

  beforeAll(async () => {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'letterhead-'));
    process.env.ATTACHMENTS_DIR = storageDir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Letterhead Ltd', tenantSlug: `lh-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
  });

  afterAll(async () => {
    await app.close();
    if (storageDir) await fs.rm(storageDir, { recursive: true, force: true });
    delete process.env.ATTACHMENTS_DIR;
  });

  const shell = (company: Awaited<ReturnType<typeof context>>) =>
    renderDocumentShell({
      title: 'TAX INVOICE',
      documentNumber: 'INV/26-27/000001',
      dateLabel: 'Date',
      date: '2026-09-10',
      company,
      bodyHtml: '<p>body</p>',
      qrDataUri: '',
      qrToken: 'x',
    });

  it('prints the header and the signature line unchanged when nothing has been uploaded', async () => {
    const company = await context();
    expect(company).toMatchObject({ logoDataUri: null, signatureDataUri: null, stampDataUri: null });
    const html = shell(company);
    expect(html).toContain('Letterhead Ltd');
    // The CSS for these lives in the shared style block either way; what
    // must be absent is an element using it.
    expect(html).not.toContain('class="company-logo"');
    expect(html).not.toContain('class="signature-image"');
    // The blank line to sign on is still there, and still spaced for a pen.
    expect(html).toContain('class="signature-line"');
  });

  it('inlines an uploaded logo, signature and stamp as data URIs and prints them', async () => {
    await upload('logo');
    await upload('signature');
    await upload('stamp');

    const company = await context();
    for (const uri of [company.logoDataUri, company.signatureDataUri, company.stampDataUri]) {
      // A data URI, not a URL: the renderer is a headless browser with no
      // session, so an authenticated `<img src>` would silently fail.
      expect(uri).toMatch(/^data:image\/png;base64,/);
      expect(uri).toContain(png.toString('base64'));
    }

    const html = shell(company);
    expect(html).toContain('class="company-logo"');
    expect(html).toContain('class="signature-image"');
    expect(html).toContain('class="stamp-image"');
    expect(html).toContain('signature-line signature-line-signed');
  });

  it('still renders when the bytes have gone missing under the storage provider', async () => {
    const [row] = await withTenant(sql, tenantId, (tx) => tx<{ storage_key: string }[]>`
      select a.storage_key from attachments a join tenants t on t.logo_attachment_id = a.id
      where t.id = ${tenantId}
    `);
    await fs.rm(path.join(storageDir, row.storage_key), { force: true });

    // A document that fails to render because a logo file was moved would
    // be a paperwork outage caused by decoration.
    const company = await context();
    expect(company.logoDataUri).toBeNull();
    expect(company.signatureDataUri).not.toBeNull();
    expect(shell(company)).toContain('Letterhead Ltd');
  });

  it('reaches a real generated PDF', async () => {
    await upload('logo');
    const customerId = (await api().post('/customers').set(auth()).send({ name: 'Alpha Traders' }).expect(201)).body.id;
    const chargeTypeId = (await api().get('/charge-types').set(auth()).expect(200)).body
      .find((c: { code: string }) => c.code === 'STORAGE').id;
    const quotation = await api().post('/quotations').set(auth())
      .send({ customerId, lines: [{ chargeTypeId, description: 'Storage', basis: 'lumpsum', rate: 100 }] })
      .expect(201);

    const preview = await api().post(`/quotations/${quotation.body.id}/document/preview`).set(auth()).expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');
    expect(Buffer.from(preview.body).length).toBeGreaterThan(1000);
  });
});
