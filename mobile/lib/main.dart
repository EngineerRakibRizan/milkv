import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:path_provider/path_provider.dart';

import 'app.dart';
import 'core/i18n/i18n.dart';
import 'core/providers.dart';
import 'core/storage/local_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final dir = await getApplicationSupportDirectory();
  final results = await Future.wait([
    HiveStore.open(dir.path),
    Translations.load(),
    initializeDateFormatting('bn'),
    initializeDateFormatting('en'),
  ]);
  runApp(ProviderScope(
    overrides: [
      localStoreProvider.overrideWithValue(results[0] as LocalStore),
      translationsProvider.overrideWithValue(results[1] as Map<String, Translations>),
    ],
    child: const AuraDairyApp(),
  ));
}
