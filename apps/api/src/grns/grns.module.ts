import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StockModule } from '../stock/stock.module';
import { GrnsController } from './grns.controller';
import { GrnsService } from './grns.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule, StockModule],
  controllers: [GrnsController],
  providers: [GrnsService],
})
export class GrnsModule {}
