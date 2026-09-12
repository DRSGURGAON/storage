import 'package:flutter/material.dart';

import '../../../app/theme/brand.dart';
import '../models/promo_offer.dart';

/// One offer, drawn as a dashboard card: the same white card, hairline
/// border and 18-radius the money tiles and subscription strip use, so
/// it reads as part of the dashboard rather than something pasted on
/// top of it. Badge, title, subtitle, up to three benefit lines, an
/// optional picture, and one button that is unmistakably a button.
class PromoBannerCard extends StatelessWidget {
  final PromoOffer offer;
  final VoidCallback onTap;
  final VoidCallback? onDismiss;

  const PromoBannerCard({
    super.key,
    required this.offer,
    required this.onTap,
    this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final bullets = offer.bullets.take(3).toList();
    final hasImage = offer.imageUrl.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
      child: Material(
        color: Brand.card,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          decoration: BoxDecoration(
            border: Border.all(color: Brand.line),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  _Badge(text: offer.badgeText, partner: offer.isPartnerOffer),
                  if (offer.partnerName.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'by ${offer.partnerName}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: Brand.inkMuted,
                        ),
                      ),
                    ),
                  ] else
                    const Spacer(),
                  if (onDismiss != null)
                    InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: onDismiss,
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Icon(Icons.close, size: 18, color: Brand.inkMuted),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          offer.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: Brand.ink,
                            height: 1.2,
                          ),
                        ),
                        if (offer.subtitle.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            offer.subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: Brand.inkMuted,
                              height: 1.3,
                            ),
                          ),
                        ],
                        if (bullets.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          for (final b in bullets)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 3),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Padding(
                                    padding: EdgeInsets.only(top: 2),
                                    child: Icon(Icons.check_circle,
                                        size: 14, color: Brand.mintInk),
                                  ),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      b,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w600,
                                        color: Brand.ink,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ],
                    ),
                  ),
                  if (hasImage) ...[
                    const SizedBox(width: 12),
                    _PromoImage(url: offer.imageUrl),
                  ],
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: Brand.navy,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  onPressed: onTap,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Flexible(
                        child: Text(
                          offer.ctaText,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Icon(Icons.arrow_forward, size: 18),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final bool partner;

  const _Badge({required this.text, required this.partner});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: partner ? Brand.amberSoft : Brand.skySoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
          color: partner ? Brand.amberInk : Brand.skyInk,
        ),
      ),
    );
  }
}

/// A small picture, or nothing: a network failure collapses the slot
/// rather than showing a broken-image glyph. Flutter's own image cache
/// keeps the bytes for the session, so scrolling and reloads do not
/// fetch it again.
class _PromoImage extends StatelessWidget {
  final String url;

  const _PromoImage({required this.url});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.network(
        url,
        width: 76,
        height: 76,
        fit: BoxFit.cover,
        gaplessPlayback: true,
        errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
      ),
    );
  }
}
