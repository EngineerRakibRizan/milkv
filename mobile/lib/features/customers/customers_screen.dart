import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/contact.dart';
import '../../shared/inputs.dart';
import '../../shared/widgets.dart';
import 'customers_repository.dart';

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  String search = '';
  String balance = '';
  int page = 1;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  CustomerQuery get q => (search: search, balance: balance, page: page);

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final value = ref.watch(customerListProvider(q));
    return Scaffold(
      appBar: AppBar(title: Text(tr.t('nav.customers'))),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
          child: TextField(
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr.t('customers.search')),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () => setState(() {
                    search = v.trim();
                    page = 1;
                  }));
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Wrap(spacing: 8, children: [
            for (final f in [('', tr.t('common.all')), ('due', tr.t('customers.withDues')), ('advance', tr.t('customers.advances'))])
              ChoiceChip(label: Text(f.$2), selected: balance == f.$1, onSelected: (_) => setState(() {
                    balance = f.$1;
                    page = 1;
                  })),
          ]),
        ),
        Expanded(
          child: AsyncBody<CustomerPage>(
            value: value,
            onRetry: () => ref.invalidate(customerListProvider(q)),
            builder: (context, data, meta) => RefreshIndicator(
              onRefresh: () => ref.refresh(customerListProvider(q).future),
              child: ListView(
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  StaleNote(meta),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
                    child: Text('${tr.t('customers.count')}: ${fmt.num(data.total, digits: 0)}  ·  ${tr.t('customers.outstanding')}: ${fmt.money(data.totalDue)}',
                        style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  ),
                  if (data.items.isEmpty) EmptyState(icon: Icons.people_outline, title: tr.t('customers.empty')),
                  for (final c in data.items) _CustomerTile(c),
                  if (data.lastPage > 1)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        IconButton.outlined(onPressed: page > 1 ? () => setState(() => page--) : null, icon: const Icon(Icons.chevron_left)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Text(tr.t('common.page', params: {'page': page, 'last': data.lastPage})),
                        ),
                        IconButton.outlined(onPressed: page < data.lastPage ? () => setState(() => page++) : null, icon: const Icon(Icons.chevron_right)),
                      ]),
                    ),
                ],
              ),
            ),
          ),
        ),
      ]),
    );
  }
}

class _CustomerTile extends ConsumerWidget {
  const _CustomerTile(this.c);

  final Customer c;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = ref.watch(fmtProvider);
    final bal = Fmt.parse(c.balance);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
      leading: CircleAvatar(
        backgroundColor: Brand.primarySoft,
        foregroundColor: Brand.primary,
        child: Text(c.name.isEmpty ? '?' : c.name.characters.first.toUpperCase()),
      ),
      title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([c.area, c.phone].whereType<String>().where((s) => s.isNotEmpty).join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Text(
        bal == 0 ? '—' : fmt.money(bal.abs()),
        style: TextStyle(fontWeight: FontWeight.w700, color: bal > 0 ? Brand.danger : bal < 0 ? const Color(0xFF15803D) : null),
      ),
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CustomerDetailScreen(id: c.id, name: c.name))),
    );
  }
}

class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({super.key, required this.id, required this.name});

  final int id;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final canPay = ref.watch(authProvider.select((s) => s.can('payments.create')));
    final value = ref.watch(customerDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(name)),
      floatingActionButton: canPay
          ? FloatingActionButton.extended(
              onPressed: () {
                final c = value.value?.data.customer;
                showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => PaymentSheet(customerId: id, name: name, balance: c?.balance ?? '0'));
              },
              icon: const Icon(Icons.payments_outlined),
              label: Text(tr.t('quick.payment')),
            )
          : null,
      body: AsyncBody<CustomerDetail>(
        value: value,
        onRetry: () => ref.invalidate(customerDetailProvider(id)),
        builder: (context, d, meta) {
          final c = d.customer;
          final bal = Fmt.parse(c.balance);
          final muted = Theme.of(context).colorScheme.onSurfaceVariant;
          return RefreshIndicator(
            onRefresh: () => ref.refresh(customerDetailProvider(id).future),
            child: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 96), children: [
              StaleNote(meta),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(bal >= 0 ? tr.t('payments.owes') : tr.t('payments.credit'), style: TextStyle(color: muted)),
                    Text(fmt.money(bal.abs()),
                        style: TextStyle(fontFamily: 'BalooDa2', fontSize: 34, fontWeight: FontWeight.w700, color: bal > 0 ? Brand.danger : const Color(0xFF15803D))),
                    const SizedBox(height: 6),
                    if ((c.address ?? '').isNotEmpty || (c.area ?? '').isNotEmpty) Text([c.address, c.area].whereType<String>().where((s) => s.isNotEmpty).join(', ')),
                    Text('${tr.t('customers.daily')}: ${fmt.litres(c.defaultQty)}${c.price != null ? '  ·  ${fmt.money(c.price)}/${tr.t('units.l')}' : ''}', style: TextStyle(color: muted)),
                    if (c.phone?.isNotEmpty == true) ...[
                      const SizedBox(height: 12),
                      Row(children: [
                        Expanded(child: OutlinedButton.icon(onPressed: () => callPhone(c.phone!), icon: const Icon(Icons.call_outlined), label: Text(c.phone!))),
                        const SizedBox(width: 8),
                        Expanded(child: OutlinedButton.icon(onPressed: () => openWhatsApp(c.phone!), icon: const Icon(Icons.chat_outlined), label: const Text('WhatsApp'))),
                      ]),
                    ],
                  ]),
                ),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: StatTile(label: '${tr.t('customers.thisMonth')} (${tr.t('units.l')})', value: fmt.litres(d.stats['month_litres']))),
                const SizedBox(width: 8),
                Expanded(child: StatTile(label: tr.t('customers.thisMonth'), value: fmt.money(d.stats['month_amount']))),
              ]),
              const SizedBox(height: 10),
              SectionCard(
                title: tr.t('customers.payments'),
                child: Column(children: [
                  if (d.payments.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(tr.t('common.noData'), style: TextStyle(color: muted))),
                  for (final p in d.payments)
                    ListTile(
                      dense: true,
                      leading: Icon(p['pending'] == true ? Icons.cloud_queue_rounded : Icons.check_circle_outline, color: p['pending'] == true ? Brand.warning : const Color(0xFF15803D)),
                      title: Text(fmt.money(p['amount']), style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${fmt.date(p['date'] as String?)} · ${tr.t('method.${p['method']}')}'),
                    ),
                ]),
              ),
              const SizedBox(height: 10),
              SectionCard(
                title: tr.t('nav.deliveries'),
                child: Column(children: [
                  if (d.deliveries.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(tr.t('common.noData'), style: TextStyle(color: muted))),
                  for (final x in d.deliveries.take(15))
                    ListTile(
                      dense: true,
                      title: Text(fmt.date(x['date'] as String?)),
                      subtitle: Text(fmt.litres(x['status'] == 'delivered' || x['status'] == 'partial' ? x['delivered'] : x['ordered'])),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [Text(fmt.money(x['amount'])), const SizedBox(width: 8), StatusPill('${x['status']}')]),
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

/// Record a customer payment (cash / bKash / Nagad…).
class PaymentSheet extends ConsumerStatefulWidget {
  const PaymentSheet({super.key, required this.customerId, required this.name, required this.balance});

  final int customerId;
  final String name;
  final String balance;

  @override
  ConsumerState<PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends ConsumerState<PaymentSheet> {
  final amount = TextEditingController();
  final reference = TextEditingController();
  String method = 'cash';
  bool busy = false;

  @override
  void dispose() {
    amount.dispose();
    reference.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (Fmt.parse(amount.text) <= 0) return;
    setState(() => busy = true);
    try {
      final r = await ref.read(customersRepositoryProvider).recordPayment(
            customerId: widget.customerId,
            amount: amount.text,
            method: method,
            date: today(),
            reference: reference.text.trim().isEmpty ? null : reference.text.trim(),
          );
      if (!mounted) return;
      Navigator.pop(context);
      showWriteResult(context, ref, r, ref.read(trProvider).t('payments.saved'));
      ref.invalidate(customerDetailProvider(widget.customerId));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final owes = Fmt.parse(widget.balance);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr.t('payments.new'), style: Theme.of(context).textTheme.titleLarge),
        Text(widget.name, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 16),
        TextField(
          key: const Key('payment-amount'),
          controller: amount,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [DecimalInputFormatter(decimals: 2)],
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: tr.t('common.amount'),
            prefixText: '৳ ',
            suffixIcon: owes > 0
                ? TextButton(onPressed: () => setState(() => amount.text = widget.balance), child: Text('${tr.t('payments.payAll')} ${fmt.money(owes)}'))
                : null,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 4, children: [
          for (final m in ['cash', 'bkash', 'nagad', 'rocket', 'bank'])
            ChoiceChip(label: Text(tr.t('method.$m')), selected: method == m, onSelected: (_) => setState(() => method = m)),
        ]),
        if (method != 'cash') ...[
          const SizedBox(height: 12),
          TextField(controller: reference, decoration: InputDecoration(labelText: tr.t('common.reference'))),
        ],
        const SizedBox(height: 8),
        Text(tr.t('payments.hint'), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 16),
        FilledButton(onPressed: busy || Fmt.parse(amount.text) <= 0 ? null : _submit, child: Text(tr.t('common.save'))),
      ]),
    );
  }
}
