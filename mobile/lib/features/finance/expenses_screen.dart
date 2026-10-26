import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/forms.dart';
import '../../shared/inputs.dart';
import '../../shared/lookups.dart';
import '../../shared/widgets.dart';
import 'bill_sheet.dart';
import 'income_screen.dart';

/// Bills: operating expenses, stock purchases and assets (`GET /bills`).
class ExpensesScreen extends ConsumerStatefulWidget {
  const ExpensesScreen({super.key});

  @override
  ConsumerState<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends ConsumerState<ExpensesScreen> {
  Period period = Period.thisMonth();
  String kind = '';
  int page = 1;

  Future<void> _open(Widget sheet) async {
    await showFormSheet<void>(context, sheet);
    if (mounted) refreshFinance(ref);
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final names = ref.watch(accountNamesProvider);
    final q = (path: '/bills', from: period.from, to: period.to, status: kind, page: page);
    final value = ref.watch(financeListProvider(q));
    return Scaffold(
      appBar: AppBar(title: Text(tr.t('nav.expenses'))),
      floatingActionButton: ref.watch(authProvider.select((s) => s.can('bills.create')))
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add),
              label: Text(tr.t('bills.newExpense')),
              onPressed: () => _open(BillSheet(kind: kind.isEmpty ? 'expense' : kind)),
            )
          : null,
      body: Column(children: [
        PeriodChips(value: period, onChanged: (p) => setState(() {
              period = p;
              page = 1;
            })),
        FilterChips<String>(
          value: kind,
          options: [('', tr.t('common.all')), ('expense', tr.t('bills.k.expense')), ('purchase', tr.t('bills.k.purchase')), ('asset', tr.t('bills.k.asset'))],
          onChanged: (v) => setState(() {
            kind = v;
            page = 1;
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
                    (tr.t('bills.billed'), fmt.money(totals['total']), null),
                    (tr.t('bills.paidOut'), fmt.money(totals['paid']), const Color(0xFF15803D)),
                    (tr.t('income.outstanding'), fmt.money(totals['due']), Brand.danger),
                  ]),
                  if (rows.isEmpty) EmptyState(icon: Icons.receipt_outlined, title: tr.t('common.noData'), hint: tr.t('bills.subtitle')),
                  for (final b in rows)
                    DocTile(
                      title: (b['description'] as String?) ?? names['${b['category']}'] ?? tr.t('bills.k.${b['kind']}'),
                      subtitle: [
                        '${b['number']}',
                        fmt.date(b['date'] as String?),
                        if (b['supplier'] != null) '${b['supplier']}',
                        if (b['category'] != null) names['${b['category']}'] ?? '${b['category']}',
                      ].join(' · '),
                      amount: fmt.money(b['total']),
                      status: '${b['status']}',
                      due: Fmt.parse(b['due']) > 0 && b['status'] != 'void' ? '${tr.t('income.due')} ${fmt.money(b['due'])}' : null,
                      onTap: () async {
                        await showFormSheet<void>(context, BillDetailSheet(id: b['id'] as int));
                        refreshFinance(ref);
                      },
                    ),
                  if (last > 1) Pager(page: page, last: last, onChanged: (p) => setState(() => page = p)),
                ]),
              );
            },
          ),
        ),
      ]),
    );
  }
}

/// A bill with its lines; pay what is due, or void it.
class BillDetailSheet extends ConsumerWidget {
  const BillDetailSheet({super.key, required this.id});

  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final names = ref.watch(accountNamesProvider);
    final value = ref.watch(financeDocProvider('/bills/$id'));
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: AsyncBody<Map<String, dynamic>>(
          value: value,
          onRetry: () => ref.invalidate(financeDocProvider('/bills/$id')),
          builder: (context, b, meta) {
            final items = [for (final l in b['items'] as List? ?? const []) Map<String, dynamic>.from(l as Map)];
            final supplier = b['supplier'] is Map ? (b['supplier'] as Map)['name'] : b['supplier'];
            final open = b['status'] == 'unpaid' || b['status'] == 'partial';
            return ListView(padding: const EdgeInsets.only(bottom: 16), children: [
              ListTile(
                title: Text('${b['number']}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                subtitle: Text([
                  fmt.date(b['date'] as String?),
                  tr.t('bills.k.${b['kind']}'),
                  if (b['category'] != null) names['${b['category']}'] ?? '${b['category']}',
                  if (supplier != null) '$supplier',
                ].join(' · ')),
                trailing: StatusPill('${b['status']}'),
              ),
              if ((b['description'] ?? '').toString().isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('${b['description']}')),
              const Divider(),
              for (final l in items) KeyValueRow('${l['description']}  ·  ${fmt.num(l['quantity'])} × ${fmt.money(l['unit_price'])}', fmt.money(l['amount'])),
              if (Fmt.parse(b['discount']) > 0) KeyValueRow(tr.t('bills.discount'), '-${fmt.money(b['discount'])}'),
              if (Fmt.parse(b['extra_cost']) > 0) KeyValueRow(tr.t('bills.extra'), fmt.money(b['extra_cost'])),
              KeyValueRow(tr.t('common.total'), fmt.money(b['total']), bold: true),
              KeyValueRow(tr.t('bills.paidOut'), fmt.money(b['paid'])),
              KeyValueRow(tr.t('income.due'), fmt.money(b['due']), bold: true, color: Fmt.parse(b['due']) > 0 ? Brand.danger : null),
              const SizedBox(height: 8),
              if (open && auth.can('bills.pay'))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: FilledButton.icon(
                    icon: const Icon(Icons.payments_outlined),
                    label: Text(tr.t('bills.pay')),
                    onPressed: () async {
                      await showFormSheet<void>(context, SupplierPaymentSheet(billId: id, supplierId: b['supplier_id'] as int?, due: '${b['due']}', name: '${supplier ?? b['number']}'));
                      ref.invalidate(financeDocProvider('/bills/$id'));
                    },
                  ),
                ),
              if (b['status'] != 'void' && b['source_type'] == null && auth.can('bills.void'))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                    onPressed: () => voidDocument(context, ref, '/bills/$id/void', tr.t('common.saved')),
                    child: Text(tr.t('income.void')),
                  ),
                ),
              if (b['source_type'] != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('${tr.t('bills.linked')} ${b['source_type']}', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ),
            ]);
          },
        ),
      ),
    );
  }
}

/// Pay a supplier, against one bill or on account (`POST /supplier-payments`).
class SupplierPaymentSheet extends ConsumerStatefulWidget {
  const SupplierPaymentSheet({super.key, this.billId, this.supplierId, required this.due, required this.name});

  final int? billId;
  final int? supplierId;
  final String due;
  final String name;

  @override
  ConsumerState<SupplierPaymentSheet> createState() => _SupplierPaymentSheetState();
}

class _SupplierPaymentSheetState extends ConsumerState<SupplierPaymentSheet> {
  late final amount = TextEditingController(text: Fmt.parse(widget.due) > 0 ? trimZero(widget.due) : '');
  final reference = TextEditingController();
  String method = 'cash';
  String date = today();


  @override
  void dispose() {
    amount.dispose();
    reference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    return FormSheet(
      title: tr.t('bills.pay'),
      hint: widget.name,
      canSubmit: Fmt.parse(amount.text) > 0,
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send('POST', '/supplier-payments', label: 'supplier-payment', body: {
          'bill_id': widget.billId,
          'supplier_id': widget.supplierId,
          'amount': amount.text,
          'method': method,
          'date': date,
          'reference': reference.text.trim().isEmpty ? null : reference.text.trim(),
        });
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('bills.paid'));
      },
      children: [
        NumberInput(amount, tr.t('common.amount'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {})),
        MethodChips(value: method, onChanged: (m) => setState(() => method = m)),
        if (method != 'cash') TextInput(reference, tr.t('common.reference')),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
      ],
    );
  }
}
