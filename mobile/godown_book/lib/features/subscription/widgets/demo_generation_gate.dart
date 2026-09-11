import 'package:flutter/material.dart';

/// The free-copy confirmation, shared by every document screen so none
/// of them re-implements it. Shown instead of generating anything until
/// the user says go, so simply opening a screen never uses a free copy.
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
              'You have $remaining free copy'
              '${remaining == 1 ? '' : 'ies'} left of this document.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            const Text(
              'It will carry a demo mark. Subscribe for clean, unlimited '
              'documents.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, fontSize: 12),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: onGenerate,
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('Make this document'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// What is shown once the free copies are used: the plans, and a sample
/// of this very document so somebody can see what they would be paying
/// for. The sample is made up in memory and marked SAMPLE - it never
/// touches real records and never uses a copy.
class DemoLimitReached extends StatelessWidget {
  final VoidCallback onViewSubscription;

  /// Shows the sample. Null when no sample exists for this document.
  final VoidCallback? onTrySample;

  const DemoLimitReached({
    super.key,
    required this.onViewSubscription,
    this.onTrySample,
  });

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
              'Your free copies of this document are used.',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Subscribe for clean, unlimited documents - or look at a '
              'sample first.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: onViewSubscription,
                icon: const Icon(Icons.workspace_premium_outlined),
                label: const Text('View Plans'),
              ),
            ),
            if (onTrySample != null) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton.icon(
                  onPressed: onTrySample,
                  icon: const Icon(Icons.visibility_outlined),
                  label: const Text('See a Sample'),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'A sample is made-up data, marked SAMPLE. Your own records '
                'are never touched.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
