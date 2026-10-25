import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../customers/customers_screen.dart';
import '../dashboard/dashboard_screen.dart';
import '../deliveries/deliveries_screen.dart';
import '../milk/milk_sheet_screen.dart';
import '../notifications/notifications_screen.dart';
import '../tasks/tasks_screen.dart';
import 'more_screen.dart';

class _Tab {
  const _Tab(this.id, this.ability, this.icon, this.selectedIcon, this.label);

  final String id;
  final String ability;
  final IconData icon;
  final IconData selectedIcon;
  final String label;
}

const _candidates = [
  _Tab('dashboard', 'dashboard.view', Icons.home_outlined, Icons.home_rounded, 'nav.dashboard'),
  _Tab('milk', 'milk.view', Icons.water_drop_outlined, Icons.water_drop_rounded, 'nav.milk'),
  _Tab('deliveries', 'deliveries.view', Icons.local_shipping_outlined, Icons.local_shipping_rounded, 'nav.deliveries'),
  _Tab('customers', 'customers.view', Icons.people_outline, Icons.people_rounded, 'nav.customers'),
  _Tab('tasks', 'tasks.view', Icons.checklist_outlined, Icons.checklist_rounded, 'nav.tasks'),
];

/// Bottom navigation built from the role's abilities: up to four daily
/// screens the user may open, plus "More". Also drives background sync.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> with WidgetsBindingObserver {
  String current = '';
  StreamSubscription<bool>? _net;
  Timer? _timer;
  int _lastPending = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _net = ref.read(connectivityProvider).listen((online) {
      if (online) _sync();
    });
    // Retry queued writes now and then while any are waiting (networks come back silently).
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_lastPending > 0) _sync();
    });
    _sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _net?.cancel();
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _sync();
      ref.read(syncEpochProvider.notifier).bump(); // reopened: show fresh data
    }
  }

  Future<void> _sync() => ref.read(outboxProvider).flush();

  @override
  Widget build(BuildContext context) {
    final tr = ref.watch(trProvider);
    final auth = ref.watch(authProvider);
    ref.listen(outboxStatusProvider, (prev, next) {
      final pending = next.value?.pending ?? 0;
      // Everything queued has reached the server: reload screens from it.
      if (_lastPending > 0 && pending == 0) ref.read(syncEpochProvider.notifier).bump();
      _lastPending = pending;
    });
    final unread = auth.can('notifications.view') ? ref.watch(unreadCountProvider) : 0;

    final tabs = _candidates.where((t) => auth.can(t.ability)).take(4).toList();
    final ids = [...tabs.map((t) => t.id), 'more'];
    final index = ids.contains(current) ? ids.indexOf(current) : 0;

    Widget screen(String id) => switch (id) {
          'dashboard' => DashboardScreen(onOpenTab: (t) => setState(() => current = ids.contains(t) ? t : current)),
          'milk' => const MilkSheetScreen(),
          'deliveries' => const DeliveriesScreen(),
          'customers' => const CustomersScreen(),
          'tasks' => const TasksScreen(),
          _ => MoreScreen(tabs: ids),
        };

    return Scaffold(
      body: Column(children: [
        const _SyncBanner(),
        Expanded(child: IndexedStack(index: index, children: [for (final id in ids) screen(id)])),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => current = ids[i]),
        destinations: [
          for (final t in tabs) NavigationDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selectedIcon), label: tr.t(t.label)),
          NavigationDestination(
            icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.menu_rounded)),
            label: tr.t('m.more', fallback: 'More'),
          ),
        ],
      ),
    );
  }
}

/// "3 changes waiting to sync" — visible whenever the outbox is not empty.
class _SyncBanner extends ConsumerWidget {
  const _SyncBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(outboxStatusProvider).value;
    final tr = ref.watch(trProvider);
    if (status == null || (status.pending == 0 && status.rejected.isEmpty)) return const SizedBox.shrink();
    final rejected = status.pending == 0;
    return Material(
      color: rejected ? Brand.danger : Brand.accent,
      child: SafeArea(
        bottom: false,
        child: InkWell(
          onTap: () => rejected ? showRejected(context, ref) : ref.read(outboxProvider).flush(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(children: [
              if (status.syncing)
                const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Brand.ink))
              else
                Icon(rejected ? Icons.error_outline : Icons.cloud_upload_outlined, size: 18, color: rejected ? Colors.white : Brand.ink),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  rejected
                      ? tr.t('m.rejected', fallback: '{{count}} change(s) were not accepted by the server — tap to see', params: {'count': status.rejected.length})
                      : tr.t('common.offlineQueued', params: {'count': status.pending}),
                  style: TextStyle(fontWeight: FontWeight.w600, color: rejected ? Colors.white : Brand.ink),
                ),
              ),
              if (!rejected) Text(tr.t('m.syncNow', fallback: 'Sync now'), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink)),
            ]),
          ),
        ),
      ),
    );
  }
}

Future<void> showRejected(BuildContext context, WidgetRef ref) {
  final tr = ref.read(trProvider);
  final fmt = ref.read(fmtProvider);
  final items = ref.read(outboxProvider).rejected;
  return showModalBottomSheet<void>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          child: Text(tr.t('m.rejectedTitle', fallback: 'Not saved on the server'), style: Theme.of(ctx).textTheme.titleLarge),
        ),
        for (final r in items)
          ListTile(
            leading: const Icon(Icons.error_outline, color: Brand.danger),
            title: Text('${r.item.method} ${r.item.path}'),
            subtitle: Text('${r.message}\n${fmt.dateTime(r.item.createdAt.toIso8601String())}'),
            isThreeLine: true,
          ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: () {
              ref.read(outboxProvider).dismissRejected();
              Navigator.pop(ctx);
            },
            child: Text(tr.t('m.dismiss', fallback: 'OK, dismiss')),
          ),
        ),
      ]),
    ),
  );
}
