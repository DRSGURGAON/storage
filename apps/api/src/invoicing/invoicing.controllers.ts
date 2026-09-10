import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { BillingRunsService } from './billing-runs.service';
import { CancelInvoiceDto, CreateBillingRunDto, CreateInvoiceDto, ListBillingRunsQuery, ListInvoicesQuery } from './dto/invoicing.dtos';
import { InvoicesService } from './invoices.service';

/** `generate_billing_run` and `create_invoice` reach the Billing Executive and Accountant; `approve_invoice` stops at the Accountant. */
@Controller('billing-runs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BillingRunsController {
  constructor(private readonly runs: BillingRunsService) {}

  @Post() @RequirePermission('generate_billing_run')
  generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBillingRunDto, @Ip() ip: string) {
    return this.runs.generate(user, dto, ip);
  }
  @Get() @RequirePermission('generate_billing_run')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBillingRunsQuery) {
    return this.runs.list(user, query);
  }
  @Get(':id') @RequirePermission('generate_billing_run')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(user, id);
  }
  @Post(':id/discard') @RequirePermission('generate_billing_run')
  discard(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.runs.discard(user, id, ip);
  }
}

@Controller('invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_invoice')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto, @Ip() ip: string) {
    return this.invoices.createFromRun(user, dto, ip);
  }
  @Get() @RequirePermission('create_invoice')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInvoicesQuery) {
    return this.invoices.list(user, query);
  }
  @Get(':id') @RequirePermission('create_invoice')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(user, id);
  }
  @Post(':id/submit') @RequirePermission('create_invoice')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.invoices.submit(user, id, ip);
  }
  @Post(':id/approve') @RequirePermission('approve_invoice')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.invoices.approve(user, id, ip);
  }
  @Post(':id/issue') @RequirePermission('approve_invoice')
  issue(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.invoices.issue(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_invoice')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto, @Ip() ip: string) {
    return this.invoices.cancel(user, id, dto.reason, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_invoice')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'invoice', id));
  }
  @Post(':id/document') @RequirePermission('create_invoice')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'invoice', id, { regenerate: dto.regenerate }, ip);
  }
}
