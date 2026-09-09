import { IsString, MinLength } from 'class-validator';

export class TerminateAgreementDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}
