import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { DocumentTemplateRegistry } from './document-template.registry';
import { DocumentLinkController, DocumentsController } from './documents.controller';
import { DocumentEngineService } from './documents.service';
import { DownloadLinkService } from './download-link.service';
import { PdfRendererService } from './pdf-renderer.service';
import { QrService } from './qr.service';
import { AgreementDocumentTemplate } from './templates/agreement-document.template';
import { DiscrepancyDocumentTemplate } from './templates/discrepancy-document.template';
import { GateEntryDocumentTemplate } from './templates/gate-entry-document.template';
import { GrnDocumentTemplate } from './templates/grn-document.template';
import { InwardDocumentTemplate } from './templates/inward-document.template';
import { PutawayDocumentTemplate } from './templates/putaway-document.template';
import { QuotationDocumentTemplate } from './templates/quotation-document.template';
import { StockTransferDocumentTemplate } from './templates/stock-transfer-document.template';
import { PickListDocumentTemplate } from './templates/pick-list-document.template';
import {
  DispatchNoteDocumentTemplate,
  GatePassDocumentTemplate,
  LoadingSheetDocumentTemplate,
  PackingListDocumentTemplate,
  PodDocumentTemplate,
} from './templates/outbound-document.templates';
import { ReturnInwardDocumentTemplate } from './templates/return-inward-document.template';
import { InvoiceDocumentTemplate } from './templates/invoice-document.template';
import {
  CreditNoteDocumentTemplate,
  CustomerStatementDocumentTemplate,
  DebitNoteDocumentTemplate,
  PaymentReceiptDocumentTemplate,
} from './templates/receivables-document.templates';
import { ReleaseOrderDocumentTemplate } from './templates/release-order-document.template';
import { StockStatementDocumentTemplate } from './templates/stock-statement-document.template';
import { StockVerificationDocumentTemplate } from './templates/stock-verification-document.template';
import { WarehouseReceiptDocumentTemplate } from './templates/warehouse-receipt-document.template';
import { VerifyController, VerifyService } from './verify.controller';

@Module({
  imports: [AttachmentsModule, AuditModule, EntitlementModule],
  controllers: [DocumentsController, DocumentLinkController, VerifyController],
  providers: [
    DocumentEngineService,
    DocumentTemplateRegistry,
    DownloadLinkService,
    PdfRendererService,
    QrService,
    QuotationDocumentTemplate,
    AgreementDocumentTemplate,
    GateEntryDocumentTemplate,
    InwardDocumentTemplate,
    GrnDocumentTemplate,
    DiscrepancyDocumentTemplate,
    PutawayDocumentTemplate,
    WarehouseReceiptDocumentTemplate,
    StockTransferDocumentTemplate,
    StockVerificationDocumentTemplate,
    StockStatementDocumentTemplate,
    ReleaseOrderDocumentTemplate,
    PickListDocumentTemplate,
    PackingListDocumentTemplate,
    DispatchNoteDocumentTemplate,
    LoadingSheetDocumentTemplate,
    GatePassDocumentTemplate,
    PodDocumentTemplate,
    ReturnInwardDocumentTemplate,
    InvoiceDocumentTemplate,
    CreditNoteDocumentTemplate,
    DebitNoteDocumentTemplate,
    PaymentReceiptDocumentTemplate,
    CustomerStatementDocumentTemplate,
    VerifyService,
  ],
  exports: [DocumentEngineService, DownloadLinkService],
})
export class DocumentsModule {}
