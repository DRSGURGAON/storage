import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { DispatchesService } from './dispatches.service';
import {
  CapturePodDto,
  ConfirmLoadingDto,
  CreateDispatchDto,
  CreateGatePassDto,
  CreateLoadingSheetDto,
  CreatePackingListDto,
  CreatePodDto,
  ListDispatchesQuery,
  ListGatePassesQuery,
  ListLoadingSheetsQuery,
  ListPackingListsQuery,
  ListPodsQuery,
  UpdateDispatchDto,
} from './dto/outbound.dtos';
import { GatePassesService } from './gate-passes.service';
import { LoadingSheetsService } from './loading-sheets.service';
import { PackingListsService } from './packing-lists.service';
import { PodsService } from './pods.service';

/**
 * The outbound chain after picking. Every permission here reaches the
 * Warehouse Operator (`permissions-matrix.md`, Operations): this is floor
 * and dock work. Two transitions move stock and ride `confirm_gate_out`
 * whichever document fires them -- gate-out on the pass, and `confirm` on
 * the dispatch for a tenant that posts there.
 */
@Controller('packing-lists')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PackingListsController {
  constructor(private readonly packingLists: PackingListsService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_dispatch')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePackingListDto, @Ip() ip: string) {
    return this.packingLists.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_dispatch')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPackingListsQuery) {
    return this.packingLists.list(user, query);
  }
  @Get(':id') @RequirePermission('create_dispatch')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.packingLists.get(user, id);
  }
  @Post(':id/document/preview') @RequirePermission('create_dispatch')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'packing_list', id));
  }
  @Post(':id/document') @RequirePermission('create_dispatch')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'packing_list', id, { regenerate: dto.regenerate }, ip);
  }
}

@Controller('dispatches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DispatchesController {
  constructor(private readonly dispatches: DispatchesService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_dispatch')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDispatchDto, @Ip() ip: string) {
    return this.dispatches.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_dispatch')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDispatchesQuery) {
    return this.dispatches.list(user, query);
  }
  @Get(':id') @RequirePermission('create_dispatch')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatches.get(user, id);
  }
  @Patch(':id') @RequirePermission('create_dispatch')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDispatchDto, @Ip() ip: string) {
    return this.dispatches.update(user, id, dto, ip);
  }
  @Post(':id/confirm') @RequirePermission('confirm_gate_out')
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.dispatches.confirm(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_dispatch')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.dispatches.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_dispatch')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'dispatch_note', id));
  }
  @Post(':id/document') @RequirePermission('create_dispatch')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'dispatch_note', id, { regenerate: dto.regenerate }, ip);
  }
}

@Controller('loading-sheets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoadingSheetsController {
  constructor(private readonly sheets: LoadingSheetsService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_loading_sheet')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLoadingSheetDto, @Ip() ip: string) {
    return this.sheets.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_loading_sheet')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListLoadingSheetsQuery) {
    return this.sheets.list(user, query);
  }
  @Get(':id') @RequirePermission('create_loading_sheet')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.get(user, id);
  }
  @Post(':id/confirm') @RequirePermission('create_loading_sheet')
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmLoadingDto, @Ip() ip: string) {
    return this.sheets.confirm(user, id, dto, ip);
  }
  @Post(':id/complete') @RequirePermission('create_loading_sheet')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.sheets.complete(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_loading_sheet')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.sheets.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_loading_sheet')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'loading_sheet', id));
  }
  @Post(':id/document') @RequirePermission('create_loading_sheet')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'loading_sheet', id, { regenerate: dto.regenerate }, ip);
  }
}

@Controller('gate-passes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GatePassesController {
  constructor(private readonly gatePasses: GatePassesService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_gate_pass')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGatePassDto, @Ip() ip: string) {
    return this.gatePasses.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_gate_pass')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGatePassesQuery) {
    return this.gatePasses.list(user, query);
  }
  @Get(':id') @RequirePermission('create_gate_pass')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gatePasses.get(user, id);
  }
  @Post(':id/gate-out') @RequirePermission('confirm_gate_out')
  gateOut(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.gatePasses.gateOut(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_gate_pass')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.gatePasses.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_gate_pass')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'gate_pass', id));
  }
  @Post(':id/document') @RequirePermission('create_gate_pass')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'gate_pass', id, { regenerate: dto.regenerate }, ip);
  }
}

@Controller('pods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PodsController {
  constructor(private readonly pods: PodsService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('capture_pod')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePodDto, @Ip() ip: string) {
    return this.pods.create(user, dto, ip);
  }
  @Get() @RequirePermission('capture_pod')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPodsQuery) {
    return this.pods.list(user, query);
  }
  @Get(':id') @RequirePermission('capture_pod')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.pods.get(user, id);
  }
  @Post(':id/capture') @RequirePermission('capture_pod')
  capture(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CapturePodDto, @Ip() ip: string) {
    return this.pods.capture(user, id, dto, ip);
  }
  @Post(':id/document/preview') @RequirePermission('capture_pod')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'pod', id));
  }
  @Post(':id/document') @RequirePermission('capture_pod')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'pod', id, { regenerate: dto.regenerate }, ip);
  }
}
