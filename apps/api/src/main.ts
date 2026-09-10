import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
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

  /*
   * Security headers. This API serves JSON and PDFs, never a page, so the
   * defaults are mostly right as they stand -- `nosniff`, a referrer
   * policy, and HSTS once it is behind TLS.
   *
   * Three deliberate settings on top:
   *
   * - `crossOriginResourcePolicy: cross-origin`, because a deployment that
   *   serves the web app from a different host than the API is a supported
   *   shape (see CORS below), and the default `same-origin` would block the
   *   PDF a signed download link resolves to.
   * - `frameguard: deny`, above.
   * - No CSP. A Content-Security-Policy on an API that never returns HTML
   *   protects nothing and would be one more thing to get wrong; the header
   *   belongs on whatever serves the frontend.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // DENY rather than helmet's SAMEORIGIN default: nothing this API
      // returns is meant to be framed, by us or by anyone.
      frameguard: { action: 'deny' },
    }),
  );

  /*
   * CORS is off unless a deployment asks for it, because the shape this
   * repo ships -- one origin, the frontend's server proxying /api -- needs
   * none, and an API that answers any origin by default is how a token in
   * localStorage becomes readable from someone else's page.
   *
   * `CORS_ORIGINS` is a comma-separated allow-list of exact origins. Not a
   * wildcard: with credentials in play a wildcard is both refused by
   * browsers and wrong.
   */
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    });
  }

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
