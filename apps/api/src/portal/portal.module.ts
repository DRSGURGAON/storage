import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PortalController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

/** Blueprint §53 / tenancy-and-security.md §2: the customer's own view, structurally unable to see anyone else's. */
@Module({
  imports: [DocumentsModule, NumberingModule, AuditModule],
  controllers: [PortalController],
  providers: [PortalService, PortalGuard],
})
export class PortalModule {}
