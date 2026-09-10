import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StockModule } from '../stock/stock.module';
import { StockAdjustmentsController } from './stock-adjustments.controller';
import { StockAdjustmentsService } from './stock-adjustments.service';

@Module({
  imports: [AuditModule, NumberingModule, StockModule],
  controllers: [StockAdjustmentsController],
  providers: [StockAdjustmentsService],
})
export class StockAdjustmentsModule {}
