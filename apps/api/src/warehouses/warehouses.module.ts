import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { LocationsService } from './locations.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [AuditModule, EntitlementModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, LocationsService],
})
export class WarehousesModule {}
