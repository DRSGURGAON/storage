import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { DbModule } from './db/db.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { HealthController } from './health/health.controller';
import { NumberingModule } from './numbering/numbering.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbModule,
    AuthModule,
    EntitlementModule,
    NumberingModule,
    CustomersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
