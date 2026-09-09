import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [AuditModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
