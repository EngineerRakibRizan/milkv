import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/widgets.dart';

/// `GET /dashboard` (DashboardService::build) — everything in one request.
final dashboardProvider = StreamProvider.autoDispose<Cached<Map<String, dynamic>>>((ref) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/dashboard', (j) => Map<String, dynamic>.from(j as Map));
});

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key, this.onOpenTab});

  /// Jump to another bottom tab (e.g. 'milk', 'deliveries').
  final void Function(String tab)? onOpenTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final value = ref.watch(dashboardProvider);
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(auth.farm?.name ?? tr.t('dashboard.title')),
          Text(tr.t('dashboard.greeting'), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, fontFamily: Theme.of(context).textTheme.bodyMedium?.fontFamily, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ]),
        toolbarHeight: 68,
      ),
      body: AsyncBody<Map<String, dynamic>>(
        value: value,
        onRetry: () => ref.invalidate(dashboardProvider),
        skeleton: const SkeletonList(count: 5, height: 96),
        builder: (context, d, meta) {
          final milk = Map<String, dynamic>.from(d['milk'] as Map? ?? const {});
          final counts = Map<String, dynamic>.from(d['counts'] as Map? ?? const {});
          final finance = d['finance'] is Map ? Map<String, dynamic>.from(d['finance'] as Map) : null;
          // An empty PHP collection arrives as [] instead of {}.
          final byStatus = d['deliveries_today'] is Map ? Map<String, dynamic>.from(d['deliveries_today'] as Map) : const <String, dynamic>{};
          final pendingDeliveries = ['pending', 'prepared', 'out_for_delivery'].fold<int>(0, (s, k) => s + ((byStatus[k] as num?)?.toInt() ?? 0));
          final doneDeliveries = ['delivered', 'partial'].fold<int>(0, (s, k) => s + ((byStatus[k] as num?)?.toInt() ?? 0));
          final trend = [for (final p in milk['trend'] as List? ?? const []) Fmt.parse((p as Map)['produced'])];
          final tasks = [for (final t in d['tasks'] as List? ?? const []) Map<String, dynamic>.from(t as Map)];
          final alerts = [for (final a in d['alerts'] as List? ?? const []) Map<String, dynamic>.from(a as Map)];
          final lowStock = [for (final a in d['low_stock'] as List? ?? const []) Map<String, dynamic>.from(a as Map)];

          Widget grid(List<Widget> tiles) => GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 2.1,
                children: tiles,
              );

          return RefreshIndicator(
            onRefresh: () => ref.refresh(dashboardProvider.future),
            child: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 24), children: [
              StaleNote(meta),
              const SizedBox(height: 8),
              _MilkHero(produced: milk['produced_today'], stock: milk['stock'], trend: trend, onTap: auth.can('milk.view') ? () => onOpenTab?.call('milk') : null),
              const SizedBox(height: 8),
              grid([
                StatTile(label: tr.t('dashboard.deliveredToday'), value: fmt.litres(milk['delivered_today']), icon: Icons.local_shipping_outlined,
                    onTap: auth.can('deliveries.view') ? () => onOpenTab?.call('deliveries') : null),
                StatTile(label: tr.t('deliveries.open'), value: '${fmt.num(pendingDeliveries, digits: 0)} / ${fmt.num(pendingDeliveries + doneDeliveries, digits: 0)}',
                    icon: Icons.pending_actions_outlined, tone: pendingDeliveries > 0 ? Brand.warning : null,
                    onTap: auth.can('deliveries.view') ? () => onOpenTab?.call('deliveries') : null),
                StatTile(label: tr.t('dashboard.cows'), value: fmt.num(counts['cows'], digits: 0), icon: Icons.pets_outlined),
                StatTile(label: tr.t('status.lactating'), value: fmt.num(counts['lactating'], digits: 0), icon: Icons.water_drop_outlined),
              ]),
              if (finance != null) ...[
                const SizedBox(height: 8),
                grid([
                  StatTile(label: tr.t('dashboard.incomeToday'), value: fmt.money(finance['income_today']), tone: const Color(0xFF15803D)),
                  StatTile(label: tr.t('dashboard.expenseToday'), value: fmt.money(finance['expense_today']), tone: Brand.danger),
                  StatTile(label: tr.t('dashboard.monthProfit'), value: fmt.money(finance['month_profit'])),
                  StatTile(label: tr.t('dashboard.receivables'), value: fmt.money(finance['receivables']), tone: Brand.warning,
                      onTap: auth.can('customers.view') ? () => onOpenTab?.call('customers') : null),
                ]),
              ],
              if (alerts.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: tr.t('dashboard.alerts'),
                  child: Column(children: [
                    for (final a in alerts)
                      ListTile(
                        dense: true,
                        leading: Icon(a['severity'] == 'warning' ? Icons.warning_amber_rounded : Icons.info_outline, color: a['severity'] == 'warning' ? Brand.warning : Brand.info),
                        title: Text('${a['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: (a['body'] ?? '').toString().isEmpty ? null : Text('${a['body']}', maxLines: 2, overflow: TextOverflow.ellipsis),
                      ),
                  ]),
                ),
              ],
              if (tasks.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: tr.t('dashboard.tasksToday'),
                  trailing: auth.can('tasks.view') ? TextButton(onPressed: () => onOpenTab?.call('tasks'), child: Text(tr.t('common.view'))) : null,
                  child: Column(children: [
                    for (final t in tasks)
                      ListTile(
                        dense: true,
                        leading: Icon(Icons.radio_button_unchecked, color: t['priority'] == 'high' ? Brand.danger : null),
                        title: Text('${t['title']}'),
                        subtitle: Text(fmt.date(t['due_date'] as String?, year: false)),
                      ),
                  ]),
                ),
              ],
              if (lowStock.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: tr.t('m.lowStock', fallback: 'Running low'),
                  child: Column(children: [
                    for (final f in lowStock)
                      ListTile(
                        dense: true,
                        leading: const Icon(Icons.inventory_2_outlined, color: Brand.warning),
                        title: Text('${f['name']}'),
                        trailing: Text('${fmt.num(f['stock'])} ${tr.t('units.${f['unit']}')}', style: const TextStyle(color: Brand.danger, fontWeight: FontWeight.w600)),
                      ),
                  ]),
                ),
              ],
            ]),
          );
        },
      ),
    );
  }
}

class _MilkHero extends ConsumerWidget {
  const _MilkHero({required this.produced, required this.stock, required this.trend, this.onTap});

  final Object? produced;
  final Object? stock;
  final List<double> trend;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    return Material(
      color: Brand.primary,
      borderRadius: BorderRadius.circular(22),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.water_drop_rounded, color: Brand.accent, size: 20),
              const SizedBox(width: 6),
              Text(tr.t('dashboard.milkToday'), style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w600)),
              const Spacer(),
              Text('${tr.t('dashboard.milkStock')}: ${fmt.litres(stock)}', style: const TextStyle(color: Colors.white70, fontSize: 13)),
            ]),
            const SizedBox(height: 4),
            Text(fmt.litres(produced), style: const TextStyle(fontFamily: 'BalooDa2', color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800, height: 1.1)),
            const SizedBox(height: 8),
            SizedBox(height: 48, width: double.infinity, child: CustomPaint(painter: _Sparkline(trend))),
            Text(tr.t('milk.last30'), style: const TextStyle(color: Colors.white60, fontSize: 12)),
          ]),
        ),
      ),
    );
  }
}

class _Sparkline extends CustomPainter {
  _Sparkline(this.values);

  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    final maxV = math.max(values.reduce(math.max), 1.0);
    final dx = size.width / (values.length - 1);
    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final p = Offset(i * dx, size.height - (values[i] / maxV) * (size.height - 4) - 2);
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    final fill = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(fill, Paint()..color = Brand.accent.withValues(alpha: 0.18));
    canvas.drawPath(path, Paint()
      ..color = Brand.accent
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeJoin = StrokeJoin.round);
  }

  @override
  bool shouldRepaint(_Sparkline old) => old.values != values;
}
