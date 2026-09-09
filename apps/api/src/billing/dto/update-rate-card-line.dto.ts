import { PartialType } from '@nestjs/mapped-types';
import { CreateRateCardLineDto } from './create-rate-card-line.dto';

export class UpdateRateCardLineDto extends PartialType(CreateRateCardLineDto) {}
