import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/inputs.dart';
import '../../shared/widgets.dart';
import 'milk_repository.dart';

class _Cell {
  _Cell(String m, String e)
      : morning = TextEditingController(text: m),
        evening = TextEditingController(text: e),
        seedMorning = m,
        seedEvening = e;

  final TextEditingController morning;
  final TextEditingController evening;
  final morningFocus = FocusNode();
  final eveningFocus = FocusNode();
  // The server value each field was last filled from; differs from the text once edited.
  String seedMorning;
  String seedEvening;

  bool get dirty => morning.text != seedMorning || evening.text != seedEvening;

  void dispose() {
    morning.dispose();
    evening.dispose();
    morningFocus.dispose();
    eveningFocus.dispose();
  }
}

/// Quick per-cow morning/evening entry for one day: the most used screen.
class MilkSheetScreen extends ConsumerStatefulWidget {
  const MilkSheetScreen({super.key});

  @override
  ConsumerState<MilkSheetScreen> createState() => _MilkSheetScreenState();
}

class _MilkSheetScreenState extends ConsumerState<MilkSheetScreen> {
  String day = today();
  final cells = <int, _Cell>{};
  bool saving = false;

  @override
  void dispose() {
    for (final c in cells.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _setDay(String d) {
    if (cells.values.any((c) => c.dirty)) {
      _confirmDiscard().then((ok) {
        if (ok) _switchDay(d);
      });
    } else {
      _switchDay(d);
    }
  }

  void _switchDay(String d) => setState(() {
        for (final c in cells.values) {
          c.dispose();
        }
        cells.clear();
        day = d;
      });

  Future<bool> _confirmDiscard() async {
    final tr = ref.read(trProvider);
    return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(tr.t('milk.unsaved')),
            content: Text(tr.t('m.discardChanges', fallback: 'Discard the numbers you have not saved?')),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(tr.t('common.cancel'))),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(tr.t('m.discard', fallback: 'Discard'))),
            ],
          ),
        ) ??
        false;
  }

  /// Fills fields from the server without touching ones the user has edited.
  void _seed(MilkSheet s) {
    for (final r in s.rows) {
      final m = trimZero(r.morning), e = trimZero(r.evening);
      final c = cells[r.animalId];
      if (c == null) {
        cells[r.animalId] = _Cell(m, e);
        continue;
      }
      if (c.morning.text == c.seedMorning && m != c.seedMorning) c.morning.text = m;
      if (c.evening.text == c.seedEvening && e != c.seedEvening) c.evening.text = e;
      if (c.morning.text == m) c.seedMorning = m;
      if (c.evening.text == e) c.seedEvening = e;
    }
  }

  Future<void> _save(MilkSheet s) async {
    setState(() => saving = true);
    try {
      final rows = [
        for (final r in s.rows) MilkEntry(r.animalId, morning: cells[r.animalId]!.morning.text, evening: cells[r.animalId]!.evening.text, other: r.other),
      ];
      final result = await ref.read(milkRepositoryProvider).saveSheet(day, rows);
      for (final c in cells.values) {
        c.seedMorning = c.morning.text;
        c.seedEvening = c.evening.text;
      }
      if (!mounted) return;
      FocusScope.of(context).unfocus();
      showWriteResult(context, ref, result, ref.read(trProvider).t('milk.saved'));
      ref.invalidate(milkSheetProvider(day));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final canRecord = ref.watch(authProvider.select((s) => s.can('milk.record')));
    final sheet = ref.watch(milkSheetProvider(day));
    final data = sheet.value?.data;
    if (data != null && data.date == day) _seed(data);
    final editable = canRecord && day.compareTo(today()) <= 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(tr.t('nav.milk')),
        actions: [
          if (canRecord)
            IconButton(
              tooltip: tr.t('milk.useOrSpoil'),
              icon: const Icon(Icons.water_drop_outlined),
              onPressed: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => MilkOutSheet(day: day)),
            ),
        ],
      ),
      body: Column(children: [
        DayBar(day: day, maxDay: today(), onChanged: _setDay),
        Expanded(
          child: AsyncBody<MilkSheet>(
            value: sheet,
            onRetry: () => ref.invalidate(milkSheetProvider(day)),
            builder: (context, s, meta) => RefreshIndicator(
              onRefresh: () => ref.refresh(milkSheetProvider(day).future),
              child: ListView(
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  StaleNote(meta),
                  _Summary(s.summary),
                  if (s.rows.isEmpty)
                    EmptyState(icon: Icons.pets_outlined, title: tr.t('milk.noCows'), hint: tr.t('milk.noCowsHint'))
                  else ...[
                    _header(context, tr.t('milk.cow'), tr.t('milk.morning'), tr.t('milk.evening'), tr.t('common.total')),
                    for (var i = 0; i < s.rows.length; i++) _row(context, s, i, editable, fmt),
                  ],
                ],
              ),
            ),
          ),
        ),
      ]),
      bottomNavigationBar: data == null || data.rows.isEmpty || !editable ? null : _saveBar(context, data, fmt),
    );
  }

  Widget _header(BuildContext context, String a, String b, String c, String d) {
    final style = TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurfaceVariant);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
      child: Row(children: [
        Expanded(child: Text(a, style: style)),
        SizedBox(width: 84, child: Text(b, style: style, textAlign: TextAlign.center)),
        const SizedBox(width: 8),
        SizedBox(width: 84, child: Text(c, style: style, textAlign: TextAlign.center)),
        SizedBox(width: 56, child: Text(d, style: style, textAlign: TextAlign.right)),
      ]),
    );
  }

  Widget _row(BuildContext context, MilkSheet s, int i, bool editable, Fmt fmt) {
    final r = s.rows[i];
    final c = cells[r.animalId]!;
    final next = i + 1 < s.rows.length ? cells[s.rows[i + 1].animalId] : null;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    Widget field(TextEditingController ctl, FocusNode focus, FocusNode? nextFocus, String label) => SizedBox(
          width: 84,
          child: TextField(
            key: Key('milk-${r.animalId}-$label'),
            controller: ctl,
            focusNode: focus,
            enabled: editable,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [DecimalInputFormatter()],
            textInputAction: nextFocus == null ? TextInputAction.done : TextInputAction.next,
            // "Next" walks down the same column: morning milking is entered cow by cow.
            onSubmitted: (_) => nextFocus?.requestFocus(),
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(hintText: '0', semanticCounterText: '${r.tag} $label', contentPadding: const EdgeInsets.symmetric(vertical: 12)),
          ),
        );

    final rowTotal = Fmt.parse(c.morning.text) + Fmt.parse(c.evening.text) + Fmt.parse(r.other);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: c.dirty ? Brand.accent : Theme.of(context).dividerColor),
      ),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.name?.isNotEmpty == true ? r.name! : r.tag, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            Text(r.tag, style: TextStyle(fontSize: 12, color: muted)),
          ]),
        ),
        field(c.morning, c.morningFocus, next?.morningFocus, 'morning'),
        const SizedBox(width: 8),
        field(c.evening, c.eveningFocus, next?.eveningFocus, 'evening'),
        SizedBox(
          width: 56,
          child: Text(rowTotal == 0 ? '—' : fmt.num(rowTotal, digits: 1), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      ]),
    );
  }

  Widget _saveBar(BuildContext context, MilkSheet s, Fmt fmt) {
    final tr = ref.tr;
    final dirty = cells.values.any((c) => c.dirty);
    final total = s.rows.fold<double>(0, (sum, r) {
      final c = cells[r.animalId];
      return sum + (c == null ? Fmt.parse(r.total) : Fmt.parse(c.morning.text) + Fmt.parse(c.evening.text) + Fmt.parse(r.other));
    });
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surface, border: Border(top: BorderSide(color: Theme.of(context).dividerColor))),
        child: Row(children: [
          Expanded(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(fmt.litres(total), style: const TextStyle(fontFamily: 'BalooDa2', fontSize: 22, fontWeight: FontWeight.w700)),
              Text(dirty ? tr.t('milk.unsaved') : tr.t('milk.allSaved'),
                  style: TextStyle(fontSize: 12, color: dirty ? Brand.warning : Theme.of(context).colorScheme.onSurfaceVariant)),
            ]),
          ),
          FilledButton.icon(
            key: const Key('milk-save'),
            onPressed: saving || !dirty ? null : () => _save(s),
            icon: saving ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_rounded),
            label: Text(tr.t('common.save')),
          ),
        ]),
      ),
    );
  }
}

class _Summary extends ConsumerWidget {
  const _Summary(this.s);

  final Map<String, dynamic> s;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final used = Fmt.parse(s['internal_use']) + Fmt.parse(s['spoilage']);
    Widget tile(String label, Object? v, {Color? tone, IconData? icon}) =>
        SizedBox(width: 150, child: StatTile(label: label, value: fmt.litres(v), tone: tone, icon: icon));
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        children: [
          tile(tr.t('milk.produced'), s['produced'], icon: Icons.water_drop_rounded),
          const SizedBox(width: 8),
          tile(tr.t('milk.delivered'), s['delivered'], icon: Icons.local_shipping_outlined),
          const SizedBox(width: 8),
          tile(tr.t('milk.internalSpoil'), used, icon: Icons.home_outlined),
          const SizedBox(width: 8),
          tile(tr.t('dashboard.milkStock'), s['stock'], tone: const Color(0xFF15803D), icon: Icons.inventory_2_outlined),
        ],
      ),
    );
  }
}

/// Household use / spoilage entry.
class MilkOutSheet extends ConsumerStatefulWidget {
  const MilkOutSheet({super.key, required this.day});

  final String day;

  @override
  ConsumerState<MilkOutSheet> createState() => _MilkOutSheetState();
}

class _MilkOutSheetState extends ConsumerState<MilkOutSheet> {
  String type = 'internal_use';
  final qty = TextEditingController();
  final notes = TextEditingController();
  bool busy = false;

  @override
  void dispose() {
    qty.dispose();
    notes.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (Fmt.parse(qty.text) <= 0) return;
    setState(() => busy = true);
    try {
      final r = await ref.read(milkRepositoryProvider).recordOut(date: widget.day, type: type, quantity: qty.text, notes: notes.text.trim().isEmpty ? null : notes.text.trim());
      if (!mounted) return;
      Navigator.pop(context);
      showWriteResult(context, ref, r, ref.read(trProvider).t('common.saved'));
      ref.invalidate(milkSheetProvider(widget.day));
    } catch (e) {
      if (mounted) showError(context, ref, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr.t('milk.useOrSpoil'), style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'internal_use', label: Text(tr.t('milk.internal'))),
            ButtonSegment(value: 'spoilage', label: Text(tr.t('milk.spoilage'))),
          ],
          selected: {type},
          onSelectionChanged: (s) => setState(() => type = s.first),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: qty,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [DecimalInputFormatter()],
          decoration: InputDecoration(labelText: '${tr.t('common.quantity')} (${tr.t('units.l')})'),
        ),
        const SizedBox(height: 12),
        TextField(controller: notes, decoration: InputDecoration(labelText: tr.t('common.notes'))),
        const SizedBox(height: 16),
        FilledButton(onPressed: busy ? null : _submit, child: Text(tr.t('common.save'))),
      ]),
    );
  }
}
