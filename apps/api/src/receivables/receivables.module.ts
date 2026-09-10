import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { NotesService } from './notes.service';
import { OverdueService } from './overdue.service';
import { PaymentsService } from './payments.service';
import { NotesController, PaymentsController, StatementsController } from './receivables.controllers';
import { StatementsService } from './statements.service';

/** Blueprint §41–§43: correcting an issued invoice, collecting against it, and showing the customer where they stand. */
@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [NotesController, PaymentsController, StatementsController],
  providers: [NotesService, PaymentsService, StatementsService, OverdueService],
  exports: [StatementsService, OverdueService],
})
export class ReceivablesModule {}
