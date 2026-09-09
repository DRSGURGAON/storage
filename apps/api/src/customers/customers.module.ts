import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuditModule, NumberingModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
