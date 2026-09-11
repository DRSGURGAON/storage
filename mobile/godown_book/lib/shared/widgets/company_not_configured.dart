import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Shown instead of a half-empty PDF when Company Settings are
/// incomplete - a document printed on a blank letterhead (no company
/// name, GST, bank details or signature) is worse than no document at
/// all. Shared across every document-PDF screen so each one gates on
/// the same check every PDF screen performs.
class CompanyNotConfigured extends StatelessWidget {
  final List<String> missing;

  const CompanyNotConfigured({super.key, required this.missing});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        // A long "Still missing" list, or a large system text-scale
        // setting, can make this taller than a short screen - this is
        // now shown on 8 PDF screens instead of the 1 it was copied
        // from, so it needs to scroll rather than overflow.
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.business_outlined, size: 48),
            const SizedBox(height: 16),
            Text(
              'Complete your company details first',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'The document letterhead, GST number, bank details and '
              'signature all come from Company Settings. Right now the PDF '
              'would print blank.',
            ),
            if (missing.isNotEmpty) ...[
              const SizedBox(height: 16),
              const Text(
                'Still missing:',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              for (final field in missing)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text('•  $field'),
                ),
            ],
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: () => context.push('/company-settings'),
                icon: const Icon(Icons.settings),
                label: const Text('Open Company Settings'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
