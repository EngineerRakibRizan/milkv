import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/forms.dart';
import '../../shared/inputs.dart';
import '../../shared/lookups.dart';
import '../../shared/widgets.dart';
import '../finance/bill_sheet.dart';

const feedCategories = ['cow_feed', 'calf_feed', 'hen_feed', 'duck_feed', 'concentrate', 'green_fodder', 'hay_silage', 'rice_bran', 'supplement', 'medicine', 'other'];
const stockUnits = ['kg', 'l', 'bag', 'pcs'];

/// `GET /inventory` — Present::feedItem rows plus the total stock value.
class Stock {
  Stock(this.items, this.totalValue);

  final List<Map<String, dynamic>> items;
  final String totalValue;

  factory Stock.fromJson(dynamic j) =>
      Stock([for (final i in j['data'] as List) Map<String, dynamic>.from(i as Map)], '${j['total_value'] ?? '0'}');
}

final stockProvider = StreamProvider.autoDispose.family<Cached<Stock>, bool>((ref, lowOnly) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/inventory', Stock.fromJson, query: {'low': lowOnly ? 1 : null});
});

typedef MovementQuery = ({String type, int page});

final movementsProvider = StreamProvider.autoDispose.family<Cached<Map<String, dynamic>>, MovementQuery>((ref, q) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/inventory-movements', (j) => Map<String, dynamic>.from(j as Map), query: {'type': q.type, 'page': q.page, 'per_page': 30});
});

void _refreshInventory(WidgetRef ref) {
  ref.invalidate(stockProvider);
  ref.invalidate(movementsProvider);
  ref.invalidate(feedItemsLookup);
}

class InventoryScreen extends ConsumerStatefulWidget {
  const InventoryScreen({super.key});

  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  bool lowOnly = false;
  String search = '';
  String mvType = '';
  int page = 1;

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final auth = ref.watch(authProvider);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(tr.t('nav.inventory')),
          bottom: TabBar(tabs: [Tab(text: tr.t('inventory.stock')), Tab(text: tr.t('inventory.movements'))]),
        ),
        floatingActionButton: _actions(context, auth.can('inventory.consume'), auth.can('bills.create'), auth.can('inventory.create')),
        body: TabBarView(children: [_stock(context), _movements(context)]),
      ),
    );
  }

  Widget? _actions(BuildContext context, bool consume, bool purchase, bool create) {
    final tr = ref.tr;
    if (!consume && !purchase && !create) return null;
    return FloatingActionButton.extended(
      icon: const Icon(Icons.add),
      label: Text(consume ? tr.t('quick.feed') : tr.t('common.add')),
      onPressed: () async {
        if (consume && !purchase && !create) return _open(const FeedUseSheet());
        final choice = await showModalBottomSheet<String>(
          context: context,
          builder: (ctx) => SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (consume) ListTile(leading: const Icon(Icons.grass_outlined), title: Text(tr.t('inventory.issueTitle')), onTap: () => Navigator.pop(ctx, 'issue')),
              if (purchase) ListTile(leading: const Icon(Icons.shopping_cart_outlined), title: Text(tr.t('bills.newPurchase')), onTap: () => Navigator.pop(ctx, 'purchase')),
              if (create) ListTile(leading: const Icon(Icons.add_box_outlined), title: Text(tr.t('inventory.addItem')), onTap: () => Navigator.pop(ctx, 'item')),
            ]),
          ),
        );
        switch (choice) {
          case 'issue':
            await _open(const FeedUseSheet());
          case 'purchase':
            await _open(const BillSheet(kind: 'purchase'));
          case 'item':
            await _open(const FeedItemSheet());
        }
      },
    );
  }

  Future<void> _open(Widget sheet) async {
    await showFormSheet<void>(context, sheet);
    if (mounted) _refreshInventory(ref);
  }

  Widget _stock(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final value = ref.watch(stockProvider(lowOnly));
    return AsyncBody<Stock>(
      value: value,
      onRetry: () => ref.invalidate(stockProvider(lowOnly)),
      builder: (context, s, meta) {
        final lowCount = s.items.where((i) => i['low'] == true).length;
        final shown = s.items.where((i) => search.isEmpty || '${i['name']} ${i['sku']}'.toLowerCase().contains(search.toLowerCase())).toList();
        return RefreshIndicator(
          onRefresh: () => ref.refresh(stockProvider(lowOnly).future),
          child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            StaleNote(meta),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: Row(children: [
                Expanded(child: StatTile(label: tr.t('dashboard.feedValue'), value: fmt.money(s.totalValue), icon: Icons.inventory_2_outlined)),
                const SizedBox(width: 8),
                Expanded(
                  child: StatTile(
                    label: tr.t('inventory.lowItems'),
                    value: fmt.num(lowCount, digits: 0),
                    tone: lowCount > 0 ? Brand.warning : null,
                    icon: Icons.warning_amber_rounded,
                    onTap: () => setState(() => lowOnly = !lowOnly),
                  ),
                ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
              child: TextField(
                decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr.t('common.search')),
                onChanged: (v) => setState(() => search = v.trim()),
              ),
            ),
            FilterChips<bool>(
              value: lowOnly,
              options: [(false, tr.t('common.all')), (true, tr.t('inventory.lowOnly'))],
              onChanged: (v) => setState(() => lowOnly = v),
            ),
            if (shown.isEmpty) EmptyState(icon: Icons.inventory_2_outlined, title: tr.t('inventory.empty')),
            for (final i in shown) _ItemTile(i),
          ]),
        );
      },
    );
  }

  Widget _movements(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final q = (type: mvType, page: page);
    final value = ref.watch(movementsProvider(q));
    return Column(children: [
      FilterChips<String>(
        value: mvType,
        options: [
          ('', tr.t('common.all')),
          ('consumption', tr.t('inventory.consumption')),
          ('purchase', tr.t('inventory.purchase')),
          ('adjustment', tr.t('inventory.adjustment')),
          ('wastage', tr.t('inventory.wastage')),
          ('spoilage', tr.t('inventory.spoilage')),
        ],
        onChanged: (v) => setState(() {
          mvType = v;
          page = 1;
        }),
      ),
      Expanded(
        child: AsyncBody<Map<String, dynamic>>(
          value: value,
          onRetry: () => ref.invalidate(movementsProvider(q)),
          builder: (context, d, meta) {
            final rows = [for (final m in d['data'] as List) Map<String, dynamic>.from(m as Map)];
            final last = (d['meta'] as Map?)?['last_page'] as int? ?? 1;
            return RefreshIndicator(
              onRefresh: () => ref.refresh(movementsProvider(q).future),
              child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
                StaleNote(meta),
                if (rows.isEmpty) EmptyState(icon: Icons.swap_vert_rounded, title: tr.t('common.noData')),
                for (final m in rows)
                  ListTile(
                    title: Text('${m['item'] ?? ''}${m['target'] != null ? '  →  ${m['target']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${fmt.date(m['date'] as String?)} · ${tr.t('inventory.${m['type']}', fallback: '${m['type']}')}'),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text('${Fmt.parse(m['quantity']) > 0 ? '+' : ''}${fmt.num(m['quantity'])} ${tr.t('units.${m['unit']}', fallback: '${m['unit'] ?? ''}')}',
                          style: TextStyle(fontWeight: FontWeight.w700, color: Fmt.parse(m['quantity']) > 0 ? const Color(0xFF15803D) : null)),
                      Text(fmt.money(m['value']), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                    ]),
                  ),
                if (last > 1) Pager(page: page, last: last, onChanged: (p) => setState(() => page = p)),
              ]),
            );
          },
        ),
      ),
    ]);
  }
}

class _ItemTile extends ConsumerWidget {
  const _ItemTile(this.i);

  final Map<String, dynamic> i;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final low = i['low'] == true;
    final unit = tr.t('units.${i['unit']}', fallback: '${i['unit']}');
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => showModalBottomSheet<void>(
          context: context,
          builder: (ctx) => SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                child: Text('${i['name']}', style: Theme.of(ctx).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              ),
              KeyValueRow(tr.t('inventory.inStock'), '${fmt.num(i['stock'])} $unit'),
              KeyValueRow(tr.t('inventory.minStock'), '${fmt.num(i['min_stock'])} $unit'),
              KeyValueRow(tr.t('inventory.avgCost'), '${fmt.money(i['avg_cost'])}/$unit'),
              KeyValueRow(tr.t('inventory.value'), fmt.money(i['stock_value'])),
              if ((i['location'] ?? '').toString().isNotEmpty) KeyValueRow(tr.t('inventory.location'), '${i['location']}'),
              const Divider(),
              if (auth.can('inventory.consume'))
                ListTile(
                  leading: const Icon(Icons.grass_outlined),
                  title: Text(tr.t('inventory.issueTitle')),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await showFormSheet<void>(context, FeedUseSheet(itemId: i['id'] as int));
                    _refreshInventory(ref);
                  },
                ),
              if (auth.can('inventory.adjust'))
                ListTile(
                  leading: const Icon(Icons.fact_check_outlined),
                  title: Text(tr.t('inventory.count')),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await showFormSheet<void>(context, StockCountSheet(item: i));
                    _refreshInventory(ref);
                  },
                ),
              if (auth.can('inventory.update'))
                ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: Text(tr.t('common.edit')),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await showFormSheet<void>(context, FeedItemSheet(item: i));
                    _refreshInventory(ref);
                  },
                ),
            ]),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${i['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                Text('${tr.t('feedcat.${i['category']}', fallback: '${i['category']}')} · ${i['sku']}',
                    style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ]),
            ),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Row(mainAxisSize: MainAxisSize.min, children: [
                if (low) Padding(padding: const EdgeInsets.only(right: 6), child: StatusPill('pending', label: tr.t('inventory.low'))),
                Text('${fmt.num(i['stock'])} $unit', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: low ? Brand.warning : null)),
              ]),
              Text(fmt.money(i['stock_value']), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _UseLine {
  int? itemId;
  Subject? target;
  final qty = TextEditingController();
}

/// Feed used / wasted / spoiled (`POST /inventory-issues`). Works offline.
class FeedUseSheet extends ConsumerStatefulWidget {
  const FeedUseSheet({super.key, this.itemId});

  final int? itemId;

  @override
  ConsumerState<FeedUseSheet> createState() => _FeedUseSheetState();
}

class _FeedUseSheetState extends ConsumerState<FeedUseSheet> {
  String date = today();
  String type = 'consumption';
  late final lines = [_UseLine()..itemId = widget.itemId];

  @override
  void dispose() {
    for (final l in lines) {
      l.qty.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final items = ref.watch(feedItemsLookup).value ?? const [];
    final subjects = ref.watch(subjectOptionsProvider);
    final itemOptions = [
      for (final i in items) PickOption(i['id'] as int, '${i['name']}', subtitle: '${ref.watch(fmtProvider).num(i['stock'])} ${tr.t('units.${i['unit']}', fallback: '${i['unit']}')}'),
    ];
    return FormSheet(
      title: tr.t('inventory.issueTitle'),
      canSubmit: lines.every((l) => l.itemId != null && Fmt.parse(l.qty.text) > 0),
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send('POST', '/inventory-issues', label: 'feed-use:$date', body: {
          'date': date,
          'type': type,
          'lines': [
            for (final l in lines)
              {
                'feed_item_id': l.itemId,
                'quantity': l.qty.text,
                if (l.target != null) ...{'target_type': l.target!.type, 'target_id': l.target!.id},
              },
          ],
        });
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('inventory.issued'));
      },
      children: [
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'consumption', label: Text(tr.t('inventory.consumption'))),
            ButtonSegment(value: 'wastage', label: Text(tr.t('inventory.wastage'))),
            ButtonSegment(value: 'spoilage', label: Text(tr.t('inventory.spoilage'))),
          ],
          selected: {type},
          onSelectionChanged: (s) => setState(() => type = s.first),
        ),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
        for (final (n, l) in lines.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: PickerInput<int>(
                      label: tr.t('inventory.item'),
                      options: itemOptions,
                      value: l.itemId,
                      onChanged: (v) => setState(() => l.itemId = v),
                    ),
                  ),
                  if (lines.length > 1)
                    IconButton(
                      onPressed: () => setState(() => lines.removeAt(n).qty.dispose()),
                      icon: const Icon(Icons.close),
                    ),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: NumberInput(l.qty, tr.t('common.quantity'), onChanged: (_) => setState(() {}))),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: PickerInput<Subject>(
                      label: tr.t('inventory.fedTo'),
                      options: subjects,
                      value: l.target,
                      allowNone: true,
                      noneLabel: tr.t('inventory.general'),
                      onChanged: (v) => setState(() => l.target = v),
                    ),
                  ),
                ]),
              ]),
            ),
          ),
        OutlinedButton.icon(onPressed: () => setState(() => lines.add(_UseLine())), icon: const Icon(Icons.add), label: Text(tr.t('bills.addLine'))),
      ],
    );
  }
}

/// Physical stock count (`POST /inventory/{id}/adjust`); the server books the difference.
class StockCountSheet extends ConsumerStatefulWidget {
  const StockCountSheet({super.key, required this.item});

  final Map<String, dynamic> item;

  @override
  ConsumerState<StockCountSheet> createState() => _StockCountSheetState();
}

class _StockCountSheetState extends ConsumerState<StockCountSheet> {
  late final counted = TextEditingController(text: trimZero('${widget.item['stock']}'));
  final reason = TextEditingController();
  String date = today();

  @override
  void dispose() {
    counted.dispose();
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final unit = tr.t('units.${widget.item['unit']}', fallback: '${widget.item['unit']}');
    final diff = Fmt.parse(counted.text) - Fmt.parse(widget.item['stock']);
    return FormSheet(
      title: '${tr.t('inventory.count')} — ${widget.item['name']}',
      canSubmit: counted.text.isNotEmpty && reason.text.trim().isNotEmpty,
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send('POST', '/inventory/${widget.item['id']}/adjust',
            label: 'stock-count:${widget.item['id']}', body: {'date': date, 'counted': counted.text, 'notes': reason.text.trim()});
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('inventory.issued'));
      },
      children: [
        KeyValueRow(tr.t('inventory.system'), '${fmt.num(widget.item['stock'])} $unit'),
        NumberInput(counted, tr.t('inventory.counted'), suffix: unit, onChanged: (_) => setState(() {})),
        KeyValueRow(tr.t('inventory.adjustment'), '${diff > 0 ? '+' : ''}${fmt.num(diff)} $unit', bold: true, color: diff < 0 ? Brand.danger : null),
        TextInput(reason, tr.t('inventory.reason'), onChanged: (_) => setState(() {})),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
      ],
    );
  }
}

/// New or edited stock item (`POST /inventory`, `PUT /inventory/{id}`). Needs a connection.
class FeedItemSheet extends ConsumerStatefulWidget {
  const FeedItemSheet({super.key, this.item});

  final Map<String, dynamic>? item;

  @override
  ConsumerState<FeedItemSheet> createState() => _FeedItemSheetState();
}

class _FeedItemSheetState extends ConsumerState<FeedItemSheet> {
  late final i = widget.item ?? const {};
  late final name = TextEditingController(text: '${i['name'] ?? ''}');
  late final sku = TextEditingController(text: '${i['sku'] ?? ''}');
  late final minStock = TextEditingController(text: trimZero('${i['min_stock'] ?? ''}'));
  late final location = TextEditingController(text: '${i['location'] ?? ''}');
  final opening = TextEditingController();
  final openingCost = TextEditingController();
  late String category = '${i['category'] ?? 'cow_feed'}';
  late String unit = '${i['unit'] ?? 'kg'}';
  late int? supplierId = i['supplier_id'] as int?;
  late String? expires = i['expires_at'] as String?;

  @override
  void dispose() {
    for (final c in [name, sku, minStock, location, opening, openingCost]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final suppliers = ref.watch(suppliersLookup).value ?? const [];
    final editing = widget.item != null;
    return FormSheet(
      title: editing ? tr.t('common.edit') : tr.t('inventory.addItem'),
      canSubmit: name.text.trim().isNotEmpty && sku.text.trim().isNotEmpty,
      onSubmit: () async {
        final body = {
          'name': name.text.trim(), 'sku': sku.text.trim(), 'category': category, 'unit': unit,
          'min_stock': minStock.text.isEmpty ? null : minStock.text, 'supplier_id': supplierId,
          'location': location.text.trim().isEmpty ? null : location.text.trim(), 'expires_at': expires,
          if (!editing && opening.text.isNotEmpty) ...{'opening_stock': opening.text, 'opening_cost': openingCost.text.isEmpty ? null : openingCost.text},
        };
        final r = await ref.read(outboxProvider).send(editing ? 'PUT' : 'POST', editing ? '/inventory/${i['id']}' : '/inventory',
            body: body, label: 'feed-item', allowQueue: false);
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('common.saved'));
      },
      children: [
        TextInput(name, tr.t('common.name'), onChanged: (_) => setState(() {})),
        TextInput(sku, 'SKU', onChanged: (_) => setState(() {})),
        PickerInput<String>(
          label: tr.t('common.category'),
          options: [for (final c in feedCategories) PickOption(c, tr.t('feedcat.$c'))],
          value: category,
          onChanged: (v) => setState(() => category = v ?? category),
        ),
        Wrap(spacing: 8, children: [
          for (final u in stockUnits) ChoiceChip(label: Text(tr.t('units.$u')), selected: unit == u, onSelected: (_) => setState(() => unit = u)),
        ]),
        NumberInput(minStock, tr.t('inventory.minStock')),
        PickerInput<int>(
          label: tr.t('nav.suppliers'),
          options: [for (final s in suppliers) PickOption(s['id'] as int, '${s['name']}')],
          value: supplierId,
          allowNone: true,
          noneLabel: tr.t('bills.noSupplier'),
          onChanged: (v) => setState(() => supplierId = v),
        ),
        TextInput(location, tr.t('inventory.location')),
        DateInput(label: tr.t('inventory.expires'), value: expires, allowFuture: true, optional: true, onChanged: (v) => setState(() => expires = v)),
        if (!editing) ...[
          NumberInput(opening, tr.t('inventory.opening')),
          NumberInput(openingCost, tr.t('inventory.openingCost'), decimals: 2, prefix: '৳ '),
        ],
      ],
    );
  }
}
