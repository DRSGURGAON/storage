import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CloseGateEntryDto } from './dto/close-gate-entry.dto';
import { CreateGateEntryDto } from './dto/create-gate-entry.dto';
import { ListGateEntriesQuery } from './dto/list-gate-entries.query';
import { UpdateGateEntryDto } from './dto/update-gate-entry.dto';
import { GateEntriesService } from './gate-entries.service';

/**
 * permissions-matrix.md's Operations module seeds only `create_gate_entry`
 * -- unlike Masters/Commercial, there is no separate `view_gate_entry`.
 * Every route here, reads included, rides that one code (the same
 * "no dedicated view/edit code exists" pattern already used for e.g.
 * rate-card lines and customer addresses/contacts).
 */
@Controller('gate-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GateEntriesController {
  constructor(
    private readonly gateEntries: GateEntriesService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_gate_entry')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGateEntryDto, @Ip() ip: string) {
    return this.gateEntries.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_gate_entry')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGateEntriesQuery) {
    return this.gateEntries.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_gate_entry')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gateEntries.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('create_gate_entry')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGateEntryDto,
    @Ip() ip: string,
  ) {
    return this.gateEntries.update(user, id, dto, ip);
  }

  @Post(':id/close')
  @RequirePermission('create_gate_entry')
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseGateEntryDto,
    @Ip() ip: string,
  ) {
    return this.gateEntries.close(user, id, dto, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_gate_entry')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.gateEntries.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_gate_entry')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'gate_entry', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_gate_entry')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'gate_entry', id, { regenerate: dto.regenerate }, ip);
  }
}
