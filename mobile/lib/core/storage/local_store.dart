import 'dart:convert';

import 'package:hive_ce/hive.dart';

/// Small persistent key/value store for JSON: the response cache, the offline
/// outbox and app preferences. Kept behind an interface so tests run in memory.
abstract class LocalStore {
  Object? read(String key);
  Future<void> write(String key, Object? value);
  Future<void> delete(String key);
  Iterable<String> get keys;

  Future<void> deleteWhere(bool Function(String key) test) async {
    for (final k in keys.where(test).toList()) {
      await delete(k);
    }
  }
}

/// Values are stored as JSON strings so nested maps come back as plain
/// `Map<String, dynamic>` (Hive would otherwise return `Map<dynamic, dynamic>`).
class HiveStore extends LocalStore {
  HiveStore(this._box);

  final Box<String> _box;

  static Future<HiveStore> open(String dir, {String name = 'farmos'}) async {
    Hive.init(dir);
    return HiveStore(await Hive.openBox<String>(name));
  }

  @override
  Object? read(String key) {
    final raw = _box.get(key);
    return raw == null ? null : jsonDecode(raw);
  }

  @override
  Future<void> write(String key, Object? value) => _box.put(key, jsonEncode(value));

  @override
  Future<void> delete(String key) => _box.delete(key);

  @override
  Iterable<String> get keys => _box.keys.cast<String>();
}

class MemoryStore extends LocalStore {
  final _data = <String, String>{};

  @override
  Object? read(String key) {
    final raw = _data[key];
    return raw == null ? null : jsonDecode(raw);
  }

  @override
  Future<void> write(String key, Object? value) async => _data[key] = jsonEncode(value);

  @override
  Future<void> delete(String key) async => _data.remove(key);

  @override
  Iterable<String> get keys => _data.keys;
}
