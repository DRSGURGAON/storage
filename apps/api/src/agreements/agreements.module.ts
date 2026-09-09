import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';

@Module({
  imports: [AuditModule, NumberingModule],
  controllers: [AgreementsController],
  providers: [AgreementsService, AgreementTemplatesService],
})
export class AgreementsModule {}
