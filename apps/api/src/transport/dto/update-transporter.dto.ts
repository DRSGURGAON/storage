import { PartialType } from '@nestjs/mapped-types';
import { CreateTransporterDto } from './create-transporter.dto';

export class UpdateTransporterDto extends PartialType(CreateTransporterDto) {}
