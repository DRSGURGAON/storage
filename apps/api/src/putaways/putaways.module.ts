import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StockModule } from '../stock/stock.module';
import { PutawaysController } from './putaways.controller';
import { PutawaysService } from './putaways.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule, StockModule],
  controllers: [PutawaysController],
  providers: [PutawaysService],
})
export class PutawaysModule {}
