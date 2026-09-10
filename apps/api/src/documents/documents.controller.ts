import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { DocumentRelationsService } from './document-relations.service';
import { DownloadLinkService } from './download-link.service';
import { positiveNumber } from '../throttling';
import { DocumentEngineService } from './documents.service';
import { ListDocumentsQuery } from './dto/list-documents.query';

/**
 * document-engine.md §8 / ux-system.md §5: the Document Centre's read
 * side -- one list/get/download surface for every document type, gated
 * on `view_documents` (broad, already granted to most roles) rather than
 * each source record's own narrower permission. Write endpoints
 * (preview/commit) live on each owning resource's own controller instead
 * -- see quotations.controller.ts -- since only that resource knows the
 * right permission to require.
 */
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentEngineService,
    private readonly links: DownloadLinkService,
    private readonly relations: DocumentRelationsService,
  ) {}

  /**
   * `document-engine.md` §8 / `ux-system.md` §7: "Created From", "Related
   * Documents", this record's own generated copies, and the §68 timeline
   * around it -- all computed from the foreign-key graph, none of it
   * stored.
   *
   * Declared above `@Get(':id')` on purpose: routes match in declaration
   * order, and `:id` carries a `ParseUUIDPipe` that would reject the
   * literal segment `relations` with a 400 before this could ever run.
   */
  @Get('relations/:sourceType/:sourceId')
  @RequirePermission('view_documents')
  relationsFor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sourceType') sourceType: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ) {
    return this.relations.relations(user, sourceType, sourceId);
  }

  @Get()
  @RequirePermission('view_documents')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsQuery) {
    return this.documents.list(user, { ...query, latestOnly: query.latestOnly ?? true });
  }

  @Get(':id')
  @RequirePermission('view_documents')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(user, id);
  }

  @Get(':id/download')
  @RequirePermission('view_documents')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { fileName, bytes } = await this.documents.downloadBytes(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(bytes);
  }

  /**
   * Mints the signed, expiring link `DocumentLinkController` consumes --
   * for anywhere a JWT cannot travel: an `<iframe>` preview, a print
   * window, a link pasted into an email. Minting is a read of a document
   * the caller may already download, so it needs no permission beyond the
   * one guarding that download, and it copies nothing: the link releases
   * these bytes and no others, for a few minutes.
   */
  @Post(':id/download-link')
  @RequirePermission('view_documents')
  async downloadLink(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    // Through the ordinary download path first, so a document this caller
    // cannot reach cannot be turned into a link that anyone can.
    await this.documents.downloadBytes(user, id);
    const { token, path, expiresAt } = this.links.sign({
      documentId: id,
      tenantId: user.tenantId,
      customerId: user.customerId ?? null,
    });
    return { url: path, token, expiresAt, expiresInSeconds: this.links.ttlSeconds };
  }
}

/**
 * The public end of a signed link. No `JwtAuthGuard`, deliberately -- the
 * signature *is* the credential, and a browser following a link from an
 * email carries no token. Everything that makes that safe lives in
 * `DownloadLinkService`: a constant-time signature check, a hard expiry,
 * and claims naming exactly one document.
 *
 * Rate-limited like the QR verify route it sits beside, for the same
 * reason: it is unauthenticated, it reads a file from disk, and nothing
 * else stands between a caller and repeating it.
 */
@Controller('document-links')
export class DocumentLinkController {
  constructor(
    private readonly documents: DocumentEngineService,
    private readonly links: DownloadLinkService,
  ) {}

  @Throttle({
    default: {
      ttl: positiveNumber(process.env.VERIFY_RATE_LIMIT_TTL_MS, 60_000),
      limit: positiveNumber(process.env.VERIFY_RATE_LIMIT_MAX, 60),
    },
  })
  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const claims = this.links.verify(token);
    const { fileName, bytes } = await this.documents.downloadBytesByClaims(claims);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    // A signed link is a capability, not a public URL: never let a proxy or
    // a browser keep the bytes around after it has expired.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  }
}
