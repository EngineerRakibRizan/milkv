import 'package:flutter/services.dart';

const _bn = '০১২৩৪৫৬৭৮৯';

/// Decimal entry that also accepts Bangla digits (০-৯) from a Bangla keyboard
/// and a comma as decimal separator, normalising to "12.5".
class DecimalInputFormatter extends TextInputFormatter {
  DecimalInputFormatter({this.decimals = 3});

  final int decimals;

  static String normalise(String s) {
    final b = StringBuffer();
    for (final ch in s.split('')) {
      final i = _bn.indexOf(ch);
      b.write(i >= 0 ? '$i' : ch == ',' || ch == '।' ? '.' : ch);
    }
    return b.toString();
  }

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = normalise(newValue.text);
    if (!RegExp('^\\d*(\\.\\d{0,$decimals})?\$').hasMatch(text)) return oldValue;
    return newValue.copyWith(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}

/// "12.500" → "12.5", "0.000" → "" (an empty field reads better than a zero).
String trimZero(String v) {
  final n = double.tryParse(v) ?? 0;
  if (n == 0) return '';
  return n == n.roundToDouble() ? n.toInt().toString() : n.toString();
}
