import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Global because the emitters are scattered by nature: the module that
 * knows a GRN was submitted is the GRN module, and threading a
 * notifications import through every operational module would be
 * ceremony for a service that only ever inserts rows.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
