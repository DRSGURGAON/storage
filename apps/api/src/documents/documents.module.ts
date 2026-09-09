import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { DocumentTemplateRegistry } from './document-template.registry';
import { DocumentsController } from './documents.controller';
import { DocumentEngineService } from './documents.service';
import { PdfRendererService } from './pdf-renderer.service';
import { QrService } from './qr.service';
import { QuotationDocumentTemplate } from './templates/quotation-document.template';
import { VerifyController, VerifyService } from './verify.controller';

@Module({
  imports: [AttachmentsModule, AuditModule, EntitlementModule],
  controllers: [DocumentsController, VerifyController],
  providers: [
    DocumentEngineService,
    DocumentTemplateRegistry,
    PdfRendererService,
    QrService,
    QuotationDocumentTemplate,
    VerifyService,
  ],
  exports: [DocumentEngineService],
})
export class DocumentsModule {}
