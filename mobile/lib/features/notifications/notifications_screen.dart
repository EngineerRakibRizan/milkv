import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

class NotificationPage {
  NotificationPage(this.items, this.unread);

  final List<Map<String, dynamic>> items;
  final int unread;

  factory NotificationPage.fromJson(dynamic j) =>
      NotificationPage([for (final n in j['data'] as List) Map<String, dynamic>.from(n as Map)], j['unread'] as int? ?? 0);
}

final notificationsProvider = StreamProvider.autoDispose<Cached<NotificationPage>>((ref) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/notifications', NotificationPage.fromJson, query: {'per_page': 50});
});

/// Unread count for the badge, from whatever the notifications list last returned.
final unreadCountProvider = Provider.autoDispose<int>((ref) => ref.watch(notificationsProvider).value?.data.unread ?? 0);

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  Future<void> _markRead(BuildContext context, WidgetRef ref, [List<int>? ids]) async {
    try {
      final r = await ref.read(outboxProvider).send('POST', '/notifications/read', body: {'ids': ?ids}, label: 'notifications-read');
      await ref.read(queryCacheProvider).patch('/notifications', query: {'per_page': 50}, (data) {
        final m = Map<String, dynamic>.from(data as Map);
        m['data'] = [for (final n in m['data'] as List) ids == null || ids.contains((n as Map)['id']) ? {...(n as Map), 'read': true} : n];
        m['unread'] = ids == null ? 0 : ((m['unread'] as int? ?? 0) - ids.length).clamp(0, 1 << 30);
        return m;
      });
      ref.invalidate(notificationsProvider);
      if (r.queued && context.mounted) showWriteResult(context, ref, r, '');
    } catch (e) {
      if (context.mounted) showError(context, ref, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final value = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(tr.t('nav.notifications')),
        actions: [
          if ((value.value?.data.unread ?? 0) > 0)
            TextButton(onPressed: () => _markRead(context, ref), child: Text(tr.t('notifications.readAll'))),
        ],
      ),
      body: AsyncBody<NotificationPage>(
        value: value,
        onRetry: () => ref.invalidate(notificationsProvider),
        builder: (context, data, meta) => RefreshIndicator(
          onRefresh: () => ref.refresh(notificationsProvider.future),
          child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            StaleNote(meta),
            if (data.items.isEmpty) EmptyState(icon: Icons.notifications_none_rounded, title: tr.t('dashboard.noAlerts')),
            for (final n in data.items)
              ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                leading: Icon(
                  n['severity'] == 'critical' || n['severity'] == 'danger' ? Icons.error_rounded : n['severity'] == 'warning' ? Icons.warning_amber_rounded : Icons.info_outline,
                  color: n['severity'] == 'critical' || n['severity'] == 'danger' ? Brand.danger : n['severity'] == 'warning' ? Brand.warning : Brand.info,
                ),
                title: Text('${n['title'] ?? ''}', style: TextStyle(fontWeight: n['read'] == true ? FontWeight.w400 : FontWeight.w700)),
                subtitle: Text([if ((n['body'] ?? '').toString().isNotEmpty) '${n['body']}', fmt.dateTime(n['created_at'] as String?)].join('\n')),
                isThreeLine: (n['body'] ?? '').toString().isNotEmpty,
                trailing: n['read'] == true
                    ? null
                    : IconButton(tooltip: tr.t('notifications.markRead'), icon: const Icon(Icons.done_rounded), onPressed: () => _markRead(context, ref, [n['id'] as int])),
              ),
          ]),
        ),
      ),
    );
  }
}
