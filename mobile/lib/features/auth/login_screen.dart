import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool busy = false;
  bool hidden = true;
  String? error;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref.read(authProvider.notifier).login(email.text, password.text);
    } on ApiError catch (e) {
      final tr = ref.read(trProvider);
      setState(() => error = e.offline ? tr.t('m.needsOnline', fallback: 'This needs an internet connection.') : (e.field('email') ?? e.message));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final lang = ref.watch(langProvider);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Brand.primary,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        key: const Key('lang-toggle'),
                        onPressed: () => ref.read(langProvider.notifier).set(lang == 'bn' ? 'en' : 'bn'),
                        child: Text(
                          lang == 'bn' ? 'English' : 'বাংলা',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                    ClipRRect(borderRadius: BorderRadius.circular(22), child: Image.asset('assets/icon/icon-512.png', width: 88, height: 88)),
                    const SizedBox(height: 12),
                    Text(
                      tr.t('m.appName', fallback: 'Aura Dairy'),
                      style: const TextStyle(fontFamily: 'BalooDa2', fontSize: 32, fontWeight: FontWeight.w800, color: Colors.white),
                    ),
                    Text(
                      tr.t('auth.subtitle'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 24),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Form(
                          key: _form,
                          child: AutofillGroup(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(tr.t('auth.welcome'), style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                                const SizedBox(height: 16),
                                TextFormField(
                                  key: const Key('login-email'),
                                  controller: email,
                                  keyboardType: TextInputType.emailAddress,
                                  autofillHints: const [AutofillHints.email, AutofillHints.username],
                                  textInputAction: TextInputAction.next,
                                  decoration: InputDecoration(labelText: tr.t('auth.email'), prefixIcon: const Icon(Icons.alternate_email)),
                                  validator: (v) => (v ?? '').contains('@') ? null : tr.t('auth.email'),
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  key: const Key('login-password'),
                                  controller: password,
                                  obscureText: hidden,
                                  autofillHints: const [AutofillHints.password],
                                  textInputAction: TextInputAction.done,
                                  onFieldSubmitted: (_) => _submit(),
                                  decoration: InputDecoration(
                                    labelText: tr.t('auth.password'),
                                    prefixIcon: const Icon(Icons.lock_outline),
                                    suffixIcon: IconButton(
                                      onPressed: () => setState(() => hidden = !hidden),
                                      icon: Icon(hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                                    ),
                                  ),
                                  validator: (v) => (v ?? '').isEmpty ? tr.t('auth.password') : null,
                                ),
                                if (error != null) ...[
                                  const SizedBox(height: 12),
                                  Text(
                                    error!,
                                    key: const Key('login-error'),
                                    style: const TextStyle(color: Brand.danger),
                                  ),
                                ],
                                const SizedBox(height: 20),
                                FilledButton(
                                  key: const Key('login-submit'),
                                  onPressed: busy ? null : _submit,
                                  child: busy
                                      ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                                      : Text(tr.t('auth.login')),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown when the account belongs to several farms and none is chosen yet.
class FarmPickerScreen extends ConsumerWidget {
  const FarmPickerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final auth = ref.watch(authProvider);
    final farms = auth.me?.farms ?? const [];
    return Scaffold(
      appBar: AppBar(
        title: Text(tr.t('m.chooseFarm', fallback: 'Choose a farm')),
        actions: [IconButton(tooltip: tr.t('common.logout'), onPressed: () => ref.read(authProvider.notifier).logout(), icon: const Icon(Icons.logout))],
      ),
      body: farms.isEmpty
          ? EmptyState(
              icon: Icons.agriculture_outlined,
              title: tr.t('m.noFarm', fallback: 'Your account is not part of any farm yet. Ask the farm owner to add you.'),
            )
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                for (final f in farms)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      leading: const CircleAvatar(backgroundColor: Brand.primarySoft, foregroundColor: Brand.primary, child: Icon(Icons.agriculture_outlined)),
                      title: Text(f.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(tr.t('roles.${f.role}')),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => ref.read(authProvider.notifier).selectFarm(f.id),
                    ),
                  ),
              ],
            ),
    );
  }
}
