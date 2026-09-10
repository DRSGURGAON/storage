import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { ReportsController } from './reports.controller';
import { ReportRunnerService } from './report-runner.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuditModule, DocumentsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportRunnerService],
  exports: [ReportsService, ReportRunnerService],
})
export class ReportsModule {}
