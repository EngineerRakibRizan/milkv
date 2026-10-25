import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/contact.dart';
import '../../shared/inputs.dart';
import '../../shared/widgets.dart';
import 'deliveries_repository.dart';

/// A day's delivery route with one-tap "Delivered".
class DeliveriesScreen extends ConsumerStatefulWidget {
  const DeliveriesScreen({super.key});

  @override
  ConsumerState<DeliveriesScreen> createState() => _DeliveriesScreenState();
}

class _DeliveriesScreenState extends ConsumerState<DeliveriesScreen> {
  String day = today();
  String filter = 'open';
  final busy = <int>{};

  Future<void> _mark(Delivery d, {required String status, String? delivered, String? collected, String method = 'cash'}) async {
    setState(() => busy.add(d.id));
    try {
      final r = await ref.read(deliveriesRepositoryProvider).update(d, status: status, delivered: delivered, collected: collected, method: method);
      if (!mounted) return;
      showWriteResult(context, ref, r, '${d.customerName} — ${ref.read(trProvider).t('status.$status')}');
      ref.invalidate(deliveryDayProvider(day));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    } finally {
      if (mounted) setState(() => busy.remove(d.id));
    }
  }

  Future<void> _generate() async {
    try {
      final n = await ref.read(deliveriesRepositoryProvider).generate(day);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${ref.read(trProvider).t('deliveries.generate')}: ${ref.read(fmtProvider).num(n, digits: 0)}')));
      ref.invalidate(deliveryDayProvider(day));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final auth = ref.watch(authProvider);
    final value = ref.watch(deliveryDayProvider(day));

    return Scaffold(
      appBar: AppBar(
        title: Text(tr.t('nav.deliveries')),
        actions: [
          if (auth.can('deliveries.create'))
            IconButton(tooltip: tr.t('deliveries.generate'), icon: const Icon(Icons.playlist_add_rounded), onPressed: _generate),
        ],
      ),
      body: Column(children: [
        DayBar(day: day, onChanged: (d) => setState(() => day = d)),
        Expanded(
          child: AsyncBody<DeliveryDay>(
            value: value,
            onRetry: () => ref.invalidate(deliveryDayProvider(day)),
            builder: (context, data, meta) {
              final open = data.items.where((d) => d.open).toList();
              final shown = switch (filter) {
                'open' => open,
                'done' => data.items.where((d) => d.done).toList(),
                _ => data.items,
              };
              return RefreshIndicator(
                onRefresh: () => ref.refresh(deliveryDayProvider(day).future),
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 24),
                  children: [
                    StaleNote(meta),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                      child: Row(children: [
                        Expanded(child: StatTile(label: tr.t('deliveries.ordered'), value: fmt.litres(data.summary['ordered']))),
                        const SizedBox(width: 8),
                        Expanded(child: StatTile(label: tr.t('milk.delivered'), value: fmt.litres(data.summary['delivered']), tone: const Color(0xFF15803D))),
                        const SizedBox(width: 8),
                        Expanded(child: StatTile(label: tr.t('deliveries.sales'), value: fmt.money(data.summary['amount']))),
                      ]),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      child: Wrap(spacing: 8, children: [
                        for (final f in [('open', '${tr.t('deliveries.open')} (${fmt.num(open.length, digits: 0)})'), ('done', tr.t('deliveries.done')), ('all', tr.t('common.all'))])
                          ChoiceChip(label: Text(f.$2), selected: filter == f.$1, onSelected: (_) => setState(() => filter = f.$1)),
                      ]),
                    ),
                    if (data.items.isEmpty)
                      EmptyState(
                        icon: Icons.local_shipping_outlined,
                        title: tr.t('deliveries.empty'),
                        hint: auth.can('deliveries.create') ? tr.t('deliveries.emptyHint') : null,
                        action: auth.can('deliveries.create') ? FilledButton.icon(onPressed: _generate, icon: const Icon(Icons.playlist_add_rounded), label: Text(tr.t('deliveries.generate'))) : null,
                      )
                    else if (shown.isEmpty)
                      EmptyState(icon: Icons.task_alt_rounded, title: tr.t('m.allDelivered', fallback: 'All delivered for this day'))
                    else
                      ..._grouped(shown, auth.can('deliveries.update'), fmt),
                  ],
                ),
              );
            },
          ),
        ),
      ]),
    );
  }

  /// Grouped by area, in the server's route order.
  List<Widget> _grouped(List<Delivery> items, bool canUpdate, Fmt fmt) {
    final out = <Widget>[];
    String? area;
    for (final d in items) {
      final a = d.area ?? '';
      if (a != area) {
        area = a;
        if (a.isNotEmpty) {
          out.add(Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
            child: Text(a, style: TextStyle(fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.primary)),
          ));
        }
      }
      out.add(_DeliveryCard(
        d: d,
        busy: busy.contains(d.id),
        canUpdate: canUpdate,
        onDelivered: () => _mark(d, status: 'delivered', delivered: d.ordered),
        onMore: () => _openActions(d),
      ));
    }
    return out;
  }

  Future<void> _openActions(Delivery d) async {
    final result = await showModalBottomSheet<_Action>(context: context, isScrollControlled: true, builder: (_) => _DeliveryActions(d));
    if (result != null) await _mark(d, status: result.status, delivered: result.delivered, collected: result.collected, method: result.method);
  }
}

class _DeliveryCard extends ConsumerWidget {
  const _DeliveryCard({required this.d, required this.busy, required this.canUpdate, required this.onDelivered, required this.onMore});

  final Delivery d;
  final bool busy;
  final bool canUpdate;
  final VoidCallback onDelivered;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final due = Fmt.parse(d.balance);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: canUpdate ? onMore : null,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(d.customerName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
                  const SizedBox(width: 8),
                  StatusPill(d.status),
                ]),
                const SizedBox(height: 2),
                if ((d.address ?? '').isNotEmpty) Text(d.address!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 13)),
                const SizedBox(height: 4),
                Text.rich(TextSpan(children: [
                  TextSpan(text: fmt.litres(d.done ? d.delivered : d.ordered), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  TextSpan(text: '  ×  ${fmt.money(d.unitPrice)}', style: TextStyle(color: muted)),
                  if (due > 0) TextSpan(text: '   ${tr.t('customers.outstanding')} ${fmt.money(due)}', style: const TextStyle(color: Brand.danger, fontSize: 13)),
                ])),
              ]),
            ),
            if (d.phone?.isNotEmpty == true)
              IconButton(tooltip: tr.t('common.phone'), onPressed: () => callPhone(d.phone!), icon: const Icon(Icons.call_outlined)),
            if (canUpdate && d.open)
              busy
                  ? const Padding(padding: EdgeInsets.all(14), child: SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.5)))
                  : FilledButton(
                      key: Key('deliver-${d.id}'),
                      onPressed: onDelivered,
                      style: FilledButton.styleFrom(minimumSize: const Size(56, 52), padding: const EdgeInsets.symmetric(horizontal: 14)),
                      child: const Icon(Icons.check_rounded, size: 28),
                    ),
          ]),
        ),
      ),
    );
  }
}

class _Action {
  _Action(this.status, {this.delivered, this.collected, this.method = 'cash'});

  final String status;
  final String? delivered;
  final String? collected;
  final String method;
}

/// Partial quantity, cash collected on the doorstep, cancel.
class _DeliveryActions extends ConsumerStatefulWidget {
  const _DeliveryActions(this.d);

  final Delivery d;

  @override
  ConsumerState<_DeliveryActions> createState() => _DeliveryActionsState();
}

class _DeliveryActionsState extends ConsumerState<_DeliveryActions> {
  late final qty = TextEditingController(text: trimZero(widget.d.done ? widget.d.delivered : widget.d.ordered));
  final collected = TextEditingController();
  String method = 'cash';

  @override
  void dispose() {
    qty.dispose();
    collected.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final d = widget.d;
    final partial = Fmt.parse(qty.text) < Fmt.parse(d.ordered);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(d.customerName, style: Theme.of(context).textTheme.titleLarge),
          if (d.phone?.isNotEmpty == true)
            Row(children: [
              TextButton.icon(onPressed: () => callPhone(d.phone!), icon: const Icon(Icons.call_outlined), label: Text(d.phone!)),
              TextButton.icon(onPressed: () => openWhatsApp(d.phone!), icon: const Icon(Icons.chat_outlined), label: const Text('WhatsApp')),
            ]),
          const SizedBox(height: 8),
          if (d.open) ...[
            TextField(
              controller: qty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [DecimalInputFormatter()],
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: '${tr.t('deliveries.deliveredQty')} (${tr.t('units.l')})'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: collected,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [DecimalInputFormatter(decimals: 2)],
              decoration: InputDecoration(labelText: '${tr.t('deliveries.collected')} (৳)'),
            ),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final m in ['cash', 'bkash', 'nagad', 'rocket'])
                ChoiceChip(label: Text(tr.t('method.$m')), selected: method == m, onSelected: (_) => setState(() => method = m)),
            ]),
            const SizedBox(height: 8),
            Text(tr.t('deliveries.postHint'), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: Fmt.parse(qty.text) <= 0
                  ? null
                  : () => Navigator.pop(context, _Action(partial ? 'partial' : 'delivered', delivered: qty.text, collected: collected.text, method: method)),
              icon: const Icon(Icons.check_rounded),
              label: Text(partial ? tr.t('status.partial') : tr.t('deliveries.markDelivered')),
            ),
            const SizedBox(height: 8),
            Row(children: [
              if (d.status == 'pending')
                Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context, _Action('out_for_delivery')), child: Text(tr.t('status.out_for_delivery')))),
              if (d.status == 'pending') const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                  onPressed: () => Navigator.pop(context, _Action('cancelled')),
                  child: Text(tr.t('status.cancelled')),
                ),
              ),
            ]),
          ] else
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(children: [StatusPill(d.status), const SizedBox(width: 8), Text(ref.watch(fmtProvider).money(d.amount))]),
            ),
        ]),
      ),
    );
  }
}
