import { PartialType } from '@nestjs/mapped-types';
import { CreateInspectionDto } from './create-inspection.dto';

/** Only permitted while the inspection is still 'draft' (InspectionsService enforces this). */
export class UpdateInspectionDto extends PartialType(CreateInspectionDto) {}
