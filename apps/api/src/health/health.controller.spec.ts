import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HealthController } from './health.controller';

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

  it('answers 503 with the reason when the database is unreachable, not a bare 500', async () => {
    // The failure path is the one that matters here: a load balancer, an
    // orchestrator and whoever is on call all read this endpoint, and Nest's
    // default `{"statusCode":500,"message":"Internal server error"}` tells
    // none of them whether the process or its database is the problem.
    // A `postgres.Sql` is called as a tagged template, so the stand-in is
    // simply a function that rejects the way the driver does when nothing
    // is listening on the port.
    const failing = (() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432'))) as never;

    await expect(new HealthController(failing).check()).rejects.toMatchObject({
      status: 503,
      response: { status: 'error', db: 'disconnected', detail: 'connect ECONNREFUSED 127.0.0.1:5432' },
    });
  });
});
