import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { ListInspectionsQuery } from './dto/list-inspections.query';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { InspectionsService } from './inspections.service';

/** No `document/*` routes: Inspection is the one Phase 4 record with no document type (see InspectionsService's own note). */
@Controller('inspections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Post()
  @RequirePermission('create_inspection')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInspectionDto, @Ip() ip: string) {
    return this.inspections.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_inspection')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInspectionsQuery) {
    return this.inspections.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_inspection')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('create_inspection')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInspectionDto,
    @Ip() ip: string,
  ) {
    return this.inspections.update(user, id, dto, ip);
  }

  @Post(':id/complete')
  @RequirePermission('create_inspection')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.inspections.complete(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_inspection')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.inspections.cancel(user, id, ip);
  }
}
