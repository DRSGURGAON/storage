import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { BillingRunsService } from './billing-runs.service';
import { BillingRunsController, InvoicesController } from './invoicing.controllers';
import { InvoicesService } from './invoices.service';

/** Blueprint §38–§40: billing runs derived from operations, and the invoices created from them. */
@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule, BillingModule],
  controllers: [BillingRunsController, InvoicesController],
  providers: [BillingRunsService, InvoicesService],
  // BillingRunsService is exported for the household-storage rent
  // invoice, which composes a run of manual lines rather than deriving one
  // from stock movements a household booking does not have.
  exports: [InvoicesService, BillingRunsService],
})
export class InvoicingModule {}
