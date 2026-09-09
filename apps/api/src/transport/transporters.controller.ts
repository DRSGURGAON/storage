import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateTransporterDto } from './dto/create-transporter.dto';
import { ListTransportersQuery } from './dto/list-transport.query';
import { UpdateTransporterDto } from './dto/update-transporter.dto';
import { TransportersService } from './transporters.service';

@Controller('transporters')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TransportersController {
  constructor(private readonly transporters: TransportersService) {}

  @Post()
  @RequirePermission('create_transport_master')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTransporterDto, @Ip() ip: string) {
    return this.transporters.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_transport_master')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTransportersQuery) {
    return this.transporters.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_transport_master')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transporters.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_transport_master')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransporterDto,
    @Ip() ip: string,
  ) {
    return this.transporters.update(user, id, dto, ip);
  }
}
