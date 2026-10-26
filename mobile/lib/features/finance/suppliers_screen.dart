import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/contact.dart';
import '../../shared/forms.dart';
import '../../shared/lookups.dart';
import '../../shared/widgets.dart';
import 'expenses_screen.dart';
import 'income_screen.dart';

const supplierTypes = ['feed', 'medicine', 'equipment', 'animals', 'services', 'other'];

final supplierListProvider = StreamProvider.autoDispose<Cached<List<Map<String, dynamic>>>>((ref) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/suppliers', (j) => [for (final s in j as List) Map<String, dynamic>.from(s as Map)]);
});

void _refreshSuppliers(WidgetRef ref) {
  ref.invalidate(supplierListProvider);
  ref.invalidate(suppliersLookup);
  refreshFinance(ref);
}

class SuppliersScreen extends ConsumerStatefulWidget {
  const SuppliersScreen({super.key});

  @override
  ConsumerState<SuppliersScreen> createState() => _SuppliersScreenState();
}

class _SuppliersScreenState extends ConsumerState<SuppliersScreen> {
  String search = '';

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final value = ref.watch(supplierListProvider);
    return Scaffold(
      appBar: AppBar(title: Text(tr.t('nav.suppliers'))),
      floatingActionButton: ref.watch(authProvider.select((s) => s.can('suppliers.create')))
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add),
              label: Text(tr.t('suppliers.add')),
              onPressed: () async {
                await showFormSheet<void>(context, const SupplierSheet());
                _refreshSuppliers(ref);
              },
            )
          : null,
      body: AsyncBody<List<Map<String, dynamic>>>(
        value: value,
        onRetry: () => ref.invalidate(supplierListProvider),
        builder: (context, all, meta) {
          final shown = all.where((s) => search.isEmpty || '${s['name']} ${s['phone'] ?? ''}'.toLowerCase().contains(search.toLowerCase())).toList();
          final totalDue = all.fold<double>(0, (sum, s) => sum + Fmt.parse(s['balance']));
          return RefreshIndicator(
            onRefresh: () => ref.refresh(supplierListProvider.future),
            child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
              StaleNote(meta),
              TotalsRow([
                (tr.t('suppliers.count'), fmt.num(all.length, digits: 0), null),
                (tr.t('reports.payables'), fmt.money(totalDue), totalDue > 0 ? Brand.danger : null),
              ]),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                child: TextField(
                  decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr.t('common.search')),
                  onChanged: (v) => setState(() => search = v.trim()),
                ),
              ),
              if (shown.isEmpty) EmptyState(icon: Icons.storefront_outlined, title: tr.t('common.noData')),
              for (final s in shown)
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                  leading: const CircleAvatar(backgroundColor: Brand.primarySoft, foregroundColor: Brand.primary, child: Icon(Icons.storefront_outlined)),
                  title: Text('${s['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text([if (s['type'] != null) tr.t('suppliers.t.${s['type']}'), if (s['phone'] != null) '${s['phone']}'].join(' · ')),
                  trailing: Text(Fmt.parse(s['balance']) == 0 ? '—' : fmt.money(s['balance']),
                      style: TextStyle(fontWeight: FontWeight.w700, color: Fmt.parse(s['balance']) > 0 ? Brand.danger : null)),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SupplierDetailScreen(id: s['id'] as int, name: '${s['name']}'))),
                ),
            ]),
          );
        },
      ),
    );
  }
}

/// `GET /suppliers/{id}`: balance, recent bills and payments.
class SupplierDetailScreen extends ConsumerWidget {
  const SupplierDetailScreen({super.key, required this.id, required this.name});

  final int id;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final names = ref.watch(accountNamesProvider);
    final path = '/suppliers/$id';
    final value = ref.watch(financeDocProvider(path));
    final s = value.value?.data['supplier'] as Map?;
    return Scaffold(
      appBar: AppBar(
        title: Text(name),
        actions: [
          if (auth.can('suppliers.update') && s != null)
            IconButton(
              tooltip: tr.t('common.edit'),
              icon: const Icon(Icons.edit_outlined),
              onPressed: () async {
                await showFormSheet<void>(context, SupplierSheet(supplier: Map<String, dynamic>.from(s)));
                _refreshSuppliers(ref);
              },
            ),
        ],
      ),
      floatingActionButton: auth.can('bills.pay') && s != null && Fmt.parse(s['balance']) > 0
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.payments_outlined),
              label: Text(tr.t('bills.pay')),
              onPressed: () async {
                await showFormSheet<void>(context, SupplierPaymentSheet(supplierId: id, due: '${s['balance']}', name: name));
                _refreshSuppliers(ref);
              },
            )
          : null,
      body: AsyncBody<Map<String, dynamic>>(
        value: value,
        onRetry: () => ref.invalidate(financeDocProvider(path)),
        builder: (context, d, meta) {
          final sup = Map<String, dynamic>.from(d['supplier'] as Map);
          final bills = [for (final b in d['bills'] as List) Map<String, dynamic>.from(b as Map)];
          final payments = [for (final p in d['payments'] as List) Map<String, dynamic>.from(p as Map)];
          final bal = Fmt.parse(sup['balance']);
          return RefreshIndicator(
            onRefresh: () => ref.refresh(financeDocProvider(path).future),
            child: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 96), children: [
              StaleNote(meta),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr.t('reports.payables'), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                    Text(fmt.money(bal), style: TextStyle(fontFamily: 'BalooDa2', fontSize: 34, fontWeight: FontWeight.w700, color: bal > 0 ? Brand.danger : null)),
                    if (sup['type'] != null) Text(tr.t('suppliers.t.${sup['type']}')),
                    if ((sup['address'] ?? '').toString().isNotEmpty) Text('${sup['address']}'),
                    if ((sup['phone'] ?? '').toString().isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: OutlinedButton.icon(onPressed: () => callPhone('${sup['phone']}'), icon: const Icon(Icons.call_outlined), label: Text('${sup['phone']}'))),
                        const SizedBox(width: 8),
                        Expanded(child: OutlinedButton.icon(onPressed: () => openWhatsApp('${sup['phone']}'), icon: const Icon(Icons.chat_outlined), label: const Text('WhatsApp'))),
                      ]),
                    ],
                  ]),
                ),
              ),
              const SizedBox(height: 10),
              SectionCard(
                title: tr.t('suppliers.bills'),
                child: Column(children: [
                  if (bills.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(tr.t('common.noData'))),
                  for (final b in bills)
                    ListTile(
                      dense: true,
                      title: Text((b['description'] as String?) ?? names['${b['category']}'] ?? '${b['number']}'),
                      subtitle: Text('${b['number']} · ${fmt.date(b['date'] as String?)}'),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [Text(fmt.money(b['total'])), const SizedBox(width: 8), StatusPill('${b['status']}')]),
                      onTap: () async {
                        await showFormSheet<void>(context, BillDetailSheet(id: b['id'] as int));
                        _refreshSuppliers(ref);
                      },
                    ),
                ]),
              ),
              const SizedBox(height: 10),
              SectionCard(
                title: tr.t('customers.payments'),
                child: Column(children: [
                  if (payments.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(tr.t('common.noData'))),
                  for (final p in payments)
                    ListTile(
                      dense: true,
                      title: Text(fmt.money(p['amount']), style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${fmt.date(p['date'] as String?)} · ${tr.t('method.${p['method']}')}'),
                    ),
                ]),
              ),
            ]),
          );
        },
      ),
    );
  }
}

class SupplierSheet extends ConsumerStatefulWidget {
  const SupplierSheet({super.key, this.supplier});

  final Map<String, dynamic>? supplier;

  @override
  ConsumerState<SupplierSheet> createState() => _SupplierSheetState();
}

class _SupplierSheetState extends ConsumerState<SupplierSheet> {
  late final s = widget.supplier ?? const {};
  late final name = TextEditingController(text: '${s['name'] ?? ''}');
  late final phone = TextEditingController(text: '${s['phone'] ?? ''}');
  late final address = TextEditingController(text: '${s['address'] ?? ''}');
  late final notes = TextEditingController(text: '${s['notes'] ?? ''}');
  late String? type = s['type'] as String?;

  @override
  void dispose() {
    for (final c in [name, phone, address, notes]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final editing = widget.supplier != null;
    String? text(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    return FormSheet(
      title: editing ? tr.t('common.edit') : tr.t('suppliers.add'),
      canSubmit: name.text.trim().isNotEmpty,
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send(editing ? 'PUT' : 'POST', editing ? '/suppliers/${s['id']}' : '/suppliers',
            label: 'supplier', allowQueue: false, body: {'name': name.text.trim(), 'phone': text(phone), 'address': text(address), 'type': type, 'notes': text(notes)});
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('common.saved'));
      },
      children: [
        TextInput(name, tr.t('common.name'), onChanged: (_) => setState(() {})),
        TextInput(phone, tr.t('common.phone'), keyboard: TextInputType.phone),
        PickerInput<String>(
          label: tr.t('common.type'),
          options: [for (final t in supplierTypes) PickOption(t, tr.t('suppliers.t.$t'))],
          value: type,
          allowNone: true,
          onChanged: (v) => setState(() => type = v),
        ),
        TextInput(address, tr.t('customers.address')),
        TextInput(notes, tr.t('common.notes'), maxLines: 2),
      ],
    );
  }
}
