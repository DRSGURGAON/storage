import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../database/app_database.dart';
import '../tenant/tenant_scope.dart';

/// Outcome of one backup or restore pass - the Cloud Backup screen
/// shows these numbers so the user can see the backup genuinely
/// happened rather than trusting a spinner.
class CloudSyncResult {
  final int pushed;
  final int deleted;
  final int restored;
  final String? error;

  const CloudSyncResult({
    this.pushed = 0,
    this.deleted = 0,
    this.restored = 0,
    this.error,
  });

  bool get succeeded => error == null;
}

/// Mirrors every document table (bilty, packing list, bill, money
/// receipt, loading slip, NOC, vehicle condition, quotation, survey,
/// employee card - plus each one's child rows and the customised
/// per-document terms) into Firestore, one cloud document per local
/// row at companies/{uid}/{table}/{rowId}.
///
/// SAME ARCHITECTURE AS CompanyFirestoreSyncService: local SQLite
/// stays the source of truth for every read in the app - this service
/// is a best-effort cloud mirror that never blocks or reverts a local
/// save. The app keeps working fully offline; the next online sync
/// pass catches up whatever was missed.
///
/// WHY keyed by Firebase Auth uid (not the local companyId UUID):
/// uid is the one identifier that is stable across reinstalls and
/// devices - the same person logging in on a new phone finds their
/// documents under the same path. Row ids are the local TEXT UUID
/// primary keys, which are globally unique, so a row keeps the same
/// cloud identity forever and re-pushing is always an overwrite,
/// never a duplicate.
///
/// COST CONTROL: a local cloud_sync_state table records the hash each
/// row had when last pushed. A sync pass compares hashes entirely
/// locally and performs ZERO Firestore operations when nothing
/// changed - so the periodic timer is effectively free, and a changed
/// row costs exactly one write.
class DocumentCloudSyncService {
  DocumentCloudSyncService._();

  static final DocumentCloudSyncService instance =
      DocumentCloudSyncService._();

  /// Every synced table. All of these carry a company_id column and a
  /// TEXT UUID `id` primary key (verified against migrations.dart).
  /// storage_photos and signature_requests are deliberately absent:
  /// both hold device-local image paths that mean nothing on another
  /// phone - the same honest limit the company logo has.
  static const List<String> syncedTables = [
    'customers',
    'storage_locations',
    'quotations',
    'quotation_lines',
    'storage_bookings',
    'booking_items',
    'goods_releases',
    'release_items',
    'invoices',
    'invoice_charges',
    'payments',
    'notices',
    'incidents',
    'consignments',
    'consignment_items',
    'document_terms',
  ];

  static const String lastBackupPrefsKey = 'cloud_sync_last_backup_at';

  /// Matches CompanyFirestoreSyncService's own reasoning: Firestore's
  /// SDK retries forever when unreachable instead of throwing, so
  /// every call needs an explicit timeout to fail honestly.
  static const Duration _writeTimeout = Duration(seconds: 20);
  static const Duration _readTimeout = Duration(seconds: 45);

  /// Firestore's own hard limit is 500 operations per batch - stay
  /// comfortably under it.
  static const int _batchLimit = 400;

  static const Duration _syncInterval = Duration(minutes: 3);
  static const Duration _firstSyncDelay = Duration(seconds: 15);

  FirebaseFirestore get _firestore => FirebaseFirestore.instance;

  bool _started = false;
  bool _syncing = false;
  Timer? _timer;

  CollectionReference<Map<String, dynamic>> _tableCollection(
    String uid,
    String table,
  ) {
    return _firestore.collection('companies').doc(uid).collection(table);
  }

  /// Starts the periodic auto-backup: one pass shortly after app
  /// launch (delayed so startup isn't competing with it for network),
  /// then every few minutes while the app is open. Safe to call more
  /// than once - only the first call arms the timers.
  void start() {
    if (_started) return;
    _started = true;

    Timer(_firstSyncDelay, () => unawaited(syncNow()));
    _timer = Timer.periodic(_syncInterval, (_) => unawaited(syncNow()));
  }

  /// Used in tests / on sign-out if ever needed.
  void stop() {
    _timer?.cancel();
    _timer = null;
    _started = false;
  }

  /// One full backup pass: push every changed row, delete cloud copies
  /// of locally-deleted rows. Never throws - a failure comes back as
  /// CloudSyncResult.error, and the local data is untouched either way.
  Future<CloudSyncResult> syncNow() async {
    if (_syncing) {
      return const CloudSyncResult(error: 'A backup is already running.');
    }

    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) {
      return const CloudSyncResult(error: 'Not signed in.');
    }

    final companyId = TenantScope.companyIdOrNull;
    if (companyId == null || companyId.isEmpty) {
      return const CloudSyncResult(error: 'Company not set up yet.');
    }

    _syncing = true;

    try {
      final db = await AppDatabase.instance.database;

      var pushed = 0;
      var deleted = 0;

      for (final table in syncedTables) {
        final rows = await db.query(
          table,
          where: 'company_id = ?',
          whereArgs: [companyId],
        );

        // The already-pushed state for this table, loaded once.
        final stateRows = await db.query(
          'cloud_sync_state',
          where: 'table_name = ?',
          whereArgs: [table],
        );
        final pushedHashes = <String, String>{
          for (final s in stateRows)
            (s['row_id'] as String): (s['row_hash'] as String),
        };

        // Changed/new rows -> push.
        final toPush = <String, Map<String, dynamic>>{};
        final currentIds = <String>{};

        for (final row in rows) {
          final id = row['id'] as String?;
          if (id == null || id.isEmpty) continue;

          currentIds.add(id);

          final hash = _rowHash(row);
          if (pushedHashes[id] != hash) {
            toPush[id] = Map<String, dynamic>.from(row);
          }
        }

        // Rows pushed earlier but no longer present locally were
        // genuinely deleted in the app -> delete the cloud copy too.
        final toDelete =
            pushedHashes.keys.where((id) => !currentIds.contains(id)).toList();

        if (toPush.isEmpty && toDelete.isEmpty) continue;

        pushed += await _pushTable(db, uid, table, toPush);
        deleted += await _deleteFromTable(db, uid, table, toDelete);
      }

      // A pass with nothing to push is still a successful backup
      // check - the timestamp tells the user "everything is safe as
      // of now", not merely "something was uploaded".
      await _recordBackupTime();

      return CloudSyncResult(pushed: pushed, deleted: deleted);
    } catch (e) {
      debugPrint('Document cloud sync failed: $e');
      return CloudSyncResult(error: e.toString());
    } finally {
      _syncing = false;
    }
  }

  Future<int> _pushTable(
    Database db,
    String uid,
    String table,
    Map<String, Map<String, dynamic>> toPush,
  ) async {
    if (toPush.isEmpty) return 0;

    final collection = _tableCollection(uid, table);
    final entries = toPush.entries.toList();
    var done = 0;

    for (var i = 0; i < entries.length; i += _batchLimit) {
      final chunk = entries.sublist(
        i,
        i + _batchLimit > entries.length ? entries.length : i + _batchLimit,
      );

      final batch = _firestore.batch();
      for (final entry in chunk) {
        batch.set(collection.doc(entry.key), entry.value);
      }
      await batch.commit().timeout(_writeTimeout);

      // Only after the batch genuinely committed does the local state
      // record these rows as pushed - a failed/timed-out batch leaves
      // the state untouched so the next pass retries them.
      final stateBatch = db.batch();
      for (final entry in chunk) {
        stateBatch.insert(
          'cloud_sync_state',
          {
            'table_name': table,
            'row_id': entry.key,
            'row_hash': _rowHash(entry.value),
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
      await stateBatch.commit(noResult: true);

      done += chunk.length;
    }

    return done;
  }

  Future<int> _deleteFromTable(
    Database db,
    String uid,
    String table,
    List<String> toDelete,
  ) async {
    if (toDelete.isEmpty) return 0;

    final collection = _tableCollection(uid, table);
    var done = 0;

    for (var i = 0; i < toDelete.length; i += _batchLimit) {
      final chunk = toDelete.sublist(
        i,
        i + _batchLimit > toDelete.length ? toDelete.length : i + _batchLimit,
      );

      final batch = _firestore.batch();
      for (final id in chunk) {
        batch.delete(collection.doc(id));
      }
      await batch.commit().timeout(_writeTimeout);

      final stateBatch = db.batch();
      for (final id in chunk) {
        stateBatch.delete(
          'cloud_sync_state',
          where: 'table_name = ? AND row_id = ?',
          whereArgs: [table, id],
        );
      }
      await stateBatch.commit(noResult: true);

      done += chunk.length;
    }

    return done;
  }

  /// Pulls every synced table's cloud rows back into local SQLite.
  /// Insert uses REPLACE keyed on the row's own UUID id, so restoring
  /// on top of existing local data merges by identity - it can never
  /// duplicate a document, and rows that exist only locally are left
  /// exactly as they are.
  Future<CloudSyncResult> restoreFromCloud() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) {
      return const CloudSyncResult(error: 'Not signed in.');
    }

    try {
      final db = await AppDatabase.instance.database;
      var restored = 0;

      for (final table in syncedTables) {
        final snapshot =
            await _tableCollection(uid, table).get().timeout(_readTimeout);
        if (snapshot.docs.isEmpty) continue;

        // Only columns this install's schema actually has - a cloud
        // row written by a NEWER app version may carry columns this
        // build doesn't know yet; dropping them (instead of failing
        // the insert) restores everything restorable.
        final columnInfo = await db.rawQuery('PRAGMA table_info($table)');
        final validColumns =
            columnInfo.map((c) => c['name'] as String).toSet();

        final insertBatch = db.batch();
        final restoredIds = <String>[];

        for (final doc in snapshot.docs) {
          final data = doc.data();
          final row = <String, Object?>{
            for (final entry in data.entries)
              if (validColumns.contains(entry.key)) entry.key: entry.value,
          };
          if (!row.containsKey('id') ||
              (row['id'] as String?)?.isEmpty != false) {
            continue;
          }

          insertBatch.insert(
            table,
            row,
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
          restoredIds.add(row['id'] as String);
        }

        if (restoredIds.isEmpty) continue;

        await insertBatch.commit(noResult: true);
        restored += restoredIds.length;

        // Mark ONLY the restored rows as already-pushed (hashes read
        // back from what SQLite now genuinely holds), so the next
        // backup pass doesn't immediately re-push everything it just
        // downloaded. Rows that existed only locally are deliberately
        // NOT marked - they still need their first push.
        await _recordHashesFor(db, table, restoredIds);
      }

      return CloudSyncResult(restored: restored);
    } catch (e) {
      debugPrint('Document cloud restore failed: $e');
      return CloudSyncResult(error: e.toString());
    }
  }

  Future<void> _recordHashesFor(
    Database db,
    String table,
    List<String> ids,
  ) async {
    const chunkSize = 400;

    for (var i = 0; i < ids.length; i += chunkSize) {
      final chunk = ids.sublist(
        i,
        i + chunkSize > ids.length ? ids.length : i + chunkSize,
      );

      final placeholders = List.filled(chunk.length, '?').join(',');
      final rows = await db.query(
        table,
        where: 'id IN ($placeholders)',
        whereArgs: chunk,
      );

      final stateBatch = db.batch();
      for (final row in rows) {
        final id = row['id'] as String?;
        if (id == null || id.isEmpty) continue;

        stateBatch.insert(
          'cloud_sync_state',
          {
            'table_name': table,
            'row_id': id,
            'row_hash': _rowHash(row),
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
      await stateBatch.commit(noResult: true);
    }
  }

  /// Deletes every backed-up document from the cloud for the current
  /// account - the document-level counterpart to Delete Account's own
  /// companies/{uid} profile-doc delete. Must run while the user is
  /// still signed in (the Security Rule only allows the owner to
  /// write under their own uid); best-effort like the profile-doc
  /// delete - a connectivity failure never blocks the account
  /// deletion itself.
  Future<void> wipeCloudBackup() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) return;

    for (final table in syncedTables) {
      try {
        // Firestore has no "delete collection" - page through and
        // batch-delete until the subcollection is empty.
        while (true) {
          final snapshot = await _tableCollection(uid, table)
              .limit(_batchLimit)
              .get()
              .timeout(_readTimeout);
          if (snapshot.docs.isEmpty) break;

          final batch = _firestore.batch();
          for (final doc in snapshot.docs) {
            batch.delete(doc.reference);
          }
          await batch.commit().timeout(_writeTimeout);
        }
      } catch (e) {
        debugPrint('Cloud backup wipe failed for $table: $e');
      }
    }

    // The local bookkeeping no longer reflects anything in the cloud.
    try {
      final db = await AppDatabase.instance.database;
      await db.delete('cloud_sync_state');
    } catch (_) {
      // Bookkeeping only - stale rows just mean a re-push later.
    }
  }

  Future<void> _recordBackupTime() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        lastBackupPrefsKey,
        DateTime.now().toIso8601String(),
      );
    } catch (_) {
      // Purely informational - never fail a sync over it.
    }
  }

  static Future<DateTime?> lastBackupTime() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(lastBackupPrefsKey);
      if (raw == null || raw.isEmpty) return null;
      return DateTime.tryParse(raw);
    } catch (_) {
      return null;
    }
  }

  /// A stable content hash of one row: keys sorted (SplayTreeMap) so
  /// the same data always encodes identically regardless of column
  /// order, then FNV-1a 64-bit over the JSON - deterministic across
  /// app restarts (unlike Object.hash, which Dart documents as not
  /// guaranteed stable between runs).
  String _rowHash(Map<String, dynamic> row) {
    final canonical = jsonEncode(
      SplayTreeMap<String, dynamic>.from(row),
      toEncodable: (value) => value.toString(),
    );

    var hash = 0xcbf29ce484222325;
    for (final unit in canonical.codeUnits) {
      hash ^= unit;
      hash = (hash * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF;
    }

    return hash.toRadixString(16);
  }
}
