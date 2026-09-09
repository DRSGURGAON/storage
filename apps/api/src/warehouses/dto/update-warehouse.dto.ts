import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateWarehouseDto } from './create-warehouse.dto';

/** The code is the first segment of every materialised location code -- it cannot change after creation. */
export class UpdateWarehouseDto extends PartialType(OmitType(CreateWarehouseDto, ['code'] as const)) {}
