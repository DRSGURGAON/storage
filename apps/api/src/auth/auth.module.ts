import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailChannel } from '../notifications/channels/email.channel';
import { AccountDeletionService } from './account-deletion.service';
import { PasswordService } from './password.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '12h' },
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  // `EmailChannel` is provided here rather than imported from
  // NotificationsModule: it holds no state beyond a pooled transport and a
  // password reset is not a tenant notification (the account can belong to
  // several workspaces), so routing it through the notifications table
  // would file a reset under whichever tenant happened to be guessed.
  providers: [AuthService, JwtStrategy, PasswordService, AccountDeletionService, EmailChannel],
  exports: [PasswordService, AccountDeletionService],
})
export class AuthModule {}
