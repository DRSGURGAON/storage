import { PartialType } from '@nestjs/mapped-types';
import { CreateQuotationDto } from './create-quotation.dto';

/** Only permitted while the quotation is still 'draft' (QuotationsService enforces this). */
export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}
