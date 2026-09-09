import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentTemplate } from './document-template';
import { AgreementDocumentTemplate } from './templates/agreement-document.template';
import { GateEntryDocumentTemplate } from './templates/gate-entry-document.template';
import { QuotationDocumentTemplate } from './templates/quotation-document.template';

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
  ) {
    this.templates.set(quotationTemplate.documentType, quotationTemplate);
    this.templates.set(agreementTemplate.documentType, agreementTemplate);
    this.templates.set(gateEntryTemplate.documentType, gateEntryTemplate);
  }

  get(documentType: string): DocumentTemplate {
    const template = this.templates.get(documentType);
    if (!template) throw new NotFoundException(`Unknown document type: ${documentType}`);
    return template;
  }
}
