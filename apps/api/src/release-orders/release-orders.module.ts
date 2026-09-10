import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StockModule } from '../stock/stock.module';
import { ReleaseOrdersController } from './release-orders.controller';
import { ReleaseOrdersService } from './release-orders.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule, StockModule],
  controllers: [ReleaseOrdersController],
  providers: [ReleaseOrdersService],
  exports: [ReleaseOrdersService],
})
export class ReleaseOrdersModule {}
