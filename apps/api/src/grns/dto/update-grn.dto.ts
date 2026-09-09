import { PartialType } from '@nestjs/mapped-types';
import { CreateGrnDto } from './create-grn.dto';

/** Only permitted while the GRN is still 'draft' (GrnsService enforces this -- blueprint §50: "approved transactions must not be freely editable"). */
export class UpdateGrnDto extends PartialType(CreateGrnDto) {}
