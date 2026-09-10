import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StockModule } from '../stock/stock.module';
import { DispatchesService } from './dispatches.service';
import { GatePassesService } from './gate-passes.service';
import { LoadingSheetsService } from './loading-sheets.service';
import { OutboundPostingService } from './outbound-posting.service';
import {
  DispatchesController,
  GatePassesController,
  LoadingSheetsController,
  PackingListsController,
  PodsController,
} from './outbound.controllers';
import { PackingListsService } from './packing-lists.service';
import { PodsService } from './pods.service';

/** Blueprint §32–§36: everything between a picked release order and its proof of delivery. */
@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule, StockModule],
  controllers: [PackingListsController, DispatchesController, LoadingSheetsController, GatePassesController, PodsController],
  providers: [OutboundPostingService, PackingListsService, DispatchesService, LoadingSheetsService, GatePassesService, PodsService],
  exports: [OutboundPostingService, DispatchesService],
})
export class OutboundModule {}
