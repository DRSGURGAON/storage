import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StorageBillingService } from './storage-billing.service';
import { StorageBookingsService } from './storage-bookings.service';
import { StorageBookingsController, StorageUnitsController } from './storage.controllers';
import { StorageUnitsService } from './storage-units.service';

/**
 * Household goods storage: the second product on this engine, for the
 * operator who stores a family's belongings rather than a company's
 * pallets. It reuses tenants, users, numbering, documents, attachments and
 * invoicing wholesale, and adds only what the 3PL side cannot express --
 * an item-wise inventory list with a condition note against each line.
 */
@Module({
  imports: [AuditModule, NumberingModule, EntitlementModule, DocumentsModule, InvoicingModule],
  controllers: [StorageUnitsController, StorageBookingsController],
  providers: [StorageUnitsService, StorageBookingsService, StorageBillingService],
  exports: [StorageBookingsService],
})
export class StorageModule {}
