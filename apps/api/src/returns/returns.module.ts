import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { NumberingModule } from '../numbering/numbering.module';
import { ReturnInwardsService } from './return-inwards.service';
import { ReturnRequestsService } from './return-requests.service';
import { ReturnInwardsController, ReturnRequestsController } from './returns.controllers';

/** Blueprint §37: Return Request and Return Inward. The stock posting itself is the GRN's (`RETURN` rows). */
@Module({
  imports: [AuditModule, NumberingModule, DocumentsModule],
  controllers: [ReturnRequestsController, ReturnInwardsController],
  providers: [ReturnRequestsService, ReturnInwardsService],
})
export class ReturnsModule {}
