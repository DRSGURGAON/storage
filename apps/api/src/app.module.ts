import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { DbModule } from './db/db.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { HealthController } from './health/health.controller';
import { NumberingModule } from './numbering/numbering.module';
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
