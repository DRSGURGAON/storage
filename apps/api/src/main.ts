import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const config = app.get(ConfigService);

  // Off by default, and that is the safe direction. With `trust proxy`
  // enabled, Express believes `X-Forwarded-For` -- which any client can
  // set. On a host reachable directly that hands an attacker a fresh
  // rate-limit bucket per forged header and a fabricated IP in every
  // `audit_logs` row. Enabled only when a deployment actually sits behind
  // a proxy it controls, and then set to the number of hops so only the
  // addresses that proxy appended are trusted.
  const trustProxyHops = Number(config.get<string>('TRUST_PROXY_HOPS') ?? '0');
  if (Number.isFinite(trustProxyHops) && trustProxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  }

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
}

bootstrap();
