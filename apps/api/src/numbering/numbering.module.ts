import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberSeriesController } from './number-series.controller';
import { NumberSeriesService } from './number-series.service';
import { NumberingService } from './numbering.service';

@Module({
  imports: [AuditModule],
  controllers: [NumberSeriesController],
  providers: [NumberingService, NumberSeriesService],
  exports: [NumberingService, NumberSeriesService],
})
export class NumberingModule {}
