import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreateReturnInwardDto, CreateReturnRequestDto, ListReturnInwardsQuery, ListReturnRequestsQuery, RejectReturnRequestDto } from './dto/returns.dtos';
import { ReturnInwardsService } from './return-inwards.service';
import { ReturnRequestsService } from './return-requests.service';

/**
 * `create_return_request` stops at Warehouse Manager (a Customer raises
 * their own through the portal, Phase 8). Approving a return is a
 * receiving decision and rides `approve_grn`; the arrival itself is
 * inbound floor work and rides `create_grn`, which reaches the Operator.
 */
@Controller('return-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReturnRequestsController {
  constructor(private readonly requests: ReturnRequestsService) {}

  @Post() @RequirePermission('create_return_request')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReturnRequestDto, @Ip() ip: string) {
    return this.requests.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_return_request')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListReturnRequestsQuery) {
    return this.requests.list(user, query);
  }
  @Get(':id') @RequirePermission('create_return_request')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user, id);
  }
  @Post(':id/approve') @RequirePermission('approve_grn')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.requests.approve(user, id, ip);
  }
  @Post(':id/reject') @RequirePermission('approve_grn')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectReturnRequestDto, @Ip() ip: string) {
    return this.requests.reject(user, id, dto.reason, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_return_request')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.requests.cancel(user, id, ip);
  }
}

@Controller('return-inwards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReturnInwardsController {
  constructor(private readonly inwards: ReturnInwardsService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_grn')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReturnInwardDto, @Ip() ip: string) {
    return this.inwards.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_grn')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListReturnInwardsQuery) {
    return this.inwards.list(user, query);
  }
  @Get(':id') @RequirePermission('create_grn')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inwards.get(user, id);
  }
  @Post(':id/inspect') @RequirePermission('create_grn')
  inspect(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.inwards.inspect(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_grn')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.inwards.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_grn')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'return_inward', id));
  }
  @Post(':id/document') @RequirePermission('create_grn')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'return_inward', id, { regenerate: dto.regenerate }, ip);
  }
}
