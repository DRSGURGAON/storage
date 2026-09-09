import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerContactDto } from './create-customer-contact.dto';

export class UpdateCustomerContactDto extends PartialType(CreateCustomerContactDto) {}
