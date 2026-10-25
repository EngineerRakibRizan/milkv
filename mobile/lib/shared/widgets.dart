import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_client.dart';
import '../core/i18n/format.dart';
import '../core/i18n/i18n.dart';
import '../core/offline/outbox.dart';
import '../core/offline/query_cache.dart';
import '../core/providers.dart';
import '../core/theme.dart';

extension TrContext on WidgetRef {
  Translations get tr => watch(trProvider);
}

/// Renders a cached resource: skeleton on first load, error with retry when
/// there is nothing to show, otherwise the data with an "offline" note when
/// it could not be refreshed.
class AsyncBody<T> extends ConsumerWidget {
  const AsyncBody({super.key, required this.value, required this.builder, this.onRetry, this.skeleton});

  final AsyncValue<Cached<T>> value;
  final Widget Function(BuildContext context, T data, Cached<T> meta) builder;
  final VoidCallback? onRetry;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = value.value;
    if (c != null) return builder(context, c.data, c);
    if (value.hasError) {
      final e = ApiError.from(value.error!);
      return ErrorView(error: e, onRetry: onRetry);
    }
    return skeleton ?? const SkeletonList();
  }
}

String errorText(Translations tr, ApiError e) => e.offline
    ? tr.t('m.offlineNoData', fallback: 'No internet connection, and nothing saved on this phone yet.')
    : e.message;

class ErrorView extends ConsumerWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final ApiError error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tr = ref.tr;
    return EmptyState(
      icon: error.offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      title: errorText(tr, error),
      action: onRetry == null ? null : OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(tr.t('m.retry', fallback: 'Try again'))),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.hint, this.action});

  final IconData icon;
  final String title;
  final String? hint;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 48, color: muted.withValues(alpha: 0.6)),
          const SizedBox(height: 12),
          Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
          if (hint != null) ...[
            const SizedBox(height: 6),
            Text(hint!, textAlign: TextAlign.center, style: TextStyle(color: muted)),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ]),
      ),
    );
  }
}

class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 6, this.height = 64});

  final int count;
  final double height;

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme.surfaceContainerHighest.withValues(alpha: 0.6);
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (_, _) => Container(height: height, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(14))),
    );
  }
}

/// Shown above a list when it is the saved copy because the refresh failed.
class StaleNote extends ConsumerWidget {
  const StaleNote(this.meta, {super.key});

  final Cached<Object?> meta;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (meta.error == null) return const SizedBox.shrink();
    final tr = ref.tr;
    final when = meta.savedAt == null ? '' : ref.watch(fmtProvider).dateTime(meta.savedAt!.toIso8601String());
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: Brand.accent.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(meta.offline ? Icons.cloud_off_rounded : Icons.info_outline, size: 18, color: Brand.warning),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            meta.offline ? tr.t('m.savedCopy', fallback: 'Offline — showing data saved {{when}}', params: {'when': when}) : meta.error!.message,
            style: const TextStyle(fontSize: 13),
          ),
        ),
      ]),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.icon, this.tone, this.onTap});

  final String label;
  final String value;
  final IconData? icon;
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (icon != null) ...[Icon(icon, size: 18, color: tone ?? theme.colorScheme.primary), const SizedBox(width: 6)],
              Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant))),
            ]),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: TextStyle(fontFamily: 'BalooDa2', fontSize: 24, fontWeight: FontWeight.w700, color: tone ?? theme.colorScheme.onSurface)),
            ),
          ]),
        ),
      ),
    );
  }
}

class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, required this.child, this.trailing, this.padding = EdgeInsets.zero});

  final String title;
  final Widget child;
  final Widget? trailing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Card(
        clipBehavior: Clip.antiAlias,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
            child: Row(children: [
              Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
              ?trailing,
            ]),
          ),
          Padding(padding: padding, child: child),
        ]),
      );
}

class StatusPill extends ConsumerWidget {
  const StatusPill(this.status, {super.key, this.label});

  final String status;
  final String? label;

  static Color colorFor(String s) => switch (s) {
        'delivered' || 'completed' || 'paid' || 'converted' || 'active' => const Color(0xFF15803D),
        'partial' || 'in_progress' || 'out_for_delivery' || 'contacted' || 'prepared' => Brand.info,
        'cancelled' || 'lost' || 'void' || 'overdue' || 'high' => Brand.danger,
        _ => Brand.warning,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = colorFor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99)),
      child: Text(label ?? ref.tr.t('status.$status', fallback: status), style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/// Feedback after a write: saved, or saved on the phone and waiting to sync.
void showWriteResult(BuildContext context, WidgetRef ref, WriteResult r, String savedText) {
  final tr = ref.read(trProvider);
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(children: [
        Icon(r.queued ? Icons.cloud_queue_rounded : Icons.check_circle_rounded, color: Colors.white),
        const SizedBox(width: 10),
        Expanded(child: Text(r.queued ? tr.t('m.queued', fallback: 'Saved on this phone. It will sync when you are online.') : savedText)),
      ]),
      backgroundColor: r.queued ? Brand.warning : Brand.primary,
    ));
}

void showError(BuildContext context, WidgetRef ref, Object e) {
  final err = ApiError.from(e);
  final tr = ref.read(trProvider);
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(err.offline ? tr.t('m.needsOnline', fallback: 'This needs an internet connection.') : (err.errors.values.firstOrNull?.first ?? err.message)), backgroundColor: Brand.danger));
}

/// Pull-to-refresh that reloads one provider.
class Refreshable extends StatelessWidget {
  const Refreshable({super.key, required this.onRefresh, required this.child});

  final Future<void> Function() onRefresh;
  final Widget child;

  @override
  Widget build(BuildContext context) => RefreshIndicator(onRefresh: onRefresh, child: child);
}

/// A day switcher: ‹ date › with a "Today" shortcut.
class DayBar extends ConsumerWidget {
  const DayBar({super.key, required this.day, required this.onChanged, this.maxDay});

  final String day;
  final ValueChanged<String> onChanged;
  final String? maxDay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = ref.watch(fmtProvider);
    final tr = ref.tr;
    final parsed = DateTime.parse(day);
    final canNext = maxDay == null || day.compareTo(maxDay!) < 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
      child: Row(children: [
        IconButton.outlined(onPressed: () => onChanged(shiftDate(day, -1)), icon: const Icon(Icons.chevron_left), tooltip: tr.t('common.previous')),
        Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: parsed,
                firstDate: DateTime(2020),
                lastDate: maxDay == null ? DateTime.now().add(const Duration(days: 365)) : DateTime.parse(maxDay!),
              );
              if (picked != null) onChanged(isoDate(picked));
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(children: [
                Text(fmt.date(day), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                Text(day == today() ? tr.t('common.today') : fmt.weekday(day), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ]),
            ),
          ),
        ),
        IconButton.outlined(onPressed: canNext ? () => onChanged(shiftDate(day, 1)) : null, icon: const Icon(Icons.chevron_right), tooltip: tr.t('common.next')),
      ]),
    );
  }
}
