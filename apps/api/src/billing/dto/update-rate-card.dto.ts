import { PartialType } from '@nestjs/mapped-types';
import { CreateRateCardDto } from './create-rate-card.dto';

export class UpdateRateCardDto extends PartialType(CreateRateCardDto) {}
