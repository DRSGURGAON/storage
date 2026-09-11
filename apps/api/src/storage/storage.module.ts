import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { NumberingModule } from '../numbering/numbering.module';
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
  imports: [AuditModule, NumberingModule, EntitlementModule],
  controllers: [StorageUnitsController, StorageBookingsController],
  providers: [StorageUnitsService, StorageBookingsService],
  exports: [StorageBookingsService],
})
export class StorageModule {}
