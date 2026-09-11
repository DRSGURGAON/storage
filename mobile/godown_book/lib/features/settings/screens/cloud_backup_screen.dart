import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../core/cloud_sync/document_cloud_sync_service.dart';

/// Settings -> Cloud Backup: shows when the last automatic backup
/// ran, and gives explicit Backup Now / Restore from Cloud actions on
/// top of the always-on periodic sync (DocumentCloudSyncService).
class CloudBackupScreen extends StatefulWidget {
  const CloudBackupScreen({super.key});

  @override
  State<CloudBackupScreen> createState() => _CloudBackupScreenState();
}

class _CloudBackupScreenState extends State<CloudBackupScreen> {
  DateTime? _lastBackup;
  bool _backingUp = false;
  bool _restoring = false;

  @override
  void initState() {
    super.initState();
    _loadLastBackup();
  }

  Future<void> _loadLastBackup() async {
    final time = await DocumentCloudSyncService.lastBackupTime();
    if (!mounted) return;
    setState(() => _lastBackup = time);
  }

  bool get _signedIn =>
      (FirebaseAuth.instance.currentUser?.uid ?? '').isNotEmpty;

  String get _lastBackupLabel {
    final time = _lastBackup;
    if (time == null) return 'No backup has run yet';

    final now = DateTime.now();
    final difference = now.difference(time);

    if (difference.inMinutes < 1) return 'Just now';
    if (difference.inMinutes < 60) {
      return '${difference.inMinutes} min ago';
    }
    if (difference.inHours < 24) {
      return '${difference.inHours} hr ago';
    }

    final local = time.toLocal();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  Future<void> _backupNow() async {
    setState(() => _backingUp = true);

    final result = await DocumentCloudSyncService.instance.syncNow();

    if (!mounted) return;
    setState(() => _backingUp = false);
    await _loadLastBackup();

    if (!mounted) return;

    final message = result.succeeded
        ? (result.pushed == 0 && result.deleted == 0
            ? 'Everything is already backed up.'
            : 'Backed up ${result.pushed} record(s)'
                '${result.deleted > 0 ? ', removed ${result.deleted} deleted record(s) from cloud' : ''}.')
        : 'Backup failed: ${result.error}';

    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _restore() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Restore from Cloud?'),
        content: const Text(
          'All documents backed up to the cloud for this account will '
          'be downloaded to this device.\n\n'
          'Existing documents on this device are kept - a document is '
          'matched by its identity, so nothing gets duplicated. A '
          'document that exists both here and in the cloud will take '
          'the cloud copy\'s content.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Restore'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _restoring = true);

    final result = await DocumentCloudSyncService.instance.restoreFromCloud();

    if (!mounted) return;
    setState(() => _restoring = false);

    final message = result.succeeded
        ? (result.restored == 0
            ? 'No backed-up documents found in the cloud for this account.'
            : 'Restored ${result.restored} record(s) from the cloud.')
        : 'Restore failed: ${result.error}';

    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final busy = _backingUp || _restoring;

    return Scaffold(
      appBar: AppBar(title: const Text('Cloud Backup'), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    _lastBackup != null
                        ? Icons.cloud_done_outlined
                        : Icons.cloud_outlined,
                    size: 40,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Last backup',
                          style: theme.textTheme.labelMedium,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _lastBackupLabel,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 8),

          Card(
            color: theme.colorScheme.surfaceContainerHighest,
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline, size: 18),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Backup runs automatically every few minutes while '
                      'the app is open. All your documents - Warehouse '
                      'Receipt, Delivery Order, Rent Bill, Money Receipt, '
                      'customers, locations and '
                      'Cards and customised Terms - are saved to your '
                      'account in the cloud. On a new phone, sign in with '
                      'the same mobile number and everything comes back.',
                      style: TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          if (!_signedIn)
            Card(
              color: theme.colorScheme.errorContainer,
              child: const Padding(
                padding: EdgeInsets.all(12),
                child: Text(
                  'You are not signed in - backup needs a signed-in '
                  'account. Please log in again.',
                  style: TextStyle(fontSize: 13),
                ),
              ),
            ),

          FilledButton.icon(
            onPressed: busy || !_signedIn ? null : _backupNow,
            icon: _backingUp
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.backup_outlined),
            label: Text(_backingUp ? 'Backing up...' : 'Backup Now'),
          ),

          const SizedBox(height: 12),

          OutlinedButton.icon(
            onPressed: busy || !_signedIn ? null : _restore,
            icon: _restoring
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cloud_download_outlined),
            label: Text(
              _restoring ? 'Restoring...' : 'Restore from Cloud',
            ),
          ),

          const SizedBox(height: 16),

          Text(
            'Note: photos (survey photos, employee card photos, company '
            'logo/signature/stamp images) stay on this device and are '
            'not part of the cloud backup yet.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.outline),
          ),
        ],
      ),
    );
  }
}
