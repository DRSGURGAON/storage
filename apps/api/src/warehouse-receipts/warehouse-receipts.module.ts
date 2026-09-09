import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { WarehouseReceiptsController } from './warehouse-receipts.controller';
import { WarehouseReceiptsService } from './warehouse-receipts.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [WarehouseReceiptsController],
  providers: [WarehouseReceiptsService],
})
export class WarehouseReceiptsModule {}
