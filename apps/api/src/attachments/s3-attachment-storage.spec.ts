import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { chooseStorage } from './attachments.module';
import { LocalFilesystemAttachmentStorage } from './local-filesystem-attachment-storage';
import { S3AttachmentStorage } from './s3-attachment-storage';

/**
 * The S3 adapter, against a real S3 conversation.
 *
 * There is no bucket to point at here, and a mock of `S3Client` would only
 * assert that this file calls the methods this file calls -- it would pass
 * with the key built wrongly, the prefix dropped, the body sent as a
 * string, or a 404 swallowed. So the test stands up a small HTTP server
 * that speaks the object-storage protocol the way MinIO does (path-style
 * addressing, `PUT`/`GET`/`DELETE` on `/bucket/key`) and lets the real AWS
 * SDK sign, serialise and send to it.
 *
 * What that proves: the URL the SDK builds from this adapter's arguments,
 * the bytes that arrive on the wire, the key the object lands under, and
 * what happens on the way back. What it does not prove is AWS's own
 * behaviour -- IAM, bucket policies, eventual consistency. Those need a
 * real bucket, and the deployment doc says so.
 */
describe('S3 attachment storage', () => {
  let server: Server;
  let endpoint = '';
  /** key -> bytes, as the stub's "bucket". */
  const objects = new Map<string, Buffer>();
  /** Every request the SDK actually made, so the test can assert on the wire rather than on intent. */
  const requests: { method: string; path: string; contentLength?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        // Path-style: /<bucket>/<key...>. The query string matters -- the
        // SDK appends `?x-id=PutObject` to every call, and a stub that
        // treated it as part of the key stored every object under a name
        // nothing would ever read back.
        const url = new URL(req.url ?? '/', 'http://stub');
        const [, bucket, ...rest] = url.pathname.split('/');
        const key = rest.map((segment) => decodeURIComponent(segment)).join('/');
        requests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          contentLength: req.headers['content-length'],
        });
        if (bucket !== 'warehouse-test') {
          res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
          return;
        }
        if (req.method === 'PUT') {
          objects.set(key, Buffer.concat(chunks));
          res.writeHead(200, { ETag: '"stub"' }).end();
          return;
        }
        if (req.method === 'GET') {
          const body = objects.get(key);
          if (!body) {
            res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
            return;
          }
          res.writeHead(200, { 'content-length': String(body.length) }).end(body);
          return;
        }
        if (req.method === 'DELETE') {
          // S3 answers 204 whether or not the key was there, which is what
          // makes `remove` idempotent without this adapter checking first.
          objects.delete(key);
          res.writeHead(204).end();
          return;
        }
        res.writeHead(405).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const storage = () =>
    new S3AttachmentStorage({
      bucket: 'warehouse-test',
      region: 'us-east-1',
      endpoint,
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      forcePathStyle: true,
    });

  it('writes, reads back and deletes an object, byte for byte', async () => {
    const s3 = storage();
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const attachmentId = '22222222-2222-4222-8222-222222222222';
    // A real PDF prefix, and a byte above 0x7f: a body sent as a string
    // rather than bytes survives ASCII and corrupts exactly this.
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from([0x00, 0x80, 0xff]), Buffer.from('trailer')]);

    const key = await s3.put(tenantId, attachmentId, 'GRN 26-27/000001 v1.pdf', bytes);

    // The same key shape the filesystem adapter produces, so the two are
    // interchangeable over an existing `attachments` table -- and the
    // slashes and spaces in the file name are gone.
    expect(key).toBe(`${tenantId}/${attachmentId}-GRN_26-27_000001_v1.pdf`);
    expect(objects.get(key)).toEqual(bytes);

    const read = await s3.read(key);
    expect(read).toEqual(bytes);
    expect(read.length).toBe(bytes.length);

    await s3.remove(key);
    expect(objects.has(key)).toBe(false);
    // Missing bytes are not an error on the way out: the row is already gone.
    await expect(s3.remove(key)).resolves.toBeUndefined();
  });

  it('fails loudly when the bytes are not there, rather than returning nothing', async () => {
    // A read that quietly resolved empty would produce a zero-byte PDF
    // download and no error anywhere -- the worst possible answer.
    await expect(storage().read('nobody/here.pdf')).rejects.toThrow();
  });

  it('puts everything under the prefix when one is configured', async () => {
    const s3 = new S3AttachmentStorage({
      bucket: 'warehouse-test',
      region: 'us-east-1',
      endpoint,
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      forcePathStyle: true,
      // Written with slashes at both ends on purpose: a deployment will,
      // and doubling them would scatter objects under an empty path segment.
      prefix: '/warehouse/attachments/',
    });
    const key = await s3.put('tenant', 'att', 'photo.jpg', Buffer.from('jpeg'));

    // The storage_key on the row stays prefix-free -- the prefix is where
    // this deployment keeps its objects, not part of the record. Moving a
    // bucket must not mean rewriting the table.
    expect(key).toBe('tenant/att-photo.jpg');
    expect(objects.has('warehouse/attachments/tenant/att-photo.jpg')).toBe(true);
    expect(await s3.read(key)).toEqual(Buffer.from('jpeg'));

    const wrote = requests.filter((r) => r.method === 'PUT' && r.path.includes('warehouse/attachments'));
    expect(wrote.length).toBeGreaterThan(0);
  });

  describe('choosing an adapter', () => {
    const config = (env: Record<string, string | undefined>) =>
      ({ get: (key: string) => env[key] }) as unknown as ConfigService;

    it('uses the local disk when no bucket is named', () => {
      expect(chooseStorage(config({ ATTACHMENTS_DIR: './storage/attachments' }))).toBeInstanceOf(
        LocalFilesystemAttachmentStorage,
      );
    });

    it('uses S3 as soon as a bucket is named, without a second flag to remember', () => {
      expect(chooseStorage(config({ S3_BUCKET: 'warehouse-test', S3_REGION: 'ap-south-1' }))).toBeInstanceOf(
        S3AttachmentStorage,
      );
    });

    it('lets a staging copy of production\'s environment keep its files local', () => {
      expect(
        chooseStorage(config({ S3_BUCKET: 'warehouse-test', ATTACHMENT_STORAGE: 'local' })),
      ).toBeInstanceOf(LocalFilesystemAttachmentStorage);
    });

    it('refuses to start on s3 with no bucket rather than falling back to a disk', () => {
      // Falling back would give a multi-container deployment a fleet of
      // half-populated directories and a document that 404s depending on
      // which instance answered.
      expect(() => chooseStorage(config({ ATTACHMENT_STORAGE: 's3' }))).toThrow(/S3_BUCKET/);
    });
  });
});
