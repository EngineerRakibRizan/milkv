import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/providers.dart';
import 'forms.dart';

/// Reference lists for pickers, read through the same offline cache as screens.
List<Map<String, dynamic>> _rows(dynamic j) => [for (final x in (j is Map ? j['data'] : j) as List) Map<String, dynamic>.from(x as Map)];

StreamProvider<List<Map<String, dynamic>>> _lookup(String path, [Map<String, dynamic>? query]) =>
    StreamProvider.autoDispose<List<Map<String, dynamic>>>((ref) {
      ref.watch(syncEpochProvider);
      ref.watch(authProvider.select((s) => s.farmId));
      return ref.watch(queryCacheProvider).watch(path, _rows, query: query).map((c) => c.data);
    });

final suppliersLookup = _lookup('/suppliers');
final feedItemsLookup = _lookup('/inventory');
final accountsLookup = _lookup('/accounts');
final animalsLookup = _lookup('/animals', {'per_page': 100});
final flocksLookup = _lookup('/flocks');
final customersLookup = _lookup('/customers', {'per_page': 100});

/// Animal or flock, as the vet and feed forms address them.
class Subject {
  const Subject(this.type, this.id);

  final String type; // 'animal' | 'flock'
  final int id;

  @override
  bool operator ==(Object other) => other is Subject && other.type == type && other.id == id;

  @override
  int get hashCode => Object.hash(type, id);
}

final subjectOptionsProvider = Provider.autoDispose<List<PickOption<Subject>>>((ref) {
  final animals = ref.watch(animalsLookup).value ?? const [];
  final flocks = ref.watch(flocksLookup).value ?? const [];
  return [
    for (final a in animals)
      PickOption(Subject('animal', a['id'] as int), (a['name'] as String?)?.isNotEmpty == true ? '${a['tag']} · ${a['name']}' : '${a['tag']}',
          subtitle: a['type'] as String?),
    for (final f in flocks) PickOption(Subject('flock', f['id'] as int), '${f['name']}', subtitle: f['species'] as String?),
  ];
});

/// Account key → display name ("egg_sales" → "Egg sales") for category labels.
final accountNamesProvider = Provider.autoDispose<Map<String, String>>(
    (ref) => {for (final a in ref.watch(accountsLookup).value ?? const <Map<String, dynamic>>[]) '${a['key']}': '${a['name']}'});
