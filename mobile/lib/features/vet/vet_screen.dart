import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/format.dart';
import '../../core/offline/query_cache.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/contact.dart';
import '../../shared/forms.dart';
import '../../shared/inputs.dart';
import '../../shared/lookups.dart';
import '../../shared/widgets.dart';

/// `GET /treatments` or `/vaccinations` (paginated Present rows).
typedef VetQuery = ({String kind, String outcome, bool upcoming, int page});

final vetListProvider = StreamProvider.autoDispose.family<Cached<Map<String, dynamic>>, VetQuery>((ref, q) {
  ref.watch(syncEpochProvider);
  ref.watch(authProvider.select((s) => s.farmId));
  return ref.watch(queryCacheProvider).watch('/${q.kind}', (j) => Map<String, dynamic>.from(j as Map),
      query: {'outcome': q.outcome, 'upcoming': q.upcoming ? 1 : null, 'page': q.page, 'per_page': 30});
});

class VetScreen extends ConsumerStatefulWidget {
  const VetScreen({super.key});

  @override
  ConsumerState<VetScreen> createState() => _VetScreenState();
}

class _VetScreenState extends ConsumerState<VetScreen> with SingleTickerProviderStateMixin {
  late final tabs = TabController(length: 3, vsync: this);
  String outcome = '';
  final pages = [1, 1, 1];

  @override
  void dispose() {
    tabs.dispose();
    super.dispose();
  }

  Future<void> _open(Widget sheet) async {
    await showFormSheet<void>(context, sheet);
    if (mounted) ref.invalidate(vetListProvider);
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final auth = ref.watch(authProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(tr.t('nav.vet')),
        bottom: TabBar(controller: tabs, tabs: [
          Tab(text: tr.t('vet.treatments')),
          Tab(text: tr.t('vet.vaccinations')),
          Tab(text: tr.t('vet.upcoming')),
        ]),
      ),
      floatingActionButton: auth.can('vet.create')
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add),
              label: Text(tr.t('common.add')),
              onPressed: () async {
                final choice = await showModalBottomSheet<String>(
                  context: context,
                  builder: (ctx) => SafeArea(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      ListTile(leading: const Icon(Icons.healing_outlined), title: Text(tr.t('vet.addTreatment')), onTap: () => Navigator.pop(ctx, 't')),
                      ListTile(leading: const Icon(Icons.vaccines_outlined), title: Text(tr.t('vet.addVaccination')), onTap: () => Navigator.pop(ctx, 'v')),
                    ]),
                  ),
                );
                if (choice == 't') await _open(const TreatmentSheet());
                if (choice == 'v') await _open(const VaccinationSheet());
              },
            )
          : null,
      body: TabBarView(controller: tabs, children: [
        Column(children: [
          FilterChips<String>(
            value: outcome,
            options: [
              ('', tr.t('vet.allOutcomes')),
              for (final o in ['ongoing', 'recovered', 'referred', 'died']) (o, tr.t('status.$o')),
            ],
            onChanged: (v) => setState(() {
              outcome = v;
              pages[0] = 1;
            }),
          ),
          Expanded(child: _list((kind: 'treatments', outcome: outcome, upcoming: false, page: pages[0]), 0, auth.can('vet.update'))),
        ]),
        _list((kind: 'vaccinations', outcome: '', upcoming: false, page: pages[1]), 1, auth.can('vet.update')),
        _list((kind: 'vaccinations', outcome: '', upcoming: true, page: pages[2]), 2, auth.can('vet.update')),
      ]),
    );
  }

  Widget _list(VetQuery q, int tab, bool canEdit) {
    final tr = ref.tr;
    final value = ref.watch(vetListProvider(q));
    return AsyncBody<Map<String, dynamic>>(
      value: value,
      onRetry: () => ref.invalidate(vetListProvider(q)),
      builder: (context, d, meta) {
        final rows = [for (final r in d['data'] as List) Map<String, dynamic>.from(r as Map)];
        final last = (d['meta'] as Map?)?['last_page'] as int? ?? 1;
        return RefreshIndicator(
          onRefresh: () => ref.refresh(vetListProvider(q).future),
          child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            StaleNote(meta),
            if (rows.isEmpty) EmptyState(icon: Icons.medical_services_outlined, title: q.kind == 'treatments' ? tr.t('vet.empty') : tr.t('common.noData')),
            for (final r in rows)
              q.kind == 'treatments'
                  ? _TreatmentCard(r, onTap: canEdit ? () => _open(TreatmentSheet(record: r)) : null)
                  : _VaccinationCard(r, onTap: canEdit ? () => _open(VaccinationSheet(record: r)) : null),
            if (last > 1) Pager(page: q.page, last: last, onChanged: (p) => setState(() => pages[tab] = p)),
          ]),
        );
      },
    );
  }
}

class _TreatmentCard extends ConsumerWidget {
  const _TreatmentCard(this.t, {this.onTap});

  final Map<String, dynamic> t;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final meds = [for (final m in t['medications'] as List? ?? const []) Map<String, dynamic>.from(m as Map)];
    final followUp = t['follow_up_date'] as String?;
    final dueSoon = followUp != null && t['outcome'] == 'ongoing' && followUp.compareTo(shiftDate(today(), 2)) <= 0;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text('${t['subject'] ?? '—'}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
              StatusPill('${t['outcome']}', label: tr.t('status.${t['outcome']}')),
            ]),
            if ((t['diagnosis'] ?? '').toString().isNotEmpty) Text('${t['diagnosis']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            if ((t['symptoms'] ?? '').toString().isNotEmpty) Text('${t['symptoms']}', style: TextStyle(color: muted)),
            if (meds.isNotEmpty) ...[
              const SizedBox(height: 4),
              for (final m in meds)
                Text('• ${[m['name'], m['dosage'], m['frequency'], m['duration']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ')}', style: const TextStyle(fontSize: 13)),
            ],
            const SizedBox(height: 6),
            Wrap(spacing: 12, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(fmt.date(t['date'] as String?), style: TextStyle(color: muted, fontSize: 13)),
              if ((t['vet_name'] ?? '').toString().isNotEmpty) Text('${t['vet_name']}', style: TextStyle(color: muted, fontSize: 13)),
              if (Fmt.parse(t['cost']) > 0) Text(fmt.money(t['cost']), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              if (followUp != null)
                Text('${tr.t('vet.followUp')}: ${fmt.date(followUp, year: false)}',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: dueSoon ? Brand.danger : muted)),
              if ((t['vet_contact'] ?? '').toString().contains(RegExp(r'\d{6,}')))
                InkWell(onTap: () => callPhone('${t['vet_contact']}'), child: const Icon(Icons.call_outlined, size: 20)),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _VaccinationCard extends ConsumerWidget {
  const _VaccinationCard(this.v, {this.onTap});

  final Map<String, dynamic> v;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final next = v['next_due_date'] as String?;
    final overdue = next != null && next.compareTo(today()) < 0;
    final soon = next != null && !overdue && next.compareTo(shiftDate(today(), 7)) <= 0;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: CircleAvatar(backgroundColor: Brand.primarySoft, foregroundColor: Brand.primary, child: const Icon(Icons.vaccines_outlined)),
        title: Text('${v['vaccine']}', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text([
          '${v['subject'] ?? '—'}',
          fmt.date(v['date'] as String?),
          if ((v['dose'] ?? '').toString().isNotEmpty) '${v['dose']}',
        ].join(' · ')),
        trailing: next == null
            ? null
            : Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(tr.t('vet.next'), style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                Text(fmt.date(next, year: false),
                    style: TextStyle(fontWeight: FontWeight.w700, color: overdue ? Brand.danger : soon ? Brand.warning : null)),
              ]),
      ),
    );
  }
}

class _MedLine {
  _MedLine([Map<String, dynamic>? m])
      : name = TextEditingController(text: '${m?['name'] ?? ''}'),
        dosage = TextEditingController(text: '${m?['dosage'] ?? ''}'),
        frequency = TextEditingController(text: '${m?['frequency'] ?? ''}'),
        duration = TextEditingController(text: '${m?['duration'] ?? ''}');

  final TextEditingController name;
  final TextEditingController dosage;
  final TextEditingController frequency;
  final TextEditingController duration;

  Map<String, dynamic>? toJson() {
    String? v(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    return name.text.trim().isEmpty ? null : {'name': name.text.trim(), 'dosage': v(dosage), 'frequency': v(frequency), 'duration': v(duration)};
  }

  void dispose() {
    for (final c in [name, dosage, frequency, duration]) {
      c.dispose();
    }
  }
}

Subject? _subjectOf(Map<String, dynamic>? r) => r == null
    ? null
    : r['animal_id'] != null
        ? Subject('animal', r['animal_id'] as int)
        : r['flock_id'] != null
            ? Subject('flock', r['flock_id'] as int)
            : null;

Map<String, dynamic> _subjectBody(Subject? s) => {'animal_id': s?.type == 'animal' ? s!.id : null, 'flock_id': s?.type == 'flock' ? s!.id : null};

/// New or edited treatment. The app records what the vet prescribed; it never suggests medication.
class TreatmentSheet extends ConsumerStatefulWidget {
  const TreatmentSheet({super.key, this.record});

  final Map<String, dynamic>? record;

  @override
  ConsumerState<TreatmentSheet> createState() => _TreatmentSheetState();
}

class _TreatmentSheetState extends ConsumerState<TreatmentSheet> {
  late final r = widget.record ?? const {};
  late Subject? subject = _subjectOf(widget.record);
  late String date = (r['date'] as String?) ?? today();
  late String? followUp = r['follow_up_date'] as String?;
  late String outcome = (r['outcome'] as String?) ?? 'ongoing';
  late final symptoms = TextEditingController(text: '${r['symptoms'] ?? ''}');
  late final diagnosis = TextEditingController(text: '${r['diagnosis'] ?? ''}');
  late final vet = TextEditingController(text: '${r['vet_name'] ?? ''}');
  late final contact = TextEditingController(text: '${r['vet_contact'] ?? ''}');
  late final cost = TextEditingController(text: trimZero('${r['cost'] ?? ''}'));
  late final notes = TextEditingController(text: '${r['notes'] ?? ''}');
  late final meds = [for (final m in r['medications'] as List? ?? const []) _MedLine(Map<String, dynamic>.from(m as Map))];
  String method = 'cash';
  bool paidNow = true;

  @override
  void dispose() {
    for (final c in [symptoms, diagnosis, vet, contact, cost, notes]) {
      c.dispose();
    }
    for (final m in meds) {
      m.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final editing = widget.record != null;
    String? text(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    return FormSheet(
      title: editing ? tr.t('vet.editTreatment') : tr.t('vet.addTreatment'),
      hint: tr.t('vet.subtitle'),
      canSubmit: subject != null,
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send(editing ? 'PUT' : 'POST', editing ? '/treatments/${widget.record!['id']}' : '/treatments',
            label: 'treatment', body: {
          ..._subjectBody(subject),
          'date': date, 'symptoms': text(symptoms), 'diagnosis': text(diagnosis), 'vet_name': text(vet), 'vet_contact': text(contact),
          'medications': [for (final m in meds) ?m.toJson()],
          'cost': text(cost), 'follow_up_date': followUp, 'outcome': outcome, 'notes': text(notes),
          if (!editing && Fmt.parse(cost.text) > 0 && paidNow) 'paid_method': method,
        });
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('common.saved'));
      },
      children: [
        PickerInput<Subject>(label: tr.t('vet.subject'), options: ref.watch(subjectOptionsProvider), value: subject, onChanged: (v) => setState(() => subject = v)),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
        TextInput(symptoms, tr.t('vet.symptoms'), maxLines: 2),
        TextInput(diagnosis, tr.t('vet.diagnosis')),
        Row(children: [
          Expanded(child: TextInput(vet, tr.t('vet.vet'))),
          const SizedBox(width: 8),
          Expanded(child: TextInput(contact, tr.t('vet.contact'), keyboard: TextInputType.phone)),
        ]),
        Text(tr.t('vet.prescribed'), style: const TextStyle(fontWeight: FontWeight.w700)),
        for (final (n, m) in meds.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(children: [
                Row(children: [
                  Expanded(child: TextInput(m.name, tr.t('vet.med.name'))),
                  IconButton(onPressed: () => setState(() => meds.removeAt(n).dispose()), icon: const Icon(Icons.close)),
                ]),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: TextInput(m.dosage, tr.t('vet.med.dosage'))),
                  const SizedBox(width: 6),
                  Expanded(child: TextInput(m.frequency, tr.t('vet.med.frequency'))),
                  const SizedBox(width: 6),
                  Expanded(child: TextInput(m.duration, tr.t('vet.med.duration'))),
                ]),
              ]),
            ),
          ),
        OutlinedButton.icon(onPressed: () => setState(() => meds.add(_MedLine())), icon: const Icon(Icons.add), label: Text(tr.t('vet.addMed'))),
        SegmentedButton<String>(
          segments: [for (final o in ['ongoing', 'recovered', 'referred', 'died']) ButtonSegment(value: o, label: Text(tr.t('status.$o')))],
          selected: {outcome},
          onSelectionChanged: (s) => setState(() => outcome = s.first),
        ),
        DateInput(label: tr.t('vet.followUp'), value: followUp, allowFuture: true, optional: true, onChanged: (v) => setState(() => followUp = v)),
        NumberInput(cost, tr.t('vet.cost'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {})),
        if (!editing && Fmt.parse(cost.text) > 0) ...[
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(paidNow ? tr.t('bills.paidNow') : tr.t('bills.notPaid')),
            value: paidNow,
            onChanged: (v) => setState(() => paidNow = v),
          ),
          if (paidNow) MethodChips(value: method, onChanged: (m) => setState(() => method = m)),
        ],
        Text(tr.t('vet.costHint'), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        TextInput(notes, tr.t('common.notes'), maxLines: 2),
      ],
    );
  }
}

class VaccinationSheet extends ConsumerStatefulWidget {
  const VaccinationSheet({super.key, this.record});

  final Map<String, dynamic>? record;

  @override
  ConsumerState<VaccinationSheet> createState() => _VaccinationSheetState();
}

class _VaccinationSheetState extends ConsumerState<VaccinationSheet> {
  late final r = widget.record ?? const {};
  late Subject? subject = _subjectOf(widget.record);
  late String date = (r['date'] as String?) ?? today();
  late String? nextDue = r['next_due_date'] as String?;
  late final vaccine = TextEditingController(text: '${r['vaccine'] ?? ''}');
  late final dose = TextEditingController(text: '${r['dose'] ?? ''}');
  late final vet = TextEditingController(text: '${r['vet_name'] ?? ''}');
  late final cost = TextEditingController(text: trimZero('${r['cost'] ?? ''}'));
  late final notes = TextEditingController(text: '${r['notes'] ?? ''}');
  String method = 'cash';
  bool paidNow = true;

  @override
  void dispose() {
    for (final c in [vaccine, dose, vet, cost, notes]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    final editing = widget.record != null;
    String? text(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    return FormSheet(
      title: editing ? tr.t('vet.editVaccination') : tr.t('vet.addVaccination'),
      canSubmit: subject != null && vaccine.text.trim().isNotEmpty,
      onSubmit: () async {
        final r = await ref.read(outboxProvider).send(editing ? 'PUT' : 'POST', editing ? '/vaccinations/${widget.record!['id']}' : '/vaccinations',
            label: 'vaccination', body: {
          ..._subjectBody(subject),
          'vaccine': vaccine.text.trim(), 'date': date, 'next_due_date': nextDue, 'dose': text(dose), 'vet_name': text(vet),
          'cost': text(cost), 'notes': text(notes),
          if (!editing && Fmt.parse(cost.text) > 0 && paidNow) 'paid_method': method,
        });
        if (!context.mounted) return;
        Navigator.pop(context);
        showWriteResult(context, ref, r, tr.t('common.saved'));
      },
      children: [
        PickerInput<Subject>(label: tr.t('vet.subject'), options: ref.watch(subjectOptionsProvider), value: subject, onChanged: (v) => setState(() => subject = v)),
        TextInput(vaccine, tr.t('vet.vaccine'), onChanged: (_) => setState(() {})),
        DateInput(label: tr.t('common.date'), value: date, onChanged: (v) => setState(() => date = v ?? today())),
        DateInput(label: tr.t('vet.next'), value: nextDue, allowFuture: true, optional: true, onChanged: (v) => setState(() => nextDue = v)),
        Row(children: [
          Expanded(child: TextInput(dose, tr.t('vet.dose'))),
          const SizedBox(width: 8),
          Expanded(child: TextInput(vet, tr.t('vet.vet'))),
        ]),
        NumberInput(cost, tr.t('common.cost'), decimals: 2, prefix: '৳ ', onChanged: (_) => setState(() {})),
        if (!editing && Fmt.parse(cost.text) > 0) ...[
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(paidNow ? tr.t('bills.paidNow') : tr.t('bills.notPaid')),
            value: paidNow,
            onChanged: (v) => setState(() => paidNow = v),
          ),
          if (paidNow) MethodChips(value: method, onChanged: (m) => setState(() => method = m)),
        ],
        TextInput(notes, tr.t('common.notes'), maxLines: 2),
      ],
    );
  }
}
