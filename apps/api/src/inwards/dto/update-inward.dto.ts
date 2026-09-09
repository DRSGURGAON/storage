import { PartialType } from '@nestjs/mapped-types';
import { CreateInwardDto } from './create-inward.dto';

/** Only permitted while the inward is still 'draft' (InwardsService enforces this). */
export class UpdateInwardDto extends PartialType(CreateInwardDto) {}
