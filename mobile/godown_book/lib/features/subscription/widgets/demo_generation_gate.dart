import 'package:flutter/material.dart';

/// Section 27's "DEMO DOCUMENT" confirmation gate - shared across every
/// document-generation screen (Warehouse Receipt/Bill/Money Receipt PDF) so
/// none of them re-implements this UI, matching Section 26's "do not
/// duplicate" instruction applied to the UI layer as much as the
/// access-check logic itself. Shown instead of generating anything
/// until the user explicitly confirms, so a demo copy is never burned
/// by simply opening the screen.
class DemoGenerationGate extends StatelessWidget {
  final int remaining;
  final VoidCallback onGenerate;

  const DemoGenerationGate({
    super.key,
    required this.remaining,
    required this.onGenerate,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.description_outlined, size: 48),
            const SizedBox(height: 16),
            Text(
              'DEMO DOCUMENT',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'You have $remaining free generation'
              '${remaining == 1 ? '' : 's'} available for this document '
              'type.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: onGenerate,
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('Generate Demo Copy'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Section 27's exhausted-demo state - blocks generation entirely with
/// an upgrade prompt. Shared for the same reason as DemoGenerationGate
/// above.
class DemoLimitReached extends StatelessWidget {
  final VoidCallback onViewSubscription;

  const DemoLimitReached({super.key, required this.onViewSubscription});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 48),
            const SizedBox(height: 16),
            Text(
              'Demo generation limit reached.',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Upgrade your subscription to generate unlimited '
              'professional documents.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: onViewSubscription,
                icon: const Icon(Icons.workspace_premium_outlined),
                label: const Text('View Subscription'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
