import { PartialType } from '@nestjs/mapped-types';
import { CreateAgreementDto } from './create-agreement.dto';

/** Only permitted while the agreement is still 'draft' (AgreementsService enforces this). */
export class UpdateAgreementDto extends PartialType(CreateAgreementDto) {}
