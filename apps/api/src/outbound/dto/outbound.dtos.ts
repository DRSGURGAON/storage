import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class PagedQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

// ---------- Packing List (§32) ----------

export class PackingListLineDto {
  @IsUUID() productId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @IsOptional() @IsInt() @Min(0) packages?: number;
  @IsOptional() @IsString() boxNumber?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) weightKg?: number;
  @IsOptional() @IsString() remarks?: string;
}

export class CreatePackingListDto {
  @IsUUID() releaseOrderId!: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsInt() @Min(0) totalPackages?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) totalWeightKg?: number;
  @IsOptional() @IsString() remarks?: string;
  /** Defaults to one line per release order line, for what has been picked. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PackingListLineDto)
  lines?: PackingListLineDto[];
}

export class ListPackingListsQuery extends PagedQuery {
  @IsOptional() @IsUUID() releaseOrderId?: string;
  @IsOptional() @IsUUID() customerId?: string;
}

// ---------- Dispatch (§33) ----------

export class DispatchLineDto {
  @IsUUID() releaseOrderLineId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
}

export class CreateDispatchDto {
  @IsUUID() releaseOrderId!: string;
  @IsOptional() @IsDateString() dispatchDate?: string;
  @IsOptional() @IsUUID() pickListId?: string;
  @IsOptional() @IsUUID() packingListId?: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() lrNumber?: string;
  @IsOptional() @IsDateString() lrDate?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() transporterId?: string;
  @IsOptional() @IsString() ewayBillNumber?: string;
  @IsOptional() @IsDateString() ewayBillDate?: string;
  @IsOptional() @IsInt() @Min(0) totalPackages?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) totalWeightKg?: number;
  @IsOptional() @IsString() remarks?: string;
  /** Defaults to everything picked and not yet dispatched on the order. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispatchLineDto)
  lines?: DispatchLineDto[];
}

export class UpdateDispatchDto {
  @IsOptional() @IsDateString() dispatchDate?: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() lrNumber?: string;
  @IsOptional() @IsDateString() lrDate?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() transporterId?: string;
  @IsOptional() @IsString() ewayBillNumber?: string;
  @IsOptional() @IsDateString() ewayBillDate?: string;
  @IsOptional() @IsInt() @Min(0) totalPackages?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) totalWeightKg?: number;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispatchLineDto)
  lines?: DispatchLineDto[];
}

export const DISPATCH_STATUSES = ['draft', 'loaded', 'gate_out', 'completed', 'cancelled'] as const;

export class ListDispatchesQuery extends PagedQuery {
  @IsOptional() @IsUUID() releaseOrderId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(DISPATCH_STATUSES) status?: (typeof DISPATCH_STATUSES)[number];
}

// ---------- Loading Sheet (§34) ----------

export class CreateLoadingSheetDto {
  @IsUUID() dispatchId!: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() sealNumber?: string;
}

export class LoadingLineDto {
  @IsUUID() lineId!: string;
  @IsBoolean() loaded!: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) weightKg?: number;
}

export class ConfirmLoadingDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LoadingLineDto)
  lines!: LoadingLineDto[];
  @IsOptional() @IsString() sealNumber?: string;
}

export const LOADING_SHEET_STATUSES = ['pending', 'in_progress', 'loaded', 'cancelled'] as const;

export class ListLoadingSheetsQuery extends PagedQuery {
  @IsOptional() @IsUUID() dispatchId?: string;
  @IsOptional() @IsIn(LOADING_SHEET_STATUSES) status?: (typeof LOADING_SHEET_STATUSES)[number];
}

// ---------- Gate Pass (§35) ----------

export class CreateGatePassDto {
  @IsUUID() dispatchId!: string;
  @IsOptional() @IsUUID() gateEntryId?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() sealNumber?: string;
}

export const GATE_PASS_STATUSES = ['pending', 'gate_out', 'cancelled'] as const;

export class ListGatePassesQuery extends PagedQuery {
  @IsOptional() @IsUUID() dispatchId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(GATE_PASS_STATUSES) status?: (typeof GATE_PASS_STATUSES)[number];
}

// ---------- POD (§36) ----------

export class CreatePodDto {
  @IsUUID() dispatchId!: string;
}

export class PodLineDto {
  @IsUUID() lineId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) receivedQty!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) damagedQty?: number;
  @IsOptional() @IsString() remarks?: string;
}

export class CapturePodDto {
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsString() receiverName?: string;
  @IsOptional() @IsString() receiverMobile?: string;
  @IsOptional() @IsString() remarks?: string;
  /** Lines left out are taken as received in full. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PodLineDto)
  lines?: PodLineDto[];
}

export const POD_STATUSES = ['pending', 'delivered', 'short', 'damaged', 'rejected'] as const;

export class ListPodsQuery extends PagedQuery {
  @IsOptional() @IsUUID() dispatchId?: string;
  @IsOptional() @IsIn(POD_STATUSES) status?: (typeof POD_STATUSES)[number];
}
