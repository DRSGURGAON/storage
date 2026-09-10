import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentTemplate } from './document-template';
import { AgreementDocumentTemplate } from './templates/agreement-document.template';
import { DiscrepancyDocumentTemplate } from './templates/discrepancy-document.template';
import { GateEntryDocumentTemplate } from './templates/gate-entry-document.template';
import { GrnDocumentTemplate } from './templates/grn-document.template';
import { InwardDocumentTemplate } from './templates/inward-document.template';
import { PutawayDocumentTemplate } from './templates/putaway-document.template';
import { QuotationDocumentTemplate } from './templates/quotation-document.template';
import { StockTransferDocumentTemplate } from './templates/stock-transfer-document.template';
import { StockStatementDocumentTemplate } from './templates/stock-statement-document.template';
import { StockVerificationDocumentTemplate } from './templates/stock-verification-document.template';
import { WarehouseReceiptDocumentTemplate } from './templates/warehouse-receipt-document.template';

/**
 * document-engine.md §2: "Adding a new document type later means adding
 * one template + one data-loader function, not a new rendering
 * pipeline." Registering a new type is a one-line addition to this
 * constructor -- DocumentEngineService never branches on documentType.
 */
@Injectable()
export class DocumentTemplateRegistry {
  private readonly templates = new Map<string, DocumentTemplate>();

  constructor(
    quotationTemplate: QuotationDocumentTemplate,
    agreementTemplate: AgreementDocumentTemplate,
    gateEntryTemplate: GateEntryDocumentTemplate,
    inwardTemplate: InwardDocumentTemplate,
    grnTemplate: GrnDocumentTemplate,
    discrepancyTemplate: DiscrepancyDocumentTemplate,
    putawayTemplate: PutawayDocumentTemplate,
    warehouseReceiptTemplate: WarehouseReceiptDocumentTemplate,
    stockTransferTemplate: StockTransferDocumentTemplate,
    stockVerificationTemplate: StockVerificationDocumentTemplate,
    stockStatementTemplate: StockStatementDocumentTemplate,
  ) {
    this.templates.set(quotationTemplate.documentType, quotationTemplate);
    this.templates.set(agreementTemplate.documentType, agreementTemplate);
    this.templates.set(gateEntryTemplate.documentType, gateEntryTemplate);
    this.templates.set(inwardTemplate.documentType, inwardTemplate);
    this.templates.set(grnTemplate.documentType, grnTemplate);
    this.templates.set(discrepancyTemplate.documentType, discrepancyTemplate);
    this.templates.set(putawayTemplate.documentType, putawayTemplate);
    this.templates.set(warehouseReceiptTemplate.documentType, warehouseReceiptTemplate);
    this.templates.set(stockTransferTemplate.documentType, stockTransferTemplate);
    this.templates.set(stockVerificationTemplate.documentType, stockVerificationTemplate);
    this.templates.set(stockStatementTemplate.documentType, stockStatementTemplate);
  }

  get(documentType: string): DocumentTemplate {
    const template = this.templates.get(documentType);
    if (!template) throw new NotFoundException(`Unknown document type: ${documentType}`);
    return template;
  }
}
