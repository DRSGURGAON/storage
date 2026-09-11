import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';

/// The single three-dot (⋮) menu shown on every saved document's PDF
/// screen - one place for the full option set: Share PDF, Save PDF,
/// Print, Edit, Call Customer, Delete.
///
/// [getPdfBytes] returns the bytes the preview last rendered (the
/// screen stores them from its own PdfPreview build callback), so
/// Share/Save/Print always send exactly what the user is looking at -
/// including any demo watermark - without rebuilding the PDF or
/// duplicating the screen's own build logic.
///
/// Pass null for [onEdit]/[onDelete] to omit those entries (e.g. a
/// Loading Slip rendered live from a Booking has no saved record of
/// its own to edit or delete). [customerPhone] empty/null hides Call
/// Customer.
class PdfActionsMenu extends StatelessWidget {
  final String documentLabel;
  final String Function() fileName;
  final Uint8List? Function() getPdfBytes;
  final String? customerPhone;
  final VoidCallback? onEdit;
  final Future<void> Function()? onDelete;
  final VoidCallback? afterDelete;
  final String? deleteWarning;

  const PdfActionsMenu({
    super.key,
    required this.documentLabel,
    required this.fileName,
    required this.getPdfBytes,
    this.customerPhone,
    this.onEdit,
    this.onDelete,
    this.afterDelete,
    this.deleteWarning,
  });

  bool get _canCall => (customerPhone ?? '').trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert),
      tooltip: 'Options',
      onSelected: (value) => _handle(context, value),
      itemBuilder: (context) => [
        const PopupMenuItem(
          value: 'share',
          child: ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.share_outlined),
            title: Text('Share PDF'),
          ),
        ),
        const PopupMenuItem(
          value: 'save',
          child: ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.download_outlined),
            title: Text('Save PDF'),
          ),
        ),
        const PopupMenuItem(
          value: 'print',
          child: ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.print_outlined),
            title: Text('Print'),
          ),
        ),
        if (onEdit != null)
          PopupMenuItem(
            value: 'edit',
            child: ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.edit_outlined),
              title: Text('Edit $documentLabel'),
            ),
          ),
        if (_canCall)
          const PopupMenuItem(
            value: 'call',
            child: ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.call_outlined),
              title: Text('Call Customer'),
            ),
          ),
        if (onDelete != null) ...[
          const PopupMenuDivider(),
          PopupMenuItem(
            value: 'delete',
            child: ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                Icons.delete_outline,
                color: Theme.of(context).colorScheme.error,
              ),
              title: Text(
                'Delete $documentLabel',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _handle(BuildContext context, String value) async {
    switch (value) {
      case 'share':
        await _withBytes(context, (bytes) async {
          await Printing.sharePdf(bytes: bytes, filename: fileName());
        });
      case 'save':
        await _withBytes(context, (bytes) => _savePdf(context, bytes));
      case 'print':
        await _withBytes(context, (bytes) async {
          await Printing.layoutPdf(
            onLayout: (_) async => bytes,
            name: fileName(),
          );
        });
      case 'edit':
        onEdit?.call();
      case 'call':
        await _callCustomer(context);
      case 'delete':
        await _confirmAndDelete(context);
    }
  }

  Future<void> _withBytes(
    BuildContext context,
    Future<void> Function(Uint8List bytes) action,
  ) async {
    final bytes = getPdfBytes();

    if (bytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('PDF is still loading - try again in a moment.'),
        ),
      );
      return;
    }

    try {
      await action(bytes);
    } catch (e) {
      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not complete: $e')),
      );
    }
  }

  /// Writes the PDF into the app's own storage folder (no permission
  /// prompts on any Android version) and shows where it went. For
  /// saving into Drive/Downloads/etc. the Share option's system sheet
  /// already offers every installed destination.
  Future<void> _savePdf(BuildContext context, Uint8List bytes) async {
    Directory? dir;
    if (Platform.isAndroid) {
      dir = await getExternalStorageDirectory();
    }
    dir ??= await getApplicationDocumentsDirectory();

    final folder = Directory('${dir.path}/DRS Documents');
    if (!await folder.exists()) {
      await folder.create(recursive: true);
    }

    final file = File('${folder.path}/${fileName()}');
    await file.writeAsBytes(bytes);

    if (!context.mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Saved: ${file.path}'),
        duration: const Duration(seconds: 5),
      ),
    );
  }

  Future<void> _callCustomer(BuildContext context) async {
    final phone = (customerPhone ?? '').trim();
    if (phone.isEmpty) return;

    final uri = Uri(scheme: 'tel', path: phone);

    try {
      final launched =
          await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open dialer for $phone')),
        );
      }
    } catch (_) {
      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open dialer for $phone')),
      );
    }
  }

  Future<void> _confirmAndDelete(BuildContext context) async {
    final delete = onDelete;
    if (delete == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Delete $documentLabel?'),
        content: Text(
          deleteWarning ??
              'This $documentLabel will be permanently deleted. '
                  'This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(dialogContext).colorScheme.error,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await delete();

      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$documentLabel deleted.')),
      );

      afterDelete?.call();
    } catch (e) {
      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not delete: $e')),
      );
    }
  }
}
