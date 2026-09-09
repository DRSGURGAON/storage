import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { DiscrepancyReportsService } from './discrepancy-reports.service';
import { AcknowledgeDiscrepancyDto } from './dto/acknowledge-discrepancy.dto';
import { CreateDiscrepancyReportDto } from './dto/create-discrepancy-report.dto';
import { ListDiscrepancyReportsQuery } from './dto/list-discrepancy-reports.query';
import { UpdateDiscrepancyReportDto } from './dto/update-discrepancy-report.dto';

@Controller('discrepancy-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DiscrepancyReportsController {
  constructor(
    private readonly reports: DiscrepancyReportsService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_discrepancy_report')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDiscrepancyReportDto, @Ip() ip: string) {
    return this.reports.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_discrepancy_report')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDiscrepancyReportsQuery) {
    return this.reports.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_discrepancy_report')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('create_discrepancy_report')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscrepancyReportDto,
    @Ip() ip: string,
  ) {
    return this.reports.update(user, id, dto, ip);
  }

  @Post(':id/submit')
  @RequirePermission('create_discrepancy_report')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.reports.submit(user, id, ip);
  }

  @Post(':id/acknowledge')
  @RequirePermission('create_discrepancy_report')
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcknowledgeDiscrepancyDto,
    @Ip() ip: string,
  ) {
    return this.reports.acknowledge(user, id, dto, ip);
  }

  @Post(':id/close')
  @RequirePermission('create_discrepancy_report')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.reports.close(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_discrepancy_report')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.reports.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_discrepancy_report')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'discrepancy_report', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_discrepancy_report')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'discrepancy_report', id, { regenerate: dto.regenerate }, ip);
  }
}
