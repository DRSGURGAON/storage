import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { TransportersController } from './transporters.controller';
import { TransportersService } from './transporters.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [AuditModule],
  controllers: [TransportersController, VehiclesController, DriversController],
  providers: [TransportersService, VehiclesService, DriversService],
})
export class TransportModule {}
