import 'package:intl/intl.dart';

import 'i18n.dart';

/// Display formatting. Money and quantities arrive from the API as decimal
/// strings ("1250.50" taka, "12.500" litres); they are only parsed for display.
class Fmt {
  Fmt(this.lang);

  final String lang;
  bool get bn => lang == 'bn';

  // Bangladesh groups thousands as 1,00,000 (lakh), like the web app's bn-BD/en-BD locale.
  static final _n0 = NumberFormat('#,##,##0', 'en_US');
  static final _n1 = NumberFormat('#,##,##0.#', 'en_US');
  static final _n2 = NumberFormat('#,##,##0.##', 'en_US');

  String digits(String s) => bn ? toBanglaDigits(s) : s;

  static double parse(Object? v) => v is double ? v : v is int ? v.toDouble() : double.tryParse('${v ?? ''}'.trim()) ?? 0;

  String num(Object? v, {int digits = 2}) => this.digits((digits == 0 ? _n0 : digits == 1 ? _n1 : _n2).format(parse(v)));

  String money(Object? v) {
    final n = parse(v);
    return '${n < 0 ? '-' : ''}৳${num(n.abs())}';
  }

  String litres(Object? v) => '${num(v, digits: 1)} ${bn ? 'লি.' : 'L'}';

  String date(String? iso, {bool year = true}) {
    final d = iso == null ? null : DateTime.tryParse(iso);
    if (d == null) return '—';
    return digits(DateFormat(year ? 'd MMM y' : 'd MMM', lang).format(d.toLocal()));
  }

  String dateTime(String? iso) {
    final d = iso == null ? null : DateTime.tryParse(iso);
    if (d == null) return '—';
    return digits(DateFormat('d MMM, h:mm a', lang).format(d.toLocal()));
  }

  String weekday(String iso) => DateFormat('EEEE', lang).format(DateTime.parse(iso));
}

/// Calendar dates as the API expects them: `YYYY-MM-DD` in the phone's local day.
String isoDate(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String today() => isoDate(DateTime.now());
String shiftDate(String iso, int days) {
  final d = DateTime.parse(iso);
  return isoDate(DateTime(d.year, d.month, d.day + days)); // calendar days, safe across DST
}
