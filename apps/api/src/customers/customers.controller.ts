import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CustomerAddressesService } from './customer-addresses.service';
import { CustomerContactsService } from './customer-contacts.service';
import { CustomersService } from './customers.service';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { CreateCustomerContactDto } from './dto/create-customer-contact.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQuery } from './dto/list-customers.query';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import { UpdateCustomerContactDto } from './dto/update-customer-contact.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
    private readonly contacts: CustomerContactsService,
  ) {}

  @Post()
  @RequirePermission('create_customer')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto, @Ip() ip: string) {
    return this.customers.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_customer')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCustomersQuery) {
    return this.customers.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_customer')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_customer')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Ip() ip: string,
  ) {
    return this.customers.update(user, id, dto, ip);
  }

  @Post(':id/addresses')
  @RequirePermission('edit_customer')
  createAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerAddressDto,
    @Ip() ip: string,
  ) {
    return this.addresses.create(user, id, dto, ip);
  }

  @Get(':id/addresses')
  @RequirePermission('view_customer')
  listAddresses(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.addresses.list(user, id);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermission('edit_customer')
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
    @Ip() ip: string,
  ) {
    return this.addresses.update(user, id, addressId, dto, ip);
  }

  @Post(':id/contacts')
  @RequirePermission('edit_customer')
  createContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerContactDto,
    @Ip() ip: string,
  ) {
    return this.contacts.create(user, id, dto, ip);
  }

  @Get(':id/contacts')
  @RequirePermission('view_customer')
  listContacts(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.list(user, id);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermission('edit_customer')
  updateContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateCustomerContactDto,
    @Ip() ip: string,
  ) {
    return this.contacts.update(user, id, contactId, dto, ip);
  }
}
