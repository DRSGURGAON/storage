import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { PasswordService } from '../auth/password.service';
import { SetMemberPasswordDto } from '../auth/dto/password.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('manage_users_and_roles')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.users.list(user);
  }

  @Post()
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddMemberDto, @Ip() ip: string) {
    return this.users.addMember(user, dto, ip);
  }

  /**
   * The path that works with no email server at all, and on a warehouse
   * floor it is the usual one: the operator who forgot their password is
   * standing in front of the Owner who can issue a new one. Governed by
   * the same `manage_users_and_roles` this whole controller is -- issuing
   * a credential is not a lesser act than changing a role.
   *
   * It refuses the caller's own account: an Owner changes their own
   * password through `/auth/change-password`, where they have to type the
   * current one. Otherwise this route would be a way around ever knowing it.
   */
  @Post(':id/password')
  setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMemberPasswordDto,
    @Ip() ip: string,
  ) {
    return this.passwords.setPasswordForMember(user, id, dto.newPassword, ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
    @Ip() ip: string,
  ) {
    return this.users.updateMember(user, id, dto, ip);
  }
}
