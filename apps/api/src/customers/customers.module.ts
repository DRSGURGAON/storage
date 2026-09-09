import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { CustomerAddressesService } from './customer-addresses.service';
import { CustomerContactsService } from './customer-contacts.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuditModule, NumberingModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerAddressesService, CustomerContactsService],
})
export class CustomersModule {}
