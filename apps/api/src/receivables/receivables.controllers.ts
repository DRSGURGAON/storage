import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import {
  AllocatePaymentDto,
  CreateNoteDto,
  CreatePaymentDto,
  CustomerStatementQuery,
  ListNotesQuery,
  ListPaymentsQuery,
} from './dto/receivables.dtos';
import { NotesService } from './notes.service';
import { OverdueService } from './overdue.service';
import { PaymentsService } from './payments.service';
import { StatementsService } from './statements.service';

/** `create_credit_debit_note` reaches the Billing Executive; approving one stops at the Accountant, like an invoice. */
@Controller('credit-debit-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotesController {
  constructor(private readonly notes: NotesService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_credit_debit_note')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteDto, @Ip() ip: string) {
    return this.notes.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_credit_debit_note')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotesQuery) {
    return this.notes.list(user, query);
  }
  @Get(':id') @RequirePermission('create_credit_debit_note')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.get(user, id);
  }
  @Post(':id/submit') @RequirePermission('create_credit_debit_note')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.notes.submit(user, id, ip);
  }
  @Post(':id/approve') @RequirePermission('approve_credit_debit_note')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.notes.approve(user, id, ip);
  }
  @Post(':id/issue') @RequirePermission('approve_credit_debit_note')
  issue(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.notes.issue(user, id, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_credit_debit_note')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.notes.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_credit_debit_note')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const note = await this.notes.get(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, note.noteType === 'credit' ? 'credit_note' : 'debit_note', id));
  }
  @Post(':id/document') @RequirePermission('create_credit_debit_note')
  async generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    const note = await this.notes.get(user, id);
    return this.documentEngine.commitDocument(user, note.noteType === 'credit' ? 'credit_note' : 'debit_note', id, { regenerate: dto.regenerate }, ip);
  }
}

@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('record_payment')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentDto, @Ip() ip: string) {
    return this.payments.create(user, dto, ip);
  }
  @Get() @RequirePermission('record_payment')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPaymentsQuery) {
    return this.payments.list(user, query);
  }
  @Get(':id') @RequirePermission('record_payment')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(user, id);
  }
  @Post(':id/allocate') @RequirePermission('record_payment')
  allocate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AllocatePaymentDto, @Ip() ip: string) {
    return this.payments.allocate(user, id, dto, ip);
  }
  @Post(':id/cancel') @RequirePermission('record_payment')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.payments.cancel(user, id, ip);
  }
  @Post(':id/document/preview') @RequirePermission('record_payment')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'payment_receipt', id));
  }
  @Post(':id/document') @RequirePermission('record_payment')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'payment_receipt', id, { regenerate: dto.regenerate }, ip);
  }
}

@Controller('customer-statements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StatementsController {
  constructor(
    private readonly statements: StatementsService,
    private readonly overdue: OverdueService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  /**
   * Ahead of reading a statement, bring the overdue flags up to date: the
   * nightly job is the schedule, not the only path, and a statement that
   * shows an invoice as `issued` two weeks past its due date would be wrong
   * on the one screen where it matters.
   */
  @Get(':customerId') @RequirePermission('view_customer_statement')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('customerId', ParseUUIDPipe) customerId: string, @Query() query: CustomerStatementQuery) {
    await this.overdue.flipOverdue(user.tenantId);
    return this.statements.forCustomer(user, customerId, query);
  }
  @Post(':customerId/document/preview') @RequirePermission('view_customer_statement')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('customerId', ParseUUIDPipe) customerId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.documentEngine.previewDocument(user, 'customer_statement', customerId));
  }
  @Post(':customerId/document') @RequirePermission('view_customer_statement')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'customer_statement', customerId, { regenerate: dto.regenerate }, ip);
  }
}
