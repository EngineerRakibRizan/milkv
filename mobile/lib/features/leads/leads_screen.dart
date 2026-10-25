import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/offline/outbox.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../shared/contact.dart';
import '../../shared/inputs.dart';
import '../../shared/widgets.dart';
import '../customers/customers_screen.dart';

/// LeadController::present.
class Lead {
  Lead(this.json);

  final Map<String, dynamic> json;
  int get id => json['id'] as int;
  String get name => '${json['name'] ?? ''}';
  String? get phone => json['phone'] as String?;
  String? get area => json['area'] as String?;
  String? get address => json['address'] as String?;
  String get quantity => '${json['quantity'] ?? '0'}';
  String? get startDate => json['start_date'] as String?;
  String? get message => json['message'] as String?;
  String get status => '${json['status']}';
  int? get customerId => json['customer_id'] as int?;
  String? get createdAt => json['created_at'] as String?;
}

class LeadPage {
  LeadPage(this.items, this.counts);

  final List<Lead> items;
  final Map<String, dynamic> counts;

  factory LeadPage.fromJson(dynamic j) => LeadPage(
        [for (final l in j['data'] as List) Lead(Map<String, dynamic>.from(l as Map))],
        j['counts'] is Map ? Map<String, dynamic>.from(j['counts'] as Map) : const {},
      );
}

class LeadsRepository {
  LeadsRepository(this._cache, this._outbox);

  final QueryCache _cache;
  final Outbox _outbox;

  Stream<Cached<LeadPage>> list(String status) => _cache.watch('/leads', LeadPage.fromJson, query: {'status': status, 'per_page': 100});

  Future<WriteResult> setStatus(Lead l, String status) async {
    final r = await _outbox.send('PATCH', '/leads/${l.id}', body: {'status': status}, label: 'lead:${l.id}:$status');
    await _cache.patch('/leads', query: {'status': l.status, 'per_page': 100}, (data) {
      final m = Map<String, dynamic>.from(data as Map);
      m['data'] = [for (final x in m['data'] as List) if ((x as Map)['id'] != l.id) x];
      return m;
    });
    return r;
  }

  /// Creates the customer from the enquiry. Needs a connection (it returns the new customer).
  Future<int> convert(Lead l, Map<String, dynamic> body) async {
    final r = await _outbox.send('POST', '/leads/${l.id}/convert', body: body, label: 'lead-convert:${l.id}', allowQueue: false);
    return (r.data as Map)['customer_id'] as int;
  }
}

final leadsRepositoryProvider = Provider((ref) => LeadsRepository(ref.watch(queryCacheProvider), ref.watch(outboxProvider)));

final leadsProvider = StreamProvider.autoDispose.family<Cached<LeadPage>, String>((ref, status) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(leadsRepositoryProvider).list(status);
});

class LeadsScreen extends ConsumerStatefulWidget {
  const LeadsScreen({super.key});

  @override
  ConsumerState<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends ConsumerState<LeadsScreen> {
  String status = 'new';

  Future<void> _set(Lead l, String s) async {
    try {
      final r = await ref.read(leadsRepositoryProvider).setStatus(l, s);
      if (!mounted) return;
      showWriteResult(context, ref, r, ref.read(trProvider).t('leads.s.$s'));
      ref.invalidate(leadsProvider(status));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    }
  }

  Future<void> _convert(Lead l) async {
    final id = await showModalBottomSheet<int>(context: context, isScrollControlled: true, builder: (_) => _ConvertSheet(l));
    if (id == null || !mounted) return;
    ref.invalidate(leadsProvider(status));
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ref.read(trProvider).t('leads.converted'))));
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CustomerDetailScreen(id: id, name: l.name)));
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final value = ref.watch(leadsProvider(status));
    final counts = value.value?.data.counts ?? const {};
    return Scaffold(
      appBar: AppBar(title: Text(tr.t('nav.leads'))),
      body: Column(children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Row(children: [
            for (final s in ['new', 'contacted', 'converted', 'lost'])
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text('${tr.t('leads.s.$s')}${counts[s] != null ? ' (${fmt.num(counts[s], digits: 0)})' : ''}'),
                  selected: status == s,
                  onSelected: (_) => setState(() => status = s),
                ),
              ),
          ]),
        ),
        Expanded(
          child: AsyncBody<LeadPage>(
            value: value,
            onRetry: () => ref.invalidate(leadsProvider(status)),
            builder: (context, data, meta) => RefreshIndicator(
              onRefresh: () => ref.refresh(leadsProvider(status).future),
              child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
                StaleNote(meta),
                if (data.items.isEmpty) EmptyState(icon: Icons.inbox_outlined, title: tr.t('leads.empty'), hint: tr.t('leads.emptyHint')),
                for (final l in data.items)
                  Card(
                    margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(l.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
                          Text(fmt.date(l.createdAt, year: false), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                        ]),
                        const SizedBox(height: 4),
                        Text([
                          '${fmt.litres(l.quantity)}/${tr.t('leads.day')}',
                          if ((l.area ?? '').isNotEmpty) l.area!,
                          if (l.startDate != null) '${tr.t('leads.from')} ${fmt.date(l.startDate, year: false)}',
                        ].join(' · ')),
                        if ((l.address ?? '').isNotEmpty) Text(l.address!, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                        if ((l.message ?? '').isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text('“${l.message}”', style: const TextStyle(fontStyle: FontStyle.italic)),
                        ],
                        const SizedBox(height: 10),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          if (l.phone?.isNotEmpty == true) ...[
                            FilledButton.tonalIcon(onPressed: () => callPhone(l.phone!), icon: const Icon(Icons.call_outlined), label: Text(l.phone!)),
                            OutlinedButton.icon(onPressed: () => openWhatsApp(l.phone!), icon: const Icon(Icons.chat_outlined), label: const Text('WhatsApp')),
                          ],
                          if (auth.can('leads.update') && l.status == 'new')
                            OutlinedButton(onPressed: () => _set(l, 'contacted'), child: Text(tr.t('leads.markCalled'))),
                          if (auth.can('customers.create') && (l.status == 'new' || l.status == 'contacted'))
                            FilledButton(onPressed: () => _convert(l), child: Text(tr.t('leads.convert'))),
                          if (auth.can('leads.update') && (l.status == 'new' || l.status == 'contacted'))
                            TextButton(onPressed: () => _set(l, 'lost'), child: Text(tr.t('leads.markLost'))),
                          if (l.customerId != null)
                            TextButton(
                              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CustomerDetailScreen(id: l.customerId!, name: l.name))),
                              child: Text(tr.t('leads.viewCustomer')),
                            ),
                        ]),
                      ]),
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

class _ConvertSheet extends ConsumerStatefulWidget {
  const _ConvertSheet(this.lead);

  final Lead lead;

  @override
  ConsumerState<_ConvertSheet> createState() => _ConvertSheetState();
}

class _ConvertSheetState extends ConsumerState<_ConvertSheet> {
  late final name = TextEditingController(text: widget.lead.name);
  late final phone = TextEditingController(text: widget.lead.phone ?? '');
  late final area = TextEditingController(text: widget.lead.area ?? '');
  late final address = TextEditingController(text: widget.lead.address ?? '');
  late final qty = TextEditingController(text: trimZero(widget.lead.quantity));
  String schedule = 'daily';
  bool busy = false;

  @override
  void dispose() {
    for (final c in [name, phone, area, address, qty]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => busy = true);
    try {
      final id = await ref.read(leadsRepositoryProvider).convert(widget.lead, {
        'name': name.text.trim(), 'phone': phone.text.trim(), 'area': area.text.trim(), 'address': address.text.trim(),
        'default_qty': qty.text.isEmpty ? null : qty.text, 'schedule': schedule,
      });
      if (mounted) Navigator.pop(context, id);
    } catch (e) {
      if (!mounted) return;
      showError(context, ref, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    Widget field(TextEditingController c, String label, {TextInputType? type}) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: TextField(controller: c, keyboardType: type, decoration: InputDecoration(labelText: label)),
        );
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr.t('leads.convertTitle'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(tr.t('leads.convertHint'), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 16),
          field(name, tr.t('customers.name')),
          field(phone, tr.t('common.phone'), type: TextInputType.phone),
          field(area, tr.t('customers.area')),
          field(address, tr.t('customers.address')),
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: TextField(
              controller: qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [DecimalInputFormatter()],
              decoration: InputDecoration(labelText: tr.t('customers.defaultQty')),
            ),
          ),
          Wrap(spacing: 8, children: [
            for (final s in ['daily', 'alternate', 'weekly', 'on_demand'])
              ChoiceChip(label: Text(tr.t('customers.sched.$s')), selected: schedule == s, onSelected: (_) => setState(() => schedule = s)),
          ]),
          const SizedBox(height: 16),
          FilledButton(onPressed: busy || name.text.trim().isEmpty ? null : _submit, child: Text(tr.t('leads.convert'))),
        ]),
      ),
    );
  }
}
