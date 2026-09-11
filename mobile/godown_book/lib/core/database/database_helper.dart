import 'package:sqflite/sqflite.dart';

import '../tenant/tenant_scope.dart';
import 'app_database.dart';
import 'database_constants.dart';

class DatabaseHelper {
  DatabaseHelper._();

  static final DatabaseHelper instance = DatabaseHelper._();

  Future<Database> get database async {
    return AppDatabase.instance.database;
  }

  // ==========================
  // INSERT
  // ==========================

  Future<int> insert(String table, Map<String, dynamic> values) async {
    final db = await database;

    return db.insert(
      table,
      values,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // ==========================
  // QUERY
  // ==========================

  Future<List<Map<String, dynamic>>> query(String table) async {
    final db = await database;

    return db.query(table);
  }

  Future<List<Map<String, dynamic>>> queryWhere(
    String table, {
    String? where,
    List<Object?>? whereArgs,
    String? orderBy,
    int? limit,
  }) async {
    final db = await database;

    return db.query(
      table,
      where: where,
      whereArgs: whereArgs,
      orderBy: orderBy,
      limit: limit,
    );
  }

  // ==========================
  // UPDATE
  // ==========================

  Future<int> update(
    String table,
    Map<String, dynamic> values,
    String id,
  ) async {
    final db = await database;

    return db.update(table, values, where: 'id = ?', whereArgs: [id]);
  }

  Future<int> updateWhere(
    String table,
    Map<String, dynamic> values,
    String where,
    List<Object?> whereArgs,
  ) async {
    final db = await database;

    return db.update(table, values, where: where, whereArgs: whereArgs);
  }

  // ==========================
  // DELETE
  // ==========================

  Future<int> delete(String table, String id) async {
    final db = await database;

    return db.delete(table, where: 'id = ?', whereArgs: [id]);
  }

  // ==========================
  // TENANT SCOPED
  // ==========================
  //
  // Business tables must never be read or written without a company filter.
  // Screens and repositories call these instead of the raw methods above, so
  // a forgotten WHERE clause cannot leak another company's data.

  /// Inserts [values] stamped with the active company.
  Future<int> insertScoped(String table, Map<String, dynamic> values) async {
    final db = await database;

    return db.insert(
      table,
      {...values, DatabaseConstants.companyIdColumn: TenantScope.companyId},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Queries [table] restricted to the active company.
  Future<List<Map<String, dynamic>>> queryScoped(
    String table, {
    String? where,
    List<Object?>? whereArgs,
    String? orderBy,
    int? limit,
  }) async {
    final db = await database;

    final tenantClause = '${DatabaseConstants.companyIdColumn} = ?';

    return db.query(
      table,
      where: where == null ? tenantClause : '$tenantClause AND ($where)',
      whereArgs: [TenantScope.companyId, ...?whereArgs],
      orderBy: orderBy,
      limit: limit,
    );
  }

  /// Updates a row by id, but only if it belongs to the active company.
  Future<int> updateScoped(
    String table,
    Map<String, dynamic> values,
    String id,
  ) async {
    final db = await database;

    return db.update(
      table,
      {...values, DatabaseConstants.companyIdColumn: TenantScope.companyId},
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, TenantScope.companyId],
    );
  }

  Future<int> updateWhereScoped(
    String table,
    Map<String, dynamic> values,
    String where,
    List<Object?> whereArgs,
  ) async {
    final db = await database;

    return db.update(
      table,
      values,
      where: '${DatabaseConstants.companyIdColumn} = ? AND ($where)',
      whereArgs: [TenantScope.companyId, ...whereArgs],
    );
  }

  Future<int> deleteScoped(String table, String id) async {
    final db = await database;

    return db.delete(
      table,
      where: 'id = ? AND ${DatabaseConstants.companyIdColumn} = ?',
      whereArgs: [id, TenantScope.companyId],
    );
  }

  Future<int> deleteWhereScoped(
    String table,
    String where,
    List<Object?> whereArgs,
  ) async {
    final db = await database;

    return db.delete(
      table,
      where: '${DatabaseConstants.companyIdColumn} = ? AND ($where)',
      whereArgs: [TenantScope.companyId, ...whereArgs],
    );
  }

  // ==========================
  // RAW SQL
  // ==========================

  Future<List<Map<String, dynamic>>> rawQuery(
    String sql, [
    List<Object?>? arguments,
  ]) async {
    final db = await database;

    return db.rawQuery(sql, arguments);
  }

  Future<int> rawInsert(String sql, [List<Object?>? arguments]) async {
    final db = await database;

    return db.rawInsert(sql, arguments);
  }

  Future<int> rawUpdate(String sql, [List<Object?>? arguments]) async {
    final db = await database;

    return db.rawUpdate(sql, arguments);
  }

  Future<int> rawDelete(String sql, [List<Object?>? arguments]) async {
    final db = await database;

    return db.rawDelete(sql, arguments);
  }

  // ==========================
  // TRANSACTION
  // ==========================

  Future<T> transaction<T>(Future<T> Function(Transaction txn) action) async {
    final db = await database;
    return db.transaction(action);
  }

  // ==========================
  // CLEAR TABLE
  // ==========================

  Future<void> clearTable(String table) async {
    final db = await database;
    await db.delete(table);
  }

  // ==========================
  // CLOSE DATABASE
  // ==========================

  Future<void> close() async {
    final db = await database;
    await db.close();
  }
}
