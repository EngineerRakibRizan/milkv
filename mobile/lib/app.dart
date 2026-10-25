import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth/session.dart';
import 'core/providers.dart';
import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_shell.dart';

class AuraDairyApp extends ConsumerWidget {
  const AuraDairyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lang = ref.watch(langProvider);
    final auth = ref.watch(authProvider);
    return MaterialApp(
      title: 'Aura Dairy',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(lang),
      darkTheme: buildTheme(lang, brightness: Brightness.dark),
      locale: Locale(lang),
      supportedLocales: const [Locale('bn'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: switch (auth.status) {
        AuthStatus.loading => const _Splash(),
        AuthStatus.signedOut => const LoginScreen(),
        AuthStatus.signedIn when auth.needsFarm => const FarmPickerScreen(),
        // Keyed by farm so switching farms starts every screen fresh.
        AuthStatus.signedIn => HomeShell(key: ValueKey('farm-${auth.farmId}')),
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: Brand.primary,
        body: Center(child: CircularProgressIndicator(color: Colors.white)),
      );
}
