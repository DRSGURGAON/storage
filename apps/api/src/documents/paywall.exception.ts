import { HttpException, HttpStatus } from '@nestjs/common';
import { CheckEntitlementResult } from '../entitlement/entitlement.types';
import { PaywallContext, paywallMessage } from '../entitlement/paywall';

/**
 * document-engine.md §7 / ux-system.md §11: "the user sees the upgrade
 * screen... before any document content is built." HTTP 402 (Payment
 * Required) rather than a generic 403, so the frontend can distinguish
 * "you may never do this" from "you may do this again once you upgrade."
 *
 * The body carries both halves of what §11 needs: a `message` for any
 * client that reads only that (Nest's convention everywhere else in this
 * API, and what the web client's `ApiError` surfaces), and the structured
 * feature/plan/limit figures for the upgrade prompt that wants to say
 * which feature ran out and what the next plan up gives.
 */
export class PaywallException extends HttpException {
  constructor(ctx: PaywallContext, result: CheckEntitlementResult) {
    super(
      {
        paywall: true,
        message: paywallMessage(ctx, result),
        featureCode: ctx.featureCode,
        featureName: ctx.featureName,
        planCode: ctx.planCode,
        planName: ctx.planName,
        reason: result.reason,
        limit: result.limit,
        used: result.used,
        remaining: result.remaining,
        upgradeRequired: result.upgradeRequired,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
