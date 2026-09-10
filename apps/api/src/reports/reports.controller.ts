import { Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards, Body } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { AgeingQuery, RunReportQuery, StockStatementQuery } from './dto/report-queries';
import { ReportRunnerService } from './report-runner.service';
import { ReportsService } from './reports.service';

/**
 * `view_reports` for the reads. The Stock Statement *document* rides
 * `view_stock` instead: it is the customer-facing copy of a balance the
 * matrix already lets every internal role see, and the matrix seeds no
 * generate code for it. Its source record is the customer -- a statement
 * is "the statement for customer X", versioned each time it is issued.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly runner: ReportRunnerService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  /**
   * What this caller can actually run. Filtered by their own grants, so
   * the screen offers nothing the API would refuse -- `view_reports` is
   * not the only permission in the catalogue (the document register rides
   * `view_documents`, agreement expiry rides `view_agreement`).
   */
  @Get('catalogue')
  @RequirePermission('view_reports')
  catalogue(@CurrentUser() user: AuthenticatedUser) {
    return this.runner.catalogue(user);
  }

  @Get('run/:code')
  @RequirePermission('view_reports')
  run(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string, @Query() query: RunReportQuery) {
    return this.runner.run(user, code, query);
  }

  /**
   * `export_reports` rather than `view_reports`: a file leaves the
   * building, which `permissions-matrix.md` treats as its own decision
   * (the Operator can read a report on screen and cannot take it home).
   */
  @Get('run/:code/csv')
  @RequirePermission('export_reports')
  async csv(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Query() query: RunReportQuery,
    @Res() res: Response,
  ) {
    const { fileName, csv } = await this.runner.csv(user, code, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  }

  @Get('stock-statement')
  @RequirePermission('view_reports')
  stockStatement(@CurrentUser() user: AuthenticatedUser, @Query() query: StockStatementQuery) {
    return this.reports.stockStatement(user, query);
  }

  @Get('ageing')
  @RequirePermission('view_reports')
  ageing(@CurrentUser() user: AuthenticatedUser, @Query() query: AgeingQuery) {
    return this.reports.ageing(user, query);
  }

  @Post('stock-statement/:customerId/document/preview')
  @RequirePermission('view_stock')
  async previewStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'stock_statement', customerId);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post('stock-statement/:customerId/document')
  @RequirePermission('view_stock')
  generateStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'stock_statement', customerId, { regenerate: dto.regenerate }, ip);
  }
}
