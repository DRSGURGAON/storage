import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';

import { PickListsController } from './pick-lists.controller';
import { PickListsService } from './pick-lists.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [PickListsController],
  providers: [PickListsService],
  exports: [PickListsService],
})
export class PickListsModule {}
