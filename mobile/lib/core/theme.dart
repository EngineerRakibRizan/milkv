import 'package:flutter/material.dart';

/// Brand palette from the web app (tailwind config / index.css).
class Brand {
  static const primary = Color(0xFF166534);
  static const primaryDark = Color(0xFF0F3D22);
  static const primarySoft = Color(0xFFDCFCE7);
  static const accent = Color(0xFFF2B632);
  static const canvas = Color(0xFFF8FAFC);
  static const surface = Colors.white;
  static const ink = Color(0xFF0F172A);
  static const muted = Color(0xFF64748B);
  static const line = Color(0xFFE2E8F0);
  static const danger = Color(0xFFDC2626);
  static const warning = Color(0xFFD97706);
  static const info = Color(0xFF2563EB);
}

ThemeData buildTheme(String lang, {Brightness brightness = Brightness.light}) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.primary,
    brightness: brightness,
    primary: dark ? const Color(0xFF4ADE80) : Brand.primary,
    onPrimary: dark ? Brand.primaryDark : Colors.white,
    secondary: Brand.accent,
    onSecondary: Brand.ink,
    surface: dark ? const Color(0xFF111827) : Brand.surface,
    error: Brand.danger,
  );
  // Hind Siliguri carries Bangla well and has Latin; Inter reads better for English.
  final family = lang == 'bn' ? 'HindSiliguri' : 'Inter';
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: family, fontFamilyFallback: const ['HindSiliguri', 'Inter']);
  final radius = BorderRadius.circular(14);

  return base.copyWith(
    scaffoldBackgroundColor: dark ? const Color(0xFF0B1220) : Brand.canvas,
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? const Color(0xFF0B1220) : Brand.canvas,
      foregroundColor: dark ? Colors.white : Brand.ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: 'BalooDa2', fontSize: 22, fontWeight: FontWeight.w700, color: dark ? Colors.white : Brand.ink),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: dark ? const Color(0xFF1F2937) : Brand.line)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? const Color(0xFF0F172A) : Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: Brand.line)),
      enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: dark ? const Color(0xFF334155) : Brand.line)),
      focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: scheme.primary, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 52),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: TextStyle(fontFamily: family, fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: TextStyle(fontFamily: family, fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 68,
      backgroundColor: scheme.surface,
      indicatorColor: dark ? const Color(0xFF14532D) : Brand.primarySoft,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontFamily: family, fontSize: 12, fontWeight: FontWeight.w600)),
    ),
    chipTheme: base.chipTheme.copyWith(shape: const StadiumBorder(), side: BorderSide(color: dark ? const Color(0xFF334155) : Brand.line)),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    dividerTheme: DividerThemeData(color: dark ? const Color(0xFF1F2937) : Brand.line, space: 1),
  );
}
