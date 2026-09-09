import { IsOptional, IsString } from 'class-validator';

/**
 * Blueprint §19's two acknowledgements. The warehouse side is always the
 * acting user (recorded server-side); the driver side is a typed name,
 * since the driver has no login. `driver_ack_signature_attachment_id`
 * stays null until there is an upload endpoint to fill it.
 */
export class AcknowledgeDiscrepancyDto {
  @IsOptional() @IsString() driverAckName?: string;
}
