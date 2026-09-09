import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { InwardsController } from './inwards.controller';
import { InwardsService } from './inwards.service';

@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [InwardsController],
  providers: [InwardsService],
})
export class InwardsModule {}
