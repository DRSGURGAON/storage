import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CustomersModule } from './customers/customers.module';
import { DbModule } from './db/db.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { HealthController } from './health/health.controller';
import { NumberingModule } from './numbering/numbering.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { ProductsModule } from './products/products.module';
import { TransportModule } from './transport/transport.module';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';

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
    UsersModule,
    WarehousesModule,
    ProductsModule,
    TransportModule,
    BillingModule,
    OnboardingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
