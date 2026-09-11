import 'package:flutter/material.dart';

import '../../../core/document_terms/document_terms_repository.dart';
import '../../company/repositories/company_repository.dart';
import '../../../core/constants/default_terms.dart';

/// Reports -> Customise Documents (also reachable from Settings):
/// per-document Terms & Conditions and the footer lines printed on
/// every document.
///
/// Each document type shows the terms it is *currently printing* -
/// its own customised terms if set, else the company-wide Default
/// Terms, else (for the Receipt/Agreement) the built-in terms - as a
/// numbered list of points that can be edited, deleted, reordered by
/// re-adding, or extended point by point. Saving stores the edited
/// list as that document's own terms; a document whose points were
/// never touched keeps following the common Default Terms exactly as
/// before.
class DocumentCustomisationScreen extends StatefulWidget {
  const DocumentCustomisationScreen({super.key});

  @override
  State<DocumentCustomisationScreen> createState() =>
      _DocumentCustomisationScreenState();
}

class _DocumentCustomisationScreenState
    extends State<DocumentCustomisationScreen> {
  // (docType code, screen label) - one editor per PDF document type.
  static const _docTypes = <(String, String)>[
    (DocumentTermsType.warehouseReceipt, 'Warehouse Receipt'),
    (DocumentTermsType.storageAgreement, 'Storage Agreement'),
    (DocumentTermsType.deliveryOrder, 'Delivery Order / Gate Pass'),
    (DocumentTermsType.bill, 'Rent Bill'),
    (DocumentTermsType.moneyReceipt, 'Money Receipt'),
  ];

  /// The working point list per document type - what the numbered
  /// rows show and what Save persists (joined by newlines).
  final Map<String, List<String>> _points = {
    for (final (code, _) in _docTypes) code: <String>[],
  };

  /// The effective terms string each document had when the screen
  /// loaded - Save only writes a document whose points actually
  /// changed, so merely opening this screen never converts every
  /// document's common-default terms into frozen per-document copies.
  final Map<String, String> _initialJoined = {};

  /// Which documents already had their own customised terms stored.
  final Set<String> _hasCustom = {};

  final _footer1Controller = TextEditingController();
  final _footer2Controller = TextEditingController();

  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final company = await CompanyRepository.instance.getCompany();
    final allCustom = await DocumentTermsRepository.instance.getAllTerms();

    if (!mounted) return;

    final companyDefault = company?.defaultTerms.trim() ?? '';

    setState(() {
      _footer1Controller.text = company?.footerText ?? '';
      _footer2Controller.text = company?.footerText2 ?? '';

      for (final (code, _) in _docTypes) {
        final custom = (allCustom[code] ?? '').trim();
        if (custom.isNotEmpty) _hasCustom.add(code);

        // What this document currently prints - same resolution order
        // as the PDF services themselves.
        var effective = custom.isNotEmpty ? custom : companyDefault;
        if (effective.isEmpty &&
            (code == DocumentTermsType.warehouseReceipt ||
                code == DocumentTermsType.storageAgreement)) {
          effective = DefaultStorageTerms.terms.join('\n');
        }

        _initialJoined[code] = _joinPoints(_splitPoints(effective));
        _points[code]!
          ..clear()
          ..addAll(_splitPoints(effective));
      }

      _loading = false;
    });
  }

  /// One point per non-empty line. Leading numbering like "1." is
  /// stripped so re-imported company defaults don't end up
  /// double-numbered next to this screen's own row numbers.
  List<String> _splitPoints(String terms) {
    return terms
        .split('\n')
        .map((line) => line.trim().replaceFirst(RegExp(r'^\d+[.)]\s*'), ''))
        .where((line) => line.isNotEmpty)
        .toList();
  }

  String _joinPoints(List<String> points) => points.join('\n');

  @override
  void dispose() {
    _footer1Controller.dispose();
    _footer2Controller.dispose();
    super.dispose();
  }

  Future<void> _editPoint(String code, int? index) async {
    final controller = TextEditingController(
      text: index == null ? '' : _points[code]![index],
    );

    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(index == null ? 'Add Point' : 'Edit Point'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 5,
          minLines: 2,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Write the condition...',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text(index == null ? 'Add' : 'Update'),
          ),
        ],
      ),
    );

    // Dialog disposed its own route; the controller can go now.
    controller.dispose();

    if (result == null || result.isEmpty) return;

    setState(() {
      if (index == null) {
        _points[code]!.add(result);
      } else {
        _points[code]![index] = result;
      }
    });
  }

  Future<void> _save() async {
    if (_saving) return;

    setState(() => _saving = true);

    try {
      for (final (code, _) in _docTypes) {
        final joined = _joinPoints(_points[code]!);

        // Only persist documents whose points actually changed -
        // untouched documents keep following the common Default Terms.
        if (joined != _initialJoined[code]) {
          await DocumentTermsRepository.instance.saveTerms(code, joined);
          _initialJoined[code] = joined;
          if (joined.isEmpty) {
            _hasCustom.remove(code);
          } else {
            _hasCustom.add(code);
          }
        }
      }

      final company = await CompanyRepository.instance.getCompany();
      if (company != null) {
        await CompanyRepository.instance.saveCompany(company.copyWith(
          footerText: _footer1Controller.text.trim(),
          footerText2: _footer2Controller.text.trim(),
          updatedAt: DateTime.now().toIso8601String(),
        ));
      }

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Saved. New PDFs will use these.')),
      );

      setState(() => _saving = false);
    } catch (e) {
      if (!mounted) return;

      setState(() => _saving = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save: $e')),
      );
    }
  }

  Widget _docTermsCard(String code, String label) {
    final points = _points[code]!;

    final pointsWord = points.length == 1 ? 'point' : 'points';
    final customSuffix = _hasCustom.contains(code) ? '  •  Customised' : '';
    final subtitle = points.isEmpty
        ? 'No terms - nothing will print'
        : '${points.length} $pointsWord$customSuffix';

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ExpansionTile(
        title: Text(label),
        subtitle: Text(
          subtitle,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        childrenPadding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
        children: [
          for (var i = 0; i < points.length; i++)
            ListTile(
              dense: true,
              contentPadding: const EdgeInsets.only(left: 12, right: 0),
              leading: Text(
                '${i + 1}.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              title: Text(
                points[i],
                style: Theme.of(context).textTheme.bodySmall,
              ),
              onTap: () => _editPoint(code, i),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    tooltip: 'Edit point',
                    onPressed: () => _editPoint(code, i),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline, size: 18),
                    tooltip: 'Delete point',
                    onPressed: () =>
                        setState(() => _points[code]!.removeAt(i)),
                  ),
                ],
              ),
            ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => _editPoint(code, null),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add Point'),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Customise Documents'),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Footer (printed on every document)',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _footer1Controller,
                          decoration: const InputDecoration(
                            labelText: 'Footer Line 1',
                            hintText:
                                'SAVE PAPER - SAVE TREES | BE DIGITAL - GO GREEN',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _footer2Controller,
                          decoration: const InputDecoration(
                            labelText: 'Footer Line 2 (optional)',
                            hintText: 'Extra line under the footer, if needed',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 8),

                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                  child: Text(
                    'Terms & Conditions per document - each list below '
                    'shows exactly what that document prints today. Tap a '
                    'point to edit it, use the icons to edit/delete, or '
                    'Add Point for a new one. Documents you don\'t touch '
                    'keep following the common Default Terms from Company '
                    'Settings.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),

                for (final (code, label) in _docTypes)
                  _docTermsCard(code, label),
              ],
            ),
      bottomNavigationBar: _loading
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  height: 50,
                  child: ElevatedButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Save'),
                  ),
                ),
              ),
            ),
    );
  }
}
