import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Integration test against a real database (DATABASE_URL from .env / the
 * environment), not a mock -- this increment's whole point is proving the
 * app actually connects and the reference schema is reachable, so faking
 * the DB layer here would defeat the purpose.
 */
describe('Health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok and a live DB connection', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
    expect(res.body.serverTime).toBeTruthy();
  });
});
