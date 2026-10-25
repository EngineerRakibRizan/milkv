import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/offline/outbox.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// Present::task.
class FarmTask {
  FarmTask(this.json);

  final Map<String, dynamic> json;
  int get id => json['id'] as int;
  String get title => '${json['title'] ?? ''}';
  String? get description => json['description'] as String?;
  String? get employee => json['employee'] as String?;
  String get dueDate => '${json['due_date']}';
  String? get dueTime => json['due_time'] as String?;
  String get priority => '${json['priority'] ?? 'normal'}';
  String get status => '${json['status']}';
  bool get overdue => json['overdue'] == true;
  bool get open => status == 'pending' || status == 'in_progress';
}

class TasksRepository {
  TasksRepository(this._cache, this._outbox);

  final QueryCache _cache;
  final Outbox _outbox;

  Stream<Cached<List<FarmTask>>> list(String view) =>
      _cache.watch('/tasks', (j) => [for (final t in j as List) FarmTask(Map<String, dynamic>.from(t as Map))], query: {'view': view});

  Future<WriteResult> setStatus(FarmTask t, String status, String view) async {
    final r = await _outbox.send('PATCH', '/tasks/${t.id}', body: {'status': status}, label: 'task:${t.id}:$status');
    await _cache.patch('/tasks', query: {'view': view}, (data) => [
          for (final x in data as List)
            if ((x as Map)['id'] == t.id) (r.queued ? {...x, 'status': status, 'overdue': false} : r.data) else x,
        ]);
    return r;
  }
}

final tasksRepositoryProvider = Provider((ref) => TasksRepository(ref.watch(queryCacheProvider), ref.watch(outboxProvider)));

final tasksProvider = StreamProvider.autoDispose.family<Cached<List<FarmTask>>, String>((ref, view) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(tasksRepositoryProvider).list(view);
});

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  String view = 'open';

  Future<void> _set(FarmTask t, String status) async {
    try {
      final r = await ref.read(tasksRepositoryProvider).setStatus(t, status, view);
      if (!mounted) return;
      showWriteResult(context, ref, r, '${t.title} — ${ref.read(trProvider).t('status.$status')}');
      ref.invalidate(tasksProvider(view));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final canUpdate = ref.watch(authProvider.select((s) => s.can('tasks.update')));
    final value = ref.watch(tasksProvider(view));
    return Scaffold(
      appBar: AppBar(title: Text(tr.t('nav.tasks'))),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Wrap(spacing: 8, children: [
            for (final v in [('open', tr.t('tasks.open')), ('today', tr.t('common.today')), ('overdue', tr.t('tasks.overdue')), ('done', tr.t('tasks.done'))])
              ChoiceChip(label: Text(v.$2), selected: view == v.$1, onSelected: (_) => setState(() => view = v.$1)),
          ]),
        ),
        Expanded(
          child: AsyncBody<List<FarmTask>>(
            value: value,
            onRetry: () => ref.invalidate(tasksProvider(view)),
            builder: (context, tasks, meta) => RefreshIndicator(
              onRefresh: () => ref.refresh(tasksProvider(view).future),
              child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
                StaleNote(meta),
                if (tasks.isEmpty) EmptyState(icon: Icons.task_alt_rounded, title: tr.t('tasks.empty')),
                for (final t in tasks)
                  Card(
                    margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    child: ListTile(
                      contentPadding: const EdgeInsets.fromLTRB(8, 4, 12, 4),
                      leading: Checkbox(
                        value: !t.open,
                        onChanged: !canUpdate || t.status == 'cancelled' ? null : (v) => _set(t, v == true ? 'completed' : 'pending'),
                      ),
                      title: Text(t.title,
                          style: TextStyle(fontWeight: FontWeight.w600, decoration: t.open ? null : TextDecoration.lineThrough)),
                      subtitle: Text([
                        fmt.date(t.dueDate, year: false) + (t.dueTime != null ? ' ${fmt.digits(t.dueTime!)}' : ''),
                        t.employee ?? tr.t('tasks.unassigned'),
                        if ((t.description ?? '').isNotEmpty) t.description!,
                      ].join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis),
                      trailing: t.overdue
                          ? StatusPill('overdue', label: tr.t('tasks.overdue'))
                          : t.priority == 'high'
                              ? const Icon(Icons.priority_high_rounded, color: Brand.danger)
                              : t.status == 'in_progress'
                                  ? StatusPill(t.status)
                                  : null,
                      onLongPress: canUpdate && t.status == 'pending' ? () => _set(t, 'in_progress') : null,
                    ),
                  ),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}
