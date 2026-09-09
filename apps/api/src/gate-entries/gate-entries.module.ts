import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { GateEntriesController } from './gate-entries.controller';
import { GateEntriesService } from './gate-entries.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [GateEntriesController],
  providers: [GateEntriesService],
})
export class GateEntriesModule {}
