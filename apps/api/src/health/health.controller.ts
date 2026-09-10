import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';

/**
 * The endpoint a load balancer, a container orchestrator and an uptime
 * monitor all read. Which is why the failure case matters more than the
 * happy one: letting the query throw produced Nest's generic
 * `{"statusCode":500,"message":"Internal server error"}` -- a page that
 * cannot tell you whether the process is wedged, the database is down, or
 * a bug in an unrelated module leaked out.
 *
 * 503 with the reason, instead: the process is up and answering, the
 * dependency is not.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  @Get()
  async check() {
    try {
      const [{ now }] = await this.sql<{ now: Date }[]>`select now()`;
      return { status: 'ok', db: 'connected', serverTime: now };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'disconnected',
        // The driver's own message ("connect ECONNREFUSED 127.0.0.1:5432",
        // "password authentication failed"). It names a host and a port
        // this deployment already knows; the person reading it is whoever
        // is on call, and withholding it costs them the first ten minutes.
        detail: error instanceof Error ? error.message : 'Database unavailable',
      });
    }
  }
}
