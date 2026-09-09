import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgreementsModule } from './agreements/agreements.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
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
import { QuotationsModule } from './quotations/quotations.module';
import { TransportModule } from './transport/transport.module';
import { UsersModule } from './users/users.module';
import { WarehouseReceiptsModule } from './warehouse-receipts/warehouse-receipts.module';
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
    WarehouseReceiptsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
