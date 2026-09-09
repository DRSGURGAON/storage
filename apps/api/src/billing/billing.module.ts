import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChargeTypesController } from './charge-types.controller';
import { ChargeTypesService } from './charge-types.service';
import { RateCardLinesService } from './rate-card-lines.service';
import { RateCardResolutionService } from './rate-card-resolution.service';
import { RateCardsController } from './rate-cards.controller';
import { RateCardsService } from './rate-cards.service';
import { TaxRatesController } from './tax-rates.controller';
import { TaxRatesService } from './tax-rates.service';

@Module({
  imports: [AuditModule],
  controllers: [RateCardsController, ChargeTypesController, TaxRatesController],
  providers: [
    RateCardsService,
    RateCardLinesService,
    RateCardResolutionService,
    ChargeTypesService,
    TaxRatesService,
  ],
  // ChargeTypesService/TaxRatesService's exists() and RateCardResolutionService.resolve()
  // are reused by QuotationsService to validate line references and, later, auto-fill rates.
  exports: [ChargeTypesService, TaxRatesService, RateCardResolutionService],
})
export class BillingModule {}
