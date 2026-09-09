import { IsBoolean, IsOptional } from 'class-validator';

/** Shared by every owning controller's commit-document route (quotations.controller.ts, and later others). */
export class GenerateDocumentDto {
  @IsOptional() @IsBoolean() regenerate?: boolean;
}
