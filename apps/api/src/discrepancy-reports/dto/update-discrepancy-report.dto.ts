import { PartialType } from '@nestjs/mapped-types';
import { CreateDiscrepancyReportDto } from './create-discrepancy-report.dto';

/** Only permitted while the report is still 'draft' (DiscrepancyReportsService enforces this). */
export class UpdateDiscrepancyReportDto extends PartialType(CreateDiscrepancyReportDto) {}
