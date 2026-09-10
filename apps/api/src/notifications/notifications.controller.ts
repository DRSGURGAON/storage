import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { NotificationsService } from './notifications.service';

const toBoolean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value === 'true' : value);

export class ListNotificationsQuery {
  @IsOptional() @Transform(toBoolean) @IsBoolean() unreadOnly?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

/**
 * A notification is addressed to one person, so there is no permission to
 * hold: the only rows any of these routes can reach are the caller's own,
 * and `view_notifications` would be a permission that every role needed
 * and none could be refused. Authentication is the whole check.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQuery) {
    return this.notifications.list(user, query);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser, @Body() _body: Record<string, never>) {
    return this.notifications.markAllRead(user);
  }
}
