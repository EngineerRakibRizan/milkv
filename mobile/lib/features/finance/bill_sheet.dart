import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/providers.dart';
import '../../shared/forms.dart';
import '../../shared/lookups.dart';
import '../../shared/widgets.dart';

/// Expense, stock purchase or asset bill (`POST /bills`).
/// purchase: lines are stock items (stock goes up at landed cost);
/// expense/asset: lines against a category account.
class BillSheet extends ConsumerStatefulWidget {
  const BillSheet({super.key, this.kind = 'expense'});

  final String kind;

  @override
  ConsumerState<BillSheet> createState() => _BillSheetState();
}

class _BillSheetState extends ConsumerState<BillSheet> {
  late String kind = widget.kind;
  String? category;
  int? supplierId;
  String date = today();
  String? dueDate;
  final description = TextEditingController();
  final discount = TextEditingController();
  final extra = TextEditingController();
  final lines = [LineDraft()];
  bool paid = true;
  String method = 'cash';

  @override
  void dispose() {
    description.dispose();
    discount.dispose();
    extra.dispose();
    for (final l in lines) {
      l.dispose();
    }
    super.dispose();
  }

  bool get _valid =>
      (kind == 'purchase' || category != null) &&
      lines.every((l) => Fmt.parse(l.quantity.text) > 0 && l.unitPrice.text.isNotEmpty && (kind != 'purchase' || l.feedItemId != null));

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final accounts = ref.watch(accountsLookup).value ?? const [];
    final suppliers = ref.watch(suppliersLookup).value ?? const [];
    final items = ref.watch(feedItemsLookup).value ?? const [];
    // Same category rules as the web form: feed cost is booked when consumed, not when bought.
    final categories = [
      for (final a in accounts)
        if (kind == 'asset' ? ['livestock_assets', 'equipment_assets'].contains(a['key']) : a['type'] == 'expense' && !['feed_expense', 'inventory_loss'].contains(a['key']))
          PickOption('${a['key']}', '${a['name']}'),
    ];
    final total = lines.fold<double>(0, (s, l) => s + l.amount) - Fmt.parse(discount.text) + Fmt.parse(extra.text);

    return FormSheet(
      title: kind == 'purchase' ? tr.t('bills.newPurchase') : tr.t('bills.newExpense'),
      hint: paid ? null : tr.t('bills.unpaidHint'),
      canSubmit: _valid,
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send('POST', '/bills', label: 'bill:$kind:$date', body: {
          'kind': kind,
          if (kind != 'purchase') 'category': category,
          'supplier_id': supplierId,
          'date': date,
          'due_date': paid ? null : dueDate,
          'description': description.text.trim().isEmpty ? null : description.text.trim(),
          'discount': discount.text.isEmpty ? null : discount.text,
          'extra_cost': kind == 'purchase' && extra.text.isNotEmpty ? extra.text : null,
          'items': [
            for (final l in lines)
              {
                if (kind == 'purchase') 'feed_item_id': l.feedItemId,
                'description': l.description.text.trim().isEmpty ? null : l.description.text.trim(),
                'quantity': l.quantity.text,
                'unit_price': l.unitPrice.text,
              },
          ],
          'paid': paid,
          if (paid) 'method': method,
        });
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('bills.saved'));
      },
      children: [
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'expense', label: Text(tr.t('bills.k.expense'))),
            ButtonSegment(value: 'purchase', label: Text(tr.t('bills.k.purchase'))),
            ButtonSegment(value: 'asset', label: Text(tr.t('bills.k.asset'))),
          ],
          selected: {kind},
          onSelectionChanged: (s) => setState(() {
            kind = s.first;
            category = null;
          }),
        ),
        if (kind != 'purchase')
          PickerInput<String>(label: tr.t('common.category'), options: categories, value: category, onChanged: (v) => setState(() => category = v)),
        PickerInput<int>(
          label: tr.t('nav.suppliers'),
          options: [for (final s in suppliers) PickOption(s['id'] as int, '${s['name']}')],
          value: supplierId,
          allowNone: true,
          noneLabel: tr.t('bills.noSupplier'),
          onChanged: (v) => setState(() => supplierId = v),
        ),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
        TextInput(description, tr.t('common.description')),
        for (final (n, l) in lines.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: kind == 'purchase'
                        ? PickerInput<int>(
                            label: tr.t('inventory.item'),
                            options: [for (final i in items) PickOption(i['id'] as int, '${i['name']} (${tr.t('units.${i['unit']}', fallback: '${i['unit']}')})')],
                            value: l.feedItemId,
                            onChanged: (v) => setState(() => l.feedItemId = v),
                          )
                        : TextInput(l.description, tr.t('common.description')),
                  ),
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
        Row(children: [
          Expanded(child: NumberInput(discount, tr.t('bills.discount'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {}))),
          if (kind == 'purchase') ...[
            const SizedBox(width: 8),
            Expanded(child: NumberInput(extra, tr.t('bills.extra'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {}))),
          ],
        ]),
        KeyValueRow(tr.t('common.total'), fmt.money(total), bold: true),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(paid ? tr.t('bills.paidNow') : tr.t('bills.notPaid')),
          value: paid,
          onChanged: (v) => setState(() => paid = v),
        ),
        if (paid)
          MethodChips(value: method, onChanged: (m) => setState(() => method = m))
        else
          DateInput(label: tr.t('bills.due'), value: dueDate, allowFuture: true, optional: true, onChanged: (v) => setState(() => dueDate = v)),
      ],
    );
  }
}
