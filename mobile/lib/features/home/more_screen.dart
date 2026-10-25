import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../customers/customers_screen.dart';
import '../leads/leads_screen.dart';
import '../notifications/notifications_screen.dart';
import '../tasks/tasks_screen.dart';
import 'home_shell.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key, required this.tabs});

  /// Screens already on the bottom bar (not repeated here).
  final List<String> tabs;

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final tr = ref.read(trProvider);
    final pending = ref.read(outboxProvider).status.pending;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr.t('common.logout')),
        content: Text(pending > 0
            ? tr.t('m.logoutPending', fallback: '{{count}} change(s) have not synced yet and will be lost if you sign out now.', params: {'count': pending})
            : tr.t('common.areYouSure')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(tr.t('common.cancel'))),
          FilledButton(
            style: pending > 0 ? FilledButton.styleFrom(backgroundColor: Brand.danger) : null,
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(tr.t('common.logout')),
          ),
        ],
      ),
    );
    if (ok == true) await ref.read(authProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.watch(trProvider);
    final auth = ref.watch(authProvider);
    final lang = ref.watch(langProvider);
    final outbox = ref.watch(outboxStatusProvider).value;
    final unread = auth.can('notifications.view') ? ref.watch(unreadCountProvider) : 0;
    final farm = auth.farm;

    void push(Widget w) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => w));

    Widget item(IconData icon, String label, VoidCallback onTap, {Widget? trailing}) => ListTile(
          leading: Icon(icon, color: Theme.of(context).colorScheme.primary),
          title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          trailing: trailing ?? const Icon(Icons.chevron_right),
          minVerticalPadding: 14,
          onTap: onTap,
        );

    return Scaffold(
      appBar: AppBar(title: Text(tr.t('m.more', fallback: 'More'))),
      body: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 24), children: [
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(14),
            leading: CircleAvatar(
              radius: 26,
              backgroundColor: Brand.primary,
              foregroundColor: Colors.white,
              child: Text((auth.me?.user.name ?? '?').characters.first.toUpperCase(), style: const TextStyle(fontSize: 22)),
            ),
            title: Text(auth.me?.user.name ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
            subtitle: Text('${farm?.name ?? ''} · ${tr.t('roles.${farm?.role ?? ''}')}\n${auth.me?.user.email ?? ''}'),
            isThreeLine: true,
          ),
        ),
        const SizedBox(height: 8),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            if (auth.can('leads.view')) item(Icons.inbox_outlined, tr.t('nav.leads'), () => push(const LeadsScreen())),
            if (auth.can('tasks.view') && !tabs.contains('tasks')) item(Icons.checklist_rounded, tr.t('nav.tasks'), () => push(const TasksScreen())),
            if (auth.can('customers.view') && !tabs.contains('customers')) item(Icons.people_outline, tr.t('nav.customers'), () => push(const CustomersScreen())),
            if (auth.can('notifications.view'))
              item(Icons.notifications_none_rounded, tr.t('nav.notifications'), () => push(const NotificationsScreen()),
                  trailing: unread > 0 ? Badge(label: Text('$unread')) : null),
          ]),
        ),
        const SizedBox(height: 8),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            item(
              Icons.cloud_sync_outlined,
              tr.t('m.sync', fallback: 'Sync'),
              () => (outbox?.rejected.isNotEmpty ?? false) ? showRejected(context, ref) : ref.read(outboxProvider).flush(),
              trailing: Text(
                (outbox?.pending ?? 0) > 0 ? tr.t('common.offlineQueued', params: {'count': outbox!.pending}) : tr.t('milk.allSaved'),
                style: TextStyle(color: (outbox?.pending ?? 0) > 0 ? Brand.warning : Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
            item(Icons.translate_rounded, tr.t('common.language'), () => ref.read(langProvider.notifier).set(lang == 'bn' ? 'en' : 'bn'),
                trailing: Text(lang == 'bn' ? 'বাংলা' : 'English', style: const TextStyle(fontWeight: FontWeight.w600))),
            if ((auth.me?.farms.length ?? 0) > 1)
              item(Icons.swap_horiz_rounded, tr.t('m.switchFarm', fallback: 'Switch farm'), () => ref.read(authProvider.notifier).chooseAnotherFarm()),
            item(Icons.language_rounded, tr.t('leads.openPage'), () => launchUrl(Uri.parse(AppConfig.webUrl), mode: LaunchMode.externalApplication),
                trailing: const Icon(Icons.open_in_new_rounded, size: 18)),
          ]),
        ),
        const SizedBox(height: 8),
        Card(
          clipBehavior: Clip.antiAlias,
          child: ListTile(
            leading: const Icon(Icons.logout_rounded, color: Brand.danger),
            title: Text(tr.t('common.logout'), style: const TextStyle(color: Brand.danger, fontWeight: FontWeight.w600)),
            onTap: () => _logout(context, ref),
          ),
        ),
      ]),
    );
  }
}
