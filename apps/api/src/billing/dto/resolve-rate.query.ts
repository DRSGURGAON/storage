import { IsOptional, IsString, IsUUID } from 'class-validator';

/** billing-engine.md §3: (tenant, customer, warehouse, charge_type, product?) -> a rate_card_lines row. */
export class ResolveRateQuery {
  @IsUUID()
  customerId!: string;

  @IsOptional() @IsUUID() warehouseId?: string;

  @IsString()
  chargeTypeCode!: string;

  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}
