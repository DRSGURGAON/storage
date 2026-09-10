import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel, WhatsappChannel } from './channels/webhook.channel';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationRulesController } from './notification-rules.controller';
import { NotificationRulesService } from './notification-rules.service';
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
  imports: [AuditModule],
  controllers: [NotificationsController, NotificationRulesController],
  providers: [NotificationsService, NotificationRulesService, NotificationDispatcherService, EmailChannel, WhatsappChannel, SmsChannel],
  exports: [NotificationsService, NotificationRulesService, NotificationDispatcherService],
})
export class NotificationsModule {}
