import { Controller, Get, Inject } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  @Get()
  async check() {
    const [{ now }] = await this.sql<{ now: Date }[]>`select now()`;
    return {
      status: 'ok',
      db: 'connected',
      serverTime: now,
    };
  }
}
