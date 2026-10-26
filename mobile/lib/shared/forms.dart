import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_client.dart';
import '../core/i18n/format.dart';
import '../core/providers.dart';
import '../core/theme.dart';
import 'inputs.dart';
import 'widgets.dart';

/// A bottom-sheet form: title, fields, one submit button. [onSubmit] returns
/// normally on success (the sheet closes) or throws; server validation errors
/// are shown under the button.
class FormSheet extends ConsumerStatefulWidget {
  const FormSheet({super.key, required this.title, required this.children, required this.onSubmit, this.submitLabel, this.hint, this.canSubmit = true});

  final String title;
  final String? hint;
  final List<Widget> children;
  final Future<void> Function() onSubmit;
  final String? submitLabel;
  final bool canSubmit;

  @override
  ConsumerState<FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends ConsumerState<FormSheet> {
  bool busy = false;
  String? error;

  Future<void> _submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.onSubmit();
    } catch (e) {
      final err = ApiError.from(e);
      final tr = ref.read(trProvider);
      if (mounted) {
        setState(() => error = err.offline
            ? tr.t('m.needsOnline')
            : {err.message, ...err.errors.values.expand((v) => v)}.join('\n'));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tr = ref.tr;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(widget.title, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            if (widget.hint != null) ...[
              const SizedBox(height: 4),
              Text(widget.hint!, style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ],
            const SizedBox(height: 16),
            for (final c in widget.children) Padding(padding: const EdgeInsets.only(bottom: 12), child: c),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(error!, key: const Key('form-error'), style: const TextStyle(color: Brand.danger)),
              ),
            FilledButton(
              key: const Key('form-submit'),
              onPressed: busy || !widget.canSubmit ? null : _submit,
              child: busy
                  ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : Text(widget.submitLabel ?? tr.t('common.save')),
            ),
          ]),
        ),
      ),
    );
  }
}

Future<T?> showFormSheet<T>(BuildContext context, Widget sheet) =>
    showModalBottomSheet<T>(context: context, isScrollControlled: true, useSafeArea: true, builder: (_) => sheet);

/// Plain text input with a label.
class TextInput extends StatelessWidget {
  const TextInput(this.controller, this.label, {super.key, this.keyboard, this.maxLines = 1, this.onChanged});

  final TextEditingController controller;
  final String label;
  final TextInputType? keyboard;
  final int maxLines;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) =>
      TextField(controller: controller, keyboardType: keyboard, maxLines: maxLines, onChanged: onChanged, decoration: InputDecoration(labelText: label));
}

/// Decimal input (money or quantity) that accepts Bangla digits.
class NumberInput extends StatelessWidget {
  const NumberInput(this.controller, this.label, {super.key, this.decimals = 3, this.prefix, this.suffix, this.onChanged});

  final TextEditingController controller;
  final String label;
  final int decimals;
  final String? prefix;
  final String? suffix;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [DecimalInputFormatter(decimals: decimals)],
        onChanged: onChanged,
        decoration: InputDecoration(labelText: label, prefixText: prefix, suffixText: suffix),
      );
}

/// A date the API understands (YYYY-MM-DD), picked from a calendar.
class DateInput extends ConsumerWidget {
  const DateInput({super.key, required this.label, required this.value, required this.onChanged, this.allowFuture = false, this.optional = false});

  final String label;
  final String? value;
  final ValueChanged<String?> onChanged;
  final bool allowFuture;
  final bool optional;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = ref.watch(fmtProvider);
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: value == null ? now : DateTime.parse(value!),
          firstDate: DateTime(2015),
          lastDate: allowFuture ? DateTime(now.year + 5) : now,
        );
        if (picked != null) onChanged(isoDate(picked));
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: optional && value != null
              ? IconButton(icon: const Icon(Icons.clear), onPressed: () => onChanged(null))
              : const Icon(Icons.calendar_today_outlined, size: 20),
        ),
        child: Text(value == null ? '—' : fmt.date(value)),
      ),
    );
  }
}

class PickOption<T> {
  const PickOption(this.value, this.label, {this.subtitle});

  final T value;
  final String label;
  final String? subtitle;
}

/// A field that opens a searchable list to choose one option.
class PickerInput<T> extends ConsumerWidget {
  const PickerInput({super.key, required this.label, required this.options, required this.value, required this.onChanged, this.allowNone = false, this.noneLabel});

  final String label;
  final List<PickOption<T>> options;
  final T? value;
  final ValueChanged<T?> onChanged;
  final bool allowNone;
  final String? noneLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = options.where((o) => o.value == value).firstOrNull;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () async {
        final picked = await showModalBottomSheet<_Picked<T>>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          builder: (_) => _PickerSheet<T>(title: label, options: options, noneLabel: allowNone ? (noneLabel ?? '—') : null),
        );
        if (picked != null) onChanged(picked.value);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.expand_more)),
        child: Text(selected?.label ?? (noneLabel ?? '—'), maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}

/// What the picker sheet returns; a null [value] means "none" was chosen.
class _Picked<T> {
  const _Picked(this.value);
  final T? value;
}

class _PickerSheet<T> extends ConsumerStatefulWidget {
  const _PickerSheet({required this.title, required this.options, this.noneLabel});

  final String title;
  final List<PickOption<T>> options;
  final String? noneLabel;

  @override
  ConsumerState<_PickerSheet<T>> createState() => _PickerSheetState<T>();
}

class _PickerSheetState<T> extends ConsumerState<_PickerSheet<T>> {
  String q = '';

  @override
  Widget build(BuildContext context) {
    final shown = widget.options.where((o) => q.isEmpty || '${o.label} ${o.subtitle ?? ''}'.toLowerCase().contains(q.toLowerCase())).toList();
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      builder: (context, scroll) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(widget.title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ),
        if (widget.options.length > 8)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              autofocus: true,
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: ref.tr.t('common.search')),
              onChanged: (v) => setState(() => q = v.trim()),
            ),
          ),
        Expanded(
          child: ListView(controller: scroll, children: [
            if (widget.noneLabel != null)
              ListTile(title: Text(widget.noneLabel!), onTap: () => Navigator.pop(context, _Picked<T>(null))),
            for (final o in shown)
              ListTile(
                title: Text(o.label),
                subtitle: o.subtitle == null ? null : Text(o.subtitle!),
                onTap: () => Navigator.pop(context, _Picked<T>(o.value)),
              ),
          ]),
        ),
      ]),
    );
  }
}

/// Payment method chips (cash / bKash / …).
class MethodChips extends ConsumerWidget {
  const MethodChips({super.key, required this.value, required this.onChanged, this.methods = const ['cash', 'bkash', 'nagad', 'rocket', 'bank']});

  final String value;
  final ValueChanged<String> onChanged;
  final List<String> methods;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Wrap(spacing: 8, runSpacing: 4, children: [
        for (final m in methods) ChoiceChip(label: Text(ref.tr.t('method.$m')), selected: value == m, onSelected: (_) => onChanged(m)),
      ]);
}

/// A row of filter chips.
class FilterChips<T> extends StatelessWidget {
  const FilterChips({super.key, required this.options, required this.value, required this.onChanged});

  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) => Align(
        alignment: AlignmentDirectional.centerStart,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Row(children: [
            for (final o in options)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(label: Text(o.$2), selected: value == o.$1, onSelected: (_) => onChanged(o.$1)),
              ),
          ]),
        ),
      );
}

/// One editable invoice / bill line.
class LineDraft {
  LineDraft({String description = '', String quantity = '1', String unitPrice = '', this.feedItemId})
      : description = TextEditingController(text: description),
        quantity = TextEditingController(text: quantity),
        unitPrice = TextEditingController(text: unitPrice);

  final TextEditingController description;
  final TextEditingController quantity;
  final TextEditingController unitPrice;
  int? feedItemId;

  double get amount => Fmt.parse(quantity.text) * Fmt.parse(unitPrice.text);

  void dispose() {
    description.dispose();
    quantity.dispose();
    unitPrice.dispose();
  }
}

/// A period for lists and reports.
class Period {
  const Period(this.id, this.from, this.to);

  final String id;
  final String from;
  final String to;

  static Period thisMonth() {
    final n = DateTime.now();
    return Period('month', isoDate(DateTime(n.year, n.month)), isoDate(n));
  }

  static Period lastMonth() {
    final n = DateTime.now();
    return Period('last', isoDate(DateTime(n.year, n.month - 1)), isoDate(DateTime(n.year, n.month, 0)));
  }

  static Period thisYear() {
    final n = DateTime.now();
    return Period('year', isoDate(DateTime(n.year)), isoDate(n));
  }

  @override
  bool operator ==(Object other) => other is Period && other.from == from && other.to == to;

  @override
  int get hashCode => Object.hash(from, to);
}

/// This month / last month / this year / custom range.
class PeriodChips extends ConsumerWidget {
  const PeriodChips({super.key, required this.value, required this.onChanged});

  final Period value;
  final ValueChanged<Period> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    final fmt = ref.watch(fmtProvider);
    final custom = value.id == 'custom';
    return FilterChips<String>(
      value: value.id,
      options: [
        ('month', tr.t('reports.this.month')),
        ('last', tr.t('m.lastMonth', fallback: 'Last month')),
        ('year', tr.t('reports.this.year')),
        ('custom', custom ? '${fmt.date(value.from, year: false)} – ${fmt.date(value.to, year: false)}' : tr.t('m.custom', fallback: 'Choose dates')),
      ],
      onChanged: (id) async {
        switch (id) {
          case 'month':
            onChanged(Period.thisMonth());
          case 'last':
            onChanged(Period.lastMonth());
          case 'year':
            onChanged(Period.thisYear());
          default:
            final r = await showDateRangePicker(
              context: context,
              firstDate: DateTime(2015),
              lastDate: DateTime.now(),
              initialDateRange: DateTimeRange(start: DateTime.parse(value.from), end: DateTime.parse(value.to)),
            );
            if (r != null) onChanged(Period('custom', isoDate(r.start), isoDate(r.end)));
        }
      },
    );
  }
}

/// "Label ........ value" row used in detail sheets and reports.
class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.label, this.value, {super.key, this.bold = false, this.color, this.onTap});

  final String label;
  final String value;
  final bool bold;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500, color: color);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        child: Row(children: [
          Expanded(child: Text(label, style: bold ? style : TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
          const SizedBox(width: 12),
          Text(value, style: style),
          if (onTap != null) Icon(Icons.chevron_right, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
        ]),
      ),
    );
  }
}

/// ‹ page n / m ›
class Pager extends ConsumerWidget {
  const Pager({super.key, required this.page, required this.last, required this.onChanged});

  final int page;
  final int last;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
        padding: const EdgeInsets.all(12),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          IconButton.outlined(onPressed: page > 1 ? () => onChanged(page - 1) : null, icon: const Icon(Icons.chevron_left)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(ref.tr.t('common.page', params: {'page': page, 'last': last})),
          ),
          IconButton.outlined(onPressed: page < last ? () => onChanged(page + 1) : null, icon: const Icon(Icons.chevron_right)),
        ]),
      );
}
