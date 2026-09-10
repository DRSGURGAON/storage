import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { ConfirmPickDto, CreatePickListDto, ListPickListsQuery } from './dto/pick-list.dtos';
import { PickListsService } from './pick-lists.service';

/** `create_pick_list` / `confirm_pick` share a matrix row and reach the Operator: picking is floor work. */
@Controller('pick-lists')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PickListsController {
  constructor(private readonly pickLists: PickListsService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_pick_list')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePickListDto, @Ip() ip: string) {
    return this.pickLists.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_pick_list')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPickListsQuery) {
    return this.pickLists.list(user, query);
  }
  @Get(':id') @RequirePermission('create_pick_list')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.pickLists.get(user, id);
  }
  @Post(':id/confirm') @RequirePermission('confirm_pick')
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPickDto, @Ip() ip: string) {
    return this.pickLists.confirm(user, id, dto, ip);
  }
  @Post(':id/complete') @RequirePermission('confirm_pick')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.pickLists.complete(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_pick_list')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.pickLists.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_pick_list')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.documentEngine.previewDocument(user, 'pick_list', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }
  @Post(':id/document') @RequirePermission('create_pick_list')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'pick_list', id, { regenerate: dto.regenerate }, ip);
  }
}
