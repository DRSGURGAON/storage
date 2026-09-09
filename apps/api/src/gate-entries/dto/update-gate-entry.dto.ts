import { PartialType } from '@nestjs/mapped-types';
import { CreateGateEntryDto } from './create-gate-entry.dto';

/** Only permitted while the gate entry is still 'open' (GateEntriesService enforces this). */
export class UpdateGateEntryDto extends PartialType(CreateGateEntryDto) {}
