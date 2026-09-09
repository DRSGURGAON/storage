import { HttpException, HttpStatus } from '@nestjs/common';
import { CheckEntitlementResult } from '../entitlement/entitlement.types';

/**
 * document-engine.md §7 / ux-system.md §11: "the user sees the upgrade
 * screen... before any document content is built." HTTP 402 (Payment
 * Required) rather than a generic 403, so the frontend can distinguish
 * "you may never do this" from "you may do this again once you upgrade."
 */
export class PaywallException extends HttpException {
  constructor(featureCode: string, featureName: string, result: CheckEntitlementResult) {
    super(
      {
        paywall: true,
        featureCode,
        featureName,
        reason: result.reason,
        limit: result.limit,
        used: result.used,
        remaining: result.remaining,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
