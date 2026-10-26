import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/forms.dart';
import '../../shared/lookups.dart';
import '../../shared/widgets.dart';
import '../customers/customers_screen.dart';

typedef FinanceQuery = ({String path, String from, String to, String status, int page});

/// Paginated finance lists: `/invoices`, `/payments`, `/bills` with their totals.
final financeListProvider = StreamProvider.autoDispose.family<Cached<Map<String, dynamic>>, FinanceQuery>((ref, q) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  final (key, value) = q.path == '/bills' ? ('kind', q.status) : ('status', q.status);
  return ref.watch(queryCacheProvider).watch(q.path, (j) => Map<String, dynamic>.from(j as Map),
      query: {'from': q.from, 'to': q.to, key: value, 'page': q.page, 'per_page': 30});
});

/// One invoice or bill with its lines (`GET /invoices/{id}`, `/bills/{id}`).
final financeDocProvider = StreamProvider.autoDispose.family<Cached<Map<String, dynamic>>, String>((ref, path) {
  ref.watch(syncEpochProvider);
  return ref.watch(queryCacheProvider).watch(path, (j) => Map<String, dynamic>.from(j as Map));
});

void refreshFinance(WidgetRef ref) {
  ref.invalidate(financeListProvider);
  ref.invalidate(financeDocProvider);
  ref.invalidate(customersLookup);
  ref.invalidate(suppliersLookup);
}

class IncomeScreen extends ConsumerStatefulWidget {
  const IncomeScreen({super.key});

  @override
  ConsumerState<IncomeScreen> createState() => _IncomeScreenState();
}

class _IncomeScreenState extends ConsumerState<IncomeScreen> {
  Period period = Period.thisMonth();
  String status = '';
  int invPage = 1;
  int payPage = 1;

  Future<void> _open(Widget sheet) async {
    await showFormSheet<void>(context, sheet);
    if (mounted) refreshFinance(ref);
  }

  Future<void> _customerPayment() async {
    final tr = ref.read(trProvider);
    final customers = ref.read(customersLookup).value ?? const [];
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, scroll) => ListView(controller: scroll, children: [
          Padding(padding: const EdgeInsets.all(16), child: Text(tr.t('payments.new'), style: Theme.of(ctx).textTheme.titleMedium)),
          for (final c in customers)
            ListTile(
              title: Text('${c['name']}'),
              subtitle: Text('${c['area'] ?? ''}'),
              trailing: Text(ref.read(fmtProvider).money(c['balance'])),
              onTap: () => Navigator.pop(ctx, c),
            ),
        ]),
      ),
    );
    if (picked == null || !mounted) return;
    await _open(PaymentSheet(customerId: picked['id'] as int, name: '${picked['name']}', balance: '${picked['balance'] ?? '0'}'));
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final auth = ref.watch(authProvider);
    final canSale = auth.can('invoices.create');
    final canPay = auth.can('payments.create');
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(tr.t('nav.income')),
          bottom: TabBar(tabs: [Tab(text: tr.t('income.sales')), Tab(text: tr.t('income.receipts'))]),
        ),
        floatingActionButton: canSale || canPay
            ? FloatingActionButton.extended(
                icon: const Icon(Icons.add),
                label: Text(canSale ? tr.t('income.newSale') : tr.t('quick.payment')),
                onPressed: () async {
                  if (!canSale) return _customerPayment();
                  if (!canPay) return _open(const SaleSheet());
                  final choice = await showModalBottomSheet<String>(
                    context: context,
                    builder: (ctx) => SafeArea(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        ListTile(leading: const Icon(Icons.point_of_sale_outlined), title: Text(tr.t('income.newSale')), onTap: () => Navigator.pop(ctx, 's')),
                        ListTile(leading: const Icon(Icons.payments_outlined), title: Text(tr.t('payments.new')), onTap: () => Navigator.pop(ctx, 'p')),
                      ]),
                    ),
                  );
                  if (choice == 's') await _open(const SaleSheet());
                  if (choice == 'p') await _customerPayment();
                },
              )
            : null,
        body: Column(children: [
          PeriodChips(
            value: period,
            onChanged: (p) => setState(() {
              period = p;
              invPage = 1;
              payPage = 1;
            }),
          ),
          Expanded(child: TabBarView(children: [_invoices(context), _payments(context)])),
        ]),
      ),
    );
  }

  Widget _invoices(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final names = ref.watch(accountNamesProvider);
    final q = (path: '/invoices', from: period.from, to: period.to, status: status, page: invPage);
    final value = ref.watch(financeListProvider(q));
    return Column(children: [
      FilterChips<String>(
        value: status,
        options: [('', tr.t('common.all')), ('unpaid,partial', tr.t('income.due')), ('paid', tr.t('status.paid')), ('void', tr.t('status.void'))],
        onChanged: (v) => setState(() {
          status = v;
          invPage = 1;
        }),
      ),
      Expanded(
        child: AsyncBody<Map<String, dynamic>>(
          value: value,
          onRetry: () => ref.invalidate(financeListProvider(q)),
          builder: (context, d, meta) {
            final rows = [for (final r in d['data'] as List) Map<String, dynamic>.from(r as Map)];
            final totals = Map<String, dynamic>.from(d['totals'] as Map? ?? const {});
            final last = (d['meta'] as Map?)?['last_page'] as int? ?? 1;
            return RefreshIndicator(
              onRefresh: () => ref.refresh(financeListProvider(q).future),
              child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
                StaleNote(meta),
                TotalsRow([
                  (tr.t('income.invoiced'), fmt.money(totals['total']), null),
                  (tr.t('income.collected'), fmt.money(totals['paid']), const Color(0xFF15803D)),
                  (tr.t('income.outstanding'), fmt.money(totals['due']), Brand.danger),
                ]),
                if (rows.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr.t('common.noData'), hint: tr.t('income.hint')),
                for (final i in rows)
                  DocTile(
                    title: i['customer'] as String? ?? (i['description'] as String?) ?? names['${i['category']}'] ?? '${i['category']}',
                    subtitle: '${i['number']} · ${fmt.date(i['date'] as String?)}${i['source_type'] == 'delivery' ? ' · ${tr.t('income.fromDelivery')}' : ''}',
                    amount: fmt.money(i['total']),
                    status: '${i['status']}',
                    due: Fmt.parse(i['due']) > 0 && i['status'] != 'void' ? '${tr.t('income.due')} ${fmt.money(i['due'])}' : null,
                    onTap: () async {
                      await showFormSheet<void>(context, InvoiceSheet(id: i['id'] as int));
                      refreshFinance(ref);
                    },
                  ),
                if (last > 1) Pager(page: invPage, last: last, onChanged: (p) => setState(() => invPage = p)),
              ]),
            );
          },
        ),
      ),
    ]);
  }

  Widget _payments(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final q = (path: '/payments', from: period.from, to: period.to, status: '', page: payPage);
    final value = ref.watch(financeListProvider(q));
    return AsyncBody<Map<String, dynamic>>(
      value: value,
      onRetry: () => ref.invalidate(financeListProvider(q)),
      builder: (context, d, meta) {
        final rows = [for (final r in d['data'] as List) Map<String, dynamic>.from(r as Map)];
        final last = (d['meta'] as Map?)?['last_page'] as int? ?? 1;
        return RefreshIndicator(
          onRefresh: () => ref.refresh(financeListProvider(q).future),
          child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            StaleNote(meta),
            TotalsRow([(tr.t('income.receipts'), fmt.money(d['total']), const Color(0xFF15803D))]),
            if (rows.isEmpty) EmptyState(icon: Icons.payments_outlined, title: tr.t('common.noData')),
            for (final p in rows)
              ListTile(
                leading: const CircleAvatar(backgroundColor: Brand.primarySoft, foregroundColor: Brand.primary, child: Icon(Icons.south_west_rounded)),
                title: Text('${p['customer'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${fmt.date(p['date'] as String?)} · ${tr.t('method.${p['method']}')}${(p['reference'] ?? '').toString().isNotEmpty ? ' · ${p['reference']}' : ''}'),
                trailing: Text(fmt.money(p['amount']), style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF15803D))),
                onTap: p['customer_id'] == null
                    ? null
                    : () => Navigator.of(context).push(MaterialPageRoute<void>(
                        builder: (_) => CustomerDetailScreen(id: p['customer_id'] as int, name: '${p['customer'] ?? ''}'))),
              ),
            if (last > 1) Pager(page: payPage, last: last, onChanged: (p) => setState(() => payPage = p)),
          ]),
        );
      },
    );
  }
}

/// Up to three totals side by side.
class TotalsRow extends StatelessWidget {
  const TotalsRow(this.items, {super.key});

  final List<(String, String, Color?)> items;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
        child: Row(children: [
          for (final (n, it) in items.indexed) ...[
            if (n > 0) const SizedBox(width: 8),
            Expanded(child: StatTile(label: it.$1, value: it.$2, tone: it.$3)),
          ],
        ]),
      );
}

/// An invoice or bill in a list.
class DocTile extends StatelessWidget {
  const DocTile({super.key, required this.title, required this.subtitle, required this.amount, required this.status, this.due, this.onTap});

  final String title;
  final String subtitle;
  final String amount;
  final String status;
  final String? due;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w700, decoration: status == 'void' ? TextDecoration.lineThrough : null)),
                  Text(subtitle, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(amount, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 2),
                due == null ? StatusPill(status) : Text(due!, style: const TextStyle(fontSize: 12, color: Brand.danger, fontWeight: FontWeight.w600)),
              ]),
            ]),
          ),
        ),
      );
}

/// Invoice details with void / take payment.
class InvoiceSheet extends ConsumerWidget {
  const InvoiceSheet({super.key, required this.id});

  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final value = ref.watch(financeDocProvider('/invoices/$id'));
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: AsyncBody<Map<String, dynamic>>(
          value: value,
          onRetry: () => ref.invalidate(financeDocProvider('/invoices/$id')),
          builder: (context, i, meta) {
            final items = [for (final l in i['items'] as List? ?? const []) Map<String, dynamic>.from(l as Map)];
            final customer = i['customer'] is Map ? (i['customer'] as Map)['name'] : i['customer'];
            final open = i['status'] == 'unpaid' || i['status'] == 'partial';
            return ListView(padding: const EdgeInsets.only(bottom: 16), children: [
              ListTile(
                title: Text('${i['number']}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                subtitle: Text('${customer ?? '—'} · ${fmt.date(i['date'] as String?)}'),
                trailing: StatusPill('${i['status']}'),
              ),
              if ((i['description'] ?? '').toString().isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('${i['description']}')),
              const Divider(),
              for (final l in items)
                KeyValueRow('${l['description']}  ·  ${fmt.num(l['quantity'])} × ${fmt.money(l['unit_price'])}', fmt.money(l['amount'])),
              if (Fmt.parse(i['discount']) > 0) KeyValueRow(tr.t('bills.discount'), '-${fmt.money(i['discount'])}'),
              KeyValueRow(tr.t('common.total'), fmt.money(i['total']), bold: true),
              KeyValueRow(tr.t('status.paid'), fmt.money(i['paid'])),
              KeyValueRow(tr.t('income.due'), fmt.money(i['due']), bold: true, color: Fmt.parse(i['due']) > 0 ? Brand.danger : null),
              const SizedBox(height: 8),
              if (open && i['customer_id'] != null && auth.can('payments.create'))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: FilledButton.icon(
                    icon: const Icon(Icons.payments_outlined),
                    label: Text(tr.t('quick.payment')),
                    onPressed: () async {
                      await showFormSheet<void>(context, PaymentSheet(customerId: i['customer_id'] as int, name: '${customer ?? ''}', balance: '${i['due']}'));
                      ref.invalidate(financeDocProvider('/invoices/$id'));
                    },
                  ),
                ),
              if (i['status'] != 'void' && i['source_type'] != 'delivery' && auth.can('invoices.void'))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                    onPressed: () => voidDocument(context, ref, '/invoices/$id/void', tr.t('income.voided')),
                    child: Text(tr.t('income.void')),
                  ),
                ),
            ]);
          },
        ),
      ),
    );
  }
}

/// Confirms, then voids an invoice or bill (online only: it reverses ledger entries).
Future<void> voidDocument(BuildContext context, WidgetRef ref, String path, String doneText) async {
  final tr = ref.read(trProvider);
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(tr.t('common.areYouSure')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(tr.t('common.cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.pop(ctx, true), child: Text(tr.t('income.void'))),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  try {
    final r = await ref.read(outboxProvider).send('POST', path, body: {}, label: 'void', allowQueue: false);
    if (!context.mounted) return;
    Navigator.pop(context);
    showWriteResult(context, ref, r, doneText);
  } catch (e) {
    if (context.mounted) showError(context, ref, e);
  }
}

/// Manual sale: eggs, manure, other income (`POST /invoices`). Milk and animal sales create their own.
class SaleSheet extends ConsumerStatefulWidget {
  const SaleSheet({super.key});

  @override
  ConsumerState<SaleSheet> createState() => _SaleSheetState();
}

class _SaleSheetState extends ConsumerState<SaleSheet> {
  int? customerId;
  String? category;
  String date = today();
  final description = TextEditingController();
  final discount = TextEditingController();
  final lines = [LineDraft()];
  bool paidNow = true;
  String method = 'cash';

  @override
  void dispose() {
    description.dispose();
    discount.dispose();
    for (final l in lines) {
      l.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final accounts = ref.watch(accountsLookup).value ?? const [];
    final customers = ref.watch(customersLookup).value ?? const [];
    // A sale without a customer must be paid on the spot (server rule).
    final mustPay = customerId == null;
    final pay = mustPay || paidNow;
    final total = lines.fold<double>(0, (s, l) => s + l.amount) - Fmt.parse(discount.text);
    return FormSheet(
      title: tr.t('income.newSale'),
      hint: tr.t('income.hint'),
      canSubmit: category != null && lines.every((l) => l.description.text.trim().isNotEmpty && Fmt.parse(l.quantity.text) > 0 && l.unitPrice.text.isNotEmpty),
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send('POST', '/invoices', label: 'sale:$date', body: {
          'customer_id': customerId,
          'category': category,
          'date': date,
          'description': description.text.trim().isEmpty ? null : description.text.trim(),
          'discount': discount.text.isEmpty ? null : discount.text,
          'items': [
            for (final l in lines) {'description': l.description.text.trim(), 'quantity': l.quantity.text, 'unit_price': l.unitPrice.text},
          ],
          if (pay) 'paid_method': method,
        });
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('common.saved'));
      },
      children: [
        PickerInput<String>(
          label: tr.t('common.category'),
          options: [
            for (final a in accounts)
              if (a['type'] == 'revenue' && !['milk_sales', 'animal_sales'].contains(a['key'])) PickOption('${a['key']}', '${a['name']}'),
          ],
          value: category,
          onChanged: (v) => setState(() => category = v),
        ),
        PickerInput<int>(
          label: tr.t('nav.customers'),
          options: [for (final c in customers) PickOption(c['id'] as int, '${c['name']}', subtitle: c['area'] as String?)],
          value: customerId,
          allowNone: true,
          noneLabel: tr.t('bills.noSupplier'),
          onChanged: (v) => setState(() => customerId = v),
        ),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
        TextInput(description, tr.t('common.description')),
        for (final (n, l) in lines.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Row(children: [
                  Expanded(child: TextInput(l.description, tr.t('common.description'), onChanged: (_) => setState(() {}))),
                  if (lines.length > 1) IconButton(onPressed: () => setState(() => lines.removeAt(n).dispose()), icon: const Icon(Icons.close)),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: NumberInput(l.quantity, tr.t('common.quantity'), onChanged: (_) => setState(() {}))),
                  const SizedBox(width: 8),
                  Expanded(child: NumberInput(l.unitPrice, tr.t('bills.unitPrice'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {}))),
                ]),
              ]),
            ),
          ),
        OutlinedButton.icon(onPressed: () => setState(() => lines.add(LineDraft())), icon: const Icon(Icons.add), label: Text(tr.t('bills.addLine'))),
        NumberInput(discount, tr.t('bills.discount'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {})),
        KeyValueRow(tr.t('common.total'), fmt.money(total), bold: true),
        if (!mustPay)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(paidNow ? tr.t('bills.paidNow') : tr.t('bills.notPaid')),
            value: paidNow,
            onChanged: (v) => setState(() => paidNow = v),
          ),
        if (pay) MethodChips(value: method, onChanged: (m) => setState(() => method = m)),
      ],
    );
  }
}
