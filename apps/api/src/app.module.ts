import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AgreementsModule } from './agreements/agreements.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CompanyModule } from './company/company.module';
import { CustomersModule } from './customers/customers.module';
import { DbModule } from './db/db.module';
import { DiscrepancyReportsModule } from './discrepancy-reports/discrepancy-reports.module';
import { DocumentsModule } from './documents/documents.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { GateEntriesModule } from './gate-entries/gate-entries.module';
import { GrnsModule } from './grns/grns.module';
import { HealthController } from './health/health.controller';
import { InspectionsModule } from './inspections/inspections.module';
import { InwardsModule } from './inwards/inwards.module';
import { NumberingModule } from './numbering/numbering.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { ProductsModule } from './products/products.module';
import { PutawaysModule } from './putaways/putaways.module';
import { StockModule } from './stock/stock.module';
import { StockAdjustmentsModule } from './stock-adjustments/stock-adjustments.module';
import { StockTransfersModule } from './stock-transfers/stock-transfers.module';
import { StockVerificationsModule } from './stock-verifications/stock-verifications.module';
import { QuotationsModule } from './quotations/quotations.module';
import { TransportModule } from './transport/transport.module';
import { UsersModule } from './users/users.module';
import { WarehouseReceiptsModule } from './warehouse-receipts/warehouse-receipts.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ScopedThrottlerGuard, throttlerConfig } from './throttling';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // A broad per-IP ceiling on every route. The credential endpoints add
    // a second, much tighter limit of their own (see AuthThrottlerGuard);
    // both apply, because they defend against different things.
    ThrottlerModule.forRoot(throttlerConfig(process.env)),
    DbModule,
    AuthModule,
    EntitlementModule,
    NumberingModule,
    CompanyModule,
    CustomersModule,
    UsersModule,
    WarehousesModule,
    ProductsModule,
    TransportModule,
    BillingModule,
    OnboardingModule,
    QuotationsModule,
    AgreementsModule,
    DocumentsModule,
    GateEntriesModule,
    InwardsModule,
    GrnsModule,
    InspectionsModule,
    DiscrepancyReportsModule,
    PutawaysModule,
    StockModule,
    StockTransfersModule,
    StockVerificationsModule,
    StockAdjustmentsModule,
    WarehouseReceiptsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ScopedThrottlerGuard }],
})
export class AppModule {}
