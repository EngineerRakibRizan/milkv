import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/forms.dart';
import '../../shared/widgets.dart';
import '../customers/customers_screen.dart';
import '../finance/income_screen.dart';
import '../finance/suppliers_screen.dart';

typedef ReportQuery = ({String type, String from, String to, String dimension, String account});

/// `GET /reports/{type}` — every figure is computed by the server from the ledger.
final reportProvider = StreamProvider.autoDispose.family<Cached<dynamic>, ReportQuery>((ref, q) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/reports/${q.type}', (j) => j,
      query: {'from': q.from, 'to': q.to, 'dimension': q.dimension, 'account': q.account});
});

const _financeReports = ['pnl', 'cashflow', 'receivables', 'payables', 'segments', 'profitability'];
const _operationalReports = ['milk', 'feed'];
const _green = Color(0xFF15803D);

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  Period period = Period.thisMonth();
  String dimension = 'animal';

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final auth = ref.watch(authProvider);
    final types = [
      if (auth.can('reports.finance')) ..._financeReports,
      if (auth.can('reports.operational') || auth.can('reports.finance')) ..._operationalReports,
    ];
    String label(String t) => switch (t) {
          'profitability' => tr.t('reports.unit'),
          _ => tr.t('reports.$t'),
        };
    return DefaultTabController(
      length: types.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(tr.t('nav.reports')),
          bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [for (final t in types) Tab(text: label(t))]),
        ),
        body: Column(children: [
          PeriodChips(value: period, onChanged: (p) => setState(() => period = p)),
          Expanded(child: TabBarView(children: [for (final t in types) _report(t)])),
        ]),
      ),
    );
  }

  Widget _report(String type) {
    final q = (type: type, from: period.from, to: period.to, dimension: type == 'profitability' ? dimension : '', account: '');
    final value = ref.watch(reportProvider(q));
    return AsyncBody<dynamic>(
      value: value,
      onRetry: () => ref.invalidate(reportProvider(q)),
      builder: (context, d, meta) => RefreshIndicator(
        onRefresh: () => ref.refresh(reportProvider(q).future),
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 4, 12, 32), children: [
          StaleNote(meta),
          ...switch (type) {
            'pnl' => _pnl(Map<String, dynamic>.from(d as Map)),
            'cashflow' => _cashflow(Map<String, dynamic>.from(d as Map)),
            'receivables' => _receivables(Map<String, dynamic>.from(d as Map)),
            'payables' => _payables(Map<String, dynamic>.from(d as Map)),
            'segments' => _segments(d as List),
            'profitability' => _profitability(d as List),
            'milk' => _milk(Map<String, dynamic>.from(d as Map)),
            'feed' => _feed(Map<String, dynamic>.from(d as Map)),
            _ => const <Widget>[],
          },
        ]),
      ),
    );
  }

  Fmt get fmt => ref.watch(fmtProvider);

  void _ledger(String key, String name) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LedgerScreen(account: key, name: name, period: period)));

  Widget _note(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 12, 4, 0),
        child: Text(text, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );

  List<Widget> _pnl(Map<String, dynamic> d) {
    final tr = ref.tr;
    final revenue = [for (final r in d['revenue'] as List) Map<String, dynamic>.from(r as Map)];
    final expenses = [for (final r in d['expenses'] as List) Map<String, dynamic>.from(r as Map)];
    final net = Fmt.parse(d['net_profit']);
    Widget line(Map<String, dynamic> r) => KeyValueRow('${r['name']}', fmt.money(r['amount']), onTap: () => _ledger('${r['key']}', '${r['name']}'));
    return [
      TotalsRow([(tr.t('reports.net'), fmt.money(net), net >= 0 ? _green : Brand.danger)]),
      const SizedBox(height: 8),
      SectionCard(
        title: tr.t('reports.revenue'),
        child: Column(children: [
          for (final r in revenue) line(r),
          KeyValueRow(tr.t('reports.totalRevenue'), fmt.money(d['total_revenue']), bold: true),
        ]),
      ),
      const SizedBox(height: 10),
      SectionCard(
        title: tr.t('reports.expenses'),
        child: Column(children: [
          for (final r in expenses.where((e) => e['section'] == 'direct')) line(r),
          KeyValueRow(tr.t('reports.direct'), fmt.money(d['direct_costs']), bold: true),
          KeyValueRow(tr.t('reports.gross'), fmt.money(d['gross_profit']), bold: true, color: Fmt.parse(d['gross_profit']) >= 0 ? _green : Brand.danger),
          const Divider(),
          for (final r in expenses.where((e) => e['section'] != 'direct')) line(r),
          KeyValueRow(tr.t('reports.totalOperating'), fmt.money(d['operating_expenses']), bold: true),
          const Divider(),
          KeyValueRow(tr.t('reports.net'), fmt.money(net), bold: true, color: net >= 0 ? _green : Brand.danger),
        ]),
      ),
      _note(tr.t('reports.pnlNote')),
    ];
  }

  List<Widget> _cashflow(Map<String, dynamic> d) {
    final tr = ref.tr;
    final rows = [for (final r in d['by_activity'] as List? ?? const []) Map<String, dynamic>.from(r as Map)];
    final accounts = [for (final r in d['by_account'] as List? ?? const []) Map<String, dynamic>.from(r as Map)];
    return [
      TotalsRow([
        (tr.t('reports.cashIn'), fmt.money(d['inflow']), _green),
        (tr.t('reports.cashOut'), fmt.money(d['outflow']), Brand.danger),
      ]),
      const SizedBox(height: 8),
      SectionCard(
        title: tr.t('reports.cashflow'),
        child: Column(children: [
          KeyValueRow(tr.t('reports.opening'), fmt.money(d['opening'])),
          for (final r in rows) ...[
            if (Fmt.parse(r['inflow']) > 0) KeyValueRow('${r['activity']}', '+${fmt.money(r['inflow'])}', color: _green),
            if (Fmt.parse(r['outflow']) > 0) KeyValueRow('${r['activity']}', '-${fmt.money(r['outflow'])}', color: Brand.danger),
          ],
          KeyValueRow(tr.t('reports.netCash'), fmt.money(d['net']), bold: true),
          KeyValueRow(tr.t('reports.closing'), fmt.money(d['closing']), bold: true),
        ]),
      ),
      const SizedBox(height: 10),
      SectionCard(
        title: tr.t('reports.byAccount'),
        child: Column(children: [
          for (final a in accounts)
            ListTile(
              dense: true,
              title: Text('${a['account']}'),
              trailing: Text('+${fmt.money(a['inflow'])}  /  -${fmt.money(a['outflow'])}'),
            ),
        ]),
      ),
      _note(tr.t('reports.cashNote')),
    ];
  }

  List<Widget> _receivables(Map<String, dynamic> d) {
    final tr = ref.tr;
    final customers = [for (final c in d['customers'] as List) Map<String, dynamic>.from(c as Map)];
    const buckets = {'current': '0–30', 'd31_60': '31–60', 'd61_90': '61–90', 'd90_plus': '90+'};
    return [
      TotalsRow([
        (tr.t('reports.receivables'), fmt.money(d['total']), Brand.danger),
        (tr.t('reports.advances'), fmt.money(d['advances']), _green),
      ]),
      const SizedBox(height: 8),
      if (customers.isEmpty) EmptyState(icon: Icons.check_circle_outline, title: tr.t('common.noData')),
      for (final c in customers)
        Card(
          margin: const EdgeInsets.symmetric(vertical: 4),
          child: ListTile(
            title: Text('${c['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Wrap(spacing: 6, runSpacing: 4, children: [
              for (final b in buckets.entries)
                if (Fmt.parse((c['aging'] as Map?)?[b.key]) != 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: (b.key == 'current' ? Brand.info : b.key == 'd31_60' ? Brand.warning : Brand.danger).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text('${fmt.digits(b.value)}: ${fmt.money((c['aging'] as Map)[b.key])}', style: const TextStyle(fontSize: 12)),
                  ),
            ]),
            trailing: Text(fmt.money(c['balance']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.danger)),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CustomerDetailScreen(id: c['id'] as int, name: '${c['name']}'))),
          ),
        ),
    ];
  }

  List<Widget> _payables(Map<String, dynamic> d) {
    final tr = ref.tr;
    final suppliers = [for (final s in d['suppliers'] as List) Map<String, dynamic>.from(s as Map)];
    return [
      TotalsRow([(tr.t('reports.payables'), fmt.money(d['total']), Brand.danger)]),
      const SizedBox(height: 8),
      if (suppliers.isEmpty) EmptyState(icon: Icons.check_circle_outline, title: tr.t('common.noData')),
      for (final s in suppliers)
        Card(
          margin: const EdgeInsets.symmetric(vertical: 4),
          child: ListTile(
            title: Text('${s['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: s['phone'] == null ? null : Text('${s['phone']}'),
            trailing: Text(fmt.money(s['balance']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.danger)),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SupplierDetailScreen(id: s['id'] as int, name: '${s['name']}'))),
          ),
        ),
      if (Fmt.parse(d['unassigned']) != 0) KeyValueRow(tr.t('reports.noSupplier'), fmt.money(d['unassigned'])),
    ];
  }

  Widget _profitCard(String title, Object? revenue, Object? costs, Object? profit, {String? extra}) {
    final tr = ref.tr;
    final p = Fmt.parse(profit);
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 6, 16, 2), child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
          KeyValueRow(tr.t('reports.revenue'), fmt.money(revenue)),
          if (extra != null) KeyValueRow(tr.t('reports.milkEst'), extra),
          KeyValueRow(tr.t('reports.directCost'), fmt.money(costs)),
          KeyValueRow(tr.t('reports.profit'), fmt.money(profit), bold: true, color: p >= 0 ? _green : Brand.danger),
        ]),
      ),
    );
  }

  List<Widget> _segments(List d) {
    final tr = ref.tr;
    return [
      for (final s in d.map((x) => Map<String, dynamic>.from(x as Map)))
        _profitCard(tr.t('reports.seg.${s['segment']}', fallback: '${s['segment']}'), s['revenue'], s['costs'], s['profit']),
      _note(tr.t('reports.segNote')),
    ];
  }

  List<Widget> _profitability(List d) {
    final tr = ref.tr;
    return [
      FilterChips<String>(
        value: dimension,
        options: [('animal', tr.t('reports.perCow')), ('flock', tr.t('reports.perFlock'))],
        onChanged: (v) => setState(() => dimension = v),
      ),
      if (d.isEmpty) EmptyState(icon: Icons.analytics_outlined, title: tr.t('common.noData')),
      for (final r in d.map((x) => Map<String, dynamic>.from(x as Map)))
        _profitCard('${r['label']}', r['revenue'], r['costs'], r['profit'],
            extra: dimension == 'animal' && Fmt.parse(r['estimated_milk_revenue']) > 0 ? fmt.money(r['estimated_milk_revenue']) : null),
      if (dimension == 'animal') _note(tr.t('reports.estNote')),
    ];
  }

  List<Widget> _milk(Map<String, dynamic> d) {
    final tr = ref.tr;
    final daily = [for (final x in d['daily'] as List? ?? const []) Fmt.parse((x as Map)['production'])];
    final cows = [for (final c in d['by_cow'] as List? ?? const []) Map<String, dynamic>.from(c as Map)];
    final produced = Fmt.parse(d['produced']);
    final unsold = produced - Fmt.parse(d['delivered']) - Fmt.parse(d['internal_use']) - Fmt.parse(d['spoilage']);
    final maxCow = cows.fold<double>(0, (m, c) => math.max(m, Fmt.parse(c['litres'])));
    return [
      TotalsRow([
        (tr.t('milk.produced'), fmt.litres(d['produced']), null),
        (tr.t('milk.delivered'), fmt.litres(d['delivered']), _green),
      ]),
      if (daily.length > 1)
        Card(
          margin: const EdgeInsets.symmetric(vertical: 8),
          child: Padding(padding: const EdgeInsets.all(14), child: SizedBox(height: 90, child: CustomPaint(painter: _Bars(daily), size: Size.infinite))),
        ),
      SectionCard(
        title: tr.t('reports.milkBalance'),
        child: Column(children: [
          KeyValueRow(tr.t('milk.produced'), fmt.litres(d['produced'])),
          KeyValueRow(tr.t('milk.delivered'), '-${fmt.litres(d['delivered'])}'),
          KeyValueRow(tr.t('milk.internal'), '-${fmt.litres(d['internal_use'])}'),
          KeyValueRow(tr.t('milk.spoilage'), '-${fmt.litres(d['spoilage'])}'),
          KeyValueRow(tr.t('reports.unsold'), fmt.litres(unsold), bold: true),
          if (d['direct_cost_per_litre'] != null) KeyValueRow(tr.t('reports.costPerLitre'), fmt.money(d['direct_cost_per_litre']), bold: true),
        ]),
      ),
      const SizedBox(height: 10),
      SectionCard(
        title: tr.t('reports.topCows'),
        child: Column(children: [
          for (final c in cows)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text((c['name'] as String?)?.isNotEmpty == true ? '${c['name']} · ${c['tag']}' : '${c['tag']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                  Text('${fmt.litres(c['litres'])}  ·  ${fmt.litres(c['avg_per_day'])}/${tr.t('leads.day')}'),
                ]),
                const SizedBox(height: 4),
                LinearProgressIndicator(value: maxCow == 0 ? 0 : Fmt.parse(c['litres']) / maxCow, minHeight: 6, borderRadius: BorderRadius.circular(6)),
              ]),
            ),
        ]),
      ),
      if (d['cost_note'] != null) _note('${d['cost_note']}'),
    ];
  }

  List<Widget> _feed(Map<String, dynamic> d) {
    final tr = ref.tr;
    final items = [for (final i in d['items'] as List? ?? const []) Map<String, dynamic>.from(i as Map)];
    return [
      TotalsRow([
        (tr.t('reports.consumedValue'), fmt.money(d['consumption_value']), null),
        (tr.t('inventory.purchase'), fmt.money(d['purchase_value']), null),
      ]),
      const SizedBox(height: 8),
      if (items.isEmpty) EmptyState(icon: Icons.grass_outlined, title: tr.t('common.noData')),
      for (final i in items)
        Card(
          margin: const EdgeInsets.symmetric(vertical: 4),
          child: ListTile(
            title: Text('${i['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('${fmt.num(i['consumption_qty'])} ${tr.t('units.${i['unit']}', fallback: '${i['unit']}')} ${tr.t('reports.consumed')}'),
            trailing: Text(fmt.money(i['consumption_value']), style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        ),
    ];
  }
}

class _Bars extends CustomPainter {
  _Bars(this.values);

  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    final maxV = math.max(values.reduce(math.max), 1.0);
    final w = size.width / values.length;
    final paint = Paint()..color = Brand.primary;
    for (var i = 0; i < values.length; i++) {
      final h = values[i] / maxV * size.height;
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(i * w + w * 0.15, size.height - h, w * 0.7, h), const Radius.circular(2)),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_Bars old) => old.values != values;
}

/// Journal lines behind one report figure (`GET /reports/ledger?account=`).
class LedgerScreen extends ConsumerWidget {
  const LedgerScreen({super.key, required this.account, required this.name, required this.period});

  final String account;
  final String name;
  final Period period;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final q = (type: 'ledger', from: period.from, to: period.to, dimension: '', account: account);
    final value = ref.watch(reportProvider(q));
    return Scaffold(
      appBar: AppBar(title: Text(name)),
      body: AsyncBody<dynamic>(
        value: value,
        onRetry: () => ref.invalidate(reportProvider(q)),
        builder: (context, d, meta) {
          final lines = [for (final l in (d as Map)['lines'] as List) Map<String, dynamic>.from(l as Map)];
          return ListView(children: [
            StaleNote(meta),
            if (lines.isEmpty) EmptyState(icon: Icons.list_alt_outlined, title: tr.t('common.noData')),
            for (final l in lines)
              ListTile(
                dense: true,
                title: Text('${l['memo'] ?? l['source_type'] ?? ''}'),
                subtitle: Text(fmt.date(l['date'] as String?)),
                trailing: Text(
                  Fmt.parse(l['debit']) > 0 ? fmt.money(l['debit']) : '(${fmt.money(l['credit'])})',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
