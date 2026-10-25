import 'dart:convert';

import 'package:flutter/services.dart';

/// Translations shared with the web app (`assets/i18n/{en,bn}.json` are copies
/// of `frontend/src/locales`) plus mobile-only strings in `mobile.{lang}.json`.
class Translations {
  Translations(this.lang, this._strings, [this._fallback]);

  final String lang;
  final Map<String, dynamic> _strings;
  final Translations? _fallback;

  bool get bn => lang == 'bn';

  static Future<Map<String, Translations>> load([AssetBundle? bundle]) async {
    final b = bundle ?? rootBundle;
    Future<Map<String, dynamic>> read(String name) async => jsonDecode(await b.loadString('assets/i18n/$name.json')) as Map<String, dynamic>;
    final en = Translations('en', _merge(await read('en'), await read('mobile.en')));
    final bn = Translations('bn', _merge(await read('bn'), await read('mobile.bn')), en);
    return {'en': en, 'bn': bn};
  }

  static Map<String, dynamic> _merge(Map<String, dynamic> a, Map<String, dynamic> b) {
    final out = Map<String, dynamic>.of(a);
    b.forEach((k, v) => out[k] = v is Map<String, dynamic> && out[k] is Map<String, dynamic> ? _merge(out[k] as Map<String, dynamic>, v) : v);
    return out;
  }

  String? _lookup(String key) {
    dynamic node = _strings;
    for (final part in key.split('.')) {
      if (node is! Map) return null;
      node = node[part];
    }
    return node is String ? node : null;
  }

  /// `t('milk.morning')`, `t('common.offlineQueued', params: {'count': 3})`.
  String t(String key, {String? fallback, Map<String, Object?> params = const {}}) {
    var s = _lookup(key) ?? _fallback?._lookup(key) ?? fallback ?? key;
    params.forEach((k, v) => s = s.replaceAll('{{$k}}', bn ? toBanglaDigits('$v') : '$v'));
    return s;
  }
}

const _bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

String toBanglaDigits(String s) => s.replaceAllMapped(RegExp(r'[0-9]'), (m) => _bnDigits[int.parse(m[0]!)]);
