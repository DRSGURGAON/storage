import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { DiscrepancyReportsController } from './discrepancy-reports.controller';
import { DiscrepancyReportsService } from './discrepancy-reports.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [DiscrepancyReportsController],
  providers: [DiscrepancyReportsService],
})
export class DiscrepancyReportsModule {}
