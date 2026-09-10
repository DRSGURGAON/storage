import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StockVerificationsController } from './stock-verifications.controller';
import { StockVerificationsService } from './stock-verifications.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [StockVerificationsController],
  providers: [StockVerificationsService],
})
export class StockVerificationsModule {}
