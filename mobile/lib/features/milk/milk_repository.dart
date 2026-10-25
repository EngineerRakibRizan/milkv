import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/outbox.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';

/// `GET /milk/sheet?date=` (MilkController::sheet).
class MilkRow {
  MilkRow({required this.animalId, required this.tag, this.name, required this.morning, required this.evening, required this.other, required this.total, this.recorded = false});

  final int animalId;
  final String tag;
  final String? name;
  final String morning;
  final String evening;
  final String other;
  final String total;
  final bool recorded;

  factory MilkRow.fromJson(Map<String, dynamic> j) => MilkRow(
        animalId: j['animal_id'] as int,
        tag: '${j['tag'] ?? ''}',
        name: j['name'] as String?,
        morning: '${j['morning'] ?? '0'}',
        evening: '${j['evening'] ?? '0'}',
        other: '${j['other'] ?? '0'}',
        total: '${j['total'] ?? '0'}',
        recorded: j['recorded'] == true,
      );
}

class MilkSheet {
  MilkSheet(this.date, this.rows, this.summary);

  final String date;
  final List<MilkRow> rows;
  final Map<String, dynamic> summary;

  factory MilkSheet.fromJson(dynamic j) => MilkSheet(
        '${j['date']}',
        [for (final r in j['rows'] as List) MilkRow.fromJson(Map<String, dynamic>.from(r as Map))],
        Map<String, dynamic>.from(j['summary'] as Map? ?? const {}),
      );
}

class MilkEntry {
  const MilkEntry(this.animalId, {this.morning = '', this.evening = '', this.other = '0'});

  final int animalId;
  final String morning;
  final String evening;
  final String other;

  Map<String, dynamic> toJson() => {
        'animal_id': animalId,
        'morning': morning.isEmpty ? 0 : morning,
        'evening': evening.isEmpty ? 0 : evening,
        'other': other,
      };
}

class MilkRepository {
  MilkRepository(this._cache, this._outbox);

  final QueryCache _cache;
  final Outbox _outbox;

  Stream<Cached<MilkSheet>> sheet(String date) => _cache.watch('/milk/sheet', MilkSheet.fromJson, query: {'date': date});

  /// Saves the whole day in one request (the server's save is idempotent per value too).
  Future<WriteResult> saveSheet(String date, List<MilkEntry> rows) async {
    final r = await _outbox.send('POST', '/milk/sheet', body: {'date': date, 'rows': [for (final e in rows) e.toJson()]}, label: 'milk:$date');
    if (!r.queued) {
      await _cache.put('/milk/sheet', r.data, query: {'date': date});
    } else {
      // Show what was entered until the server confirms it.
      final byId = {for (final e in rows) e.animalId: e};
      await _cache.patch('/milk/sheet', query: {'date': date}, (data) {
        final m = Map<String, dynamic>.from(data as Map);
        m['rows'] = [
          for (final raw in m['rows'] as List)
            () {
              final row = Map<String, dynamic>.from(raw as Map);
              final e = byId[row['animal_id']];
              if (e == null) return row;
              final total = Fmt.parse(e.morning) + Fmt.parse(e.evening) + Fmt.parse(e.other);
              return {...row, 'morning': e.morning.isEmpty ? '0' : e.morning, 'evening': e.evening.isEmpty ? '0' : e.evening, 'total': '$total', 'recorded': true};
            }(),
        ];
        return m;
      });
    }
    return r;
  }

  /// Household use / spoilage (`POST /milk/out`).
  Future<WriteResult> recordOut({required String date, required String type, required String quantity, String? notes}) =>
      _outbox.send('POST', '/milk/out', body: {'date': date, 'type': type, 'quantity': quantity, 'notes': notes}, label: 'milk-out:$date');
}

final milkRepositoryProvider = Provider((ref) => MilkRepository(ref.watch(queryCacheProvider), ref.watch(outboxProvider)));

final milkSheetProvider = StreamProvider.autoDispose.family<Cached<MilkSheet>, String>((ref, date) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(milkRepositoryProvider).sheet(date);
});
