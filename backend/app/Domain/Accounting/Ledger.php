<?php

namespace App\Domain\Accounting;

use App\Models\Account;
use App\Models\Farm;
use App\Models\JournalEntry;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * Double-entry posting. Every financial event becomes one balanced journal
 * entry tied to its source document. The unique (source_type, source_id, kind)
 * index guarantees a document can never be posted twice.
 */
final class Ledger
{
    /** @var array<string, array<string,int>> farm-scoped key => id cache */
    private static array $ids = [];

    public static function seedAccounts(Farm $farm): void
    {
        foreach (config('farmos.chart_of_accounts') as $key => [$code, $name, $type, $group]) {
            $exists = Account::withoutGlobalScopes()->where('farm_id', $farm->id)->where('key', $key)->exists();
            if (! $exists) {
                (new Account)->forceFill([
                    'farm_id' => $farm->id, 'key' => $key, 'code' => $code, 'name' => $name,
                    'type' => $type, 'section' => $group, 'is_system' => true,
                ])->save();
            }
        }
        unset(self::$ids[$farm->id]);
    }

    public static function accountId(int $farmId, string $key): int
    {
        if (! isset(self::$ids[$farmId][$key])) {
            // Reload on miss: another worker may have added a custom category.
            self::$ids[$farmId] = Account::withoutGlobalScopes()->where('farm_id', $farmId)->pluck('id', 'key')->all();
        }

        return self::$ids[$farmId][$key] ?? throw new InvalidArgumentException("Unknown account [{$key}]");
    }

    public static function forgetCache(): void
    {
        self::$ids = [];
    }

    /**
     * @param  array<int, array{account:string, debit?:int, credit?:int, customer_id?:int|null, supplier_id?:int|null, animal_id?:int|null, flock_id?:int|null}>  $lines
     */
    public static function post(Model $source, string $date, string $memo, array $lines, string $kind = 'main'): JournalEntry
    {
        $lines = array_values(array_filter($lines, fn ($l) => ($l['debit'] ?? 0) !== 0 || ($l['credit'] ?? 0) !== 0));
        $debit = array_sum(array_column($lines, 'debit'));
        $credit = array_sum(array_column($lines, 'credit'));
        if ($debit !== $credit) {
            throw new InvalidArgumentException("Unbalanced journal entry ({$debit} ≠ {$credit}) for {$memo}");
        }
        if ($debit === 0) {
            throw new InvalidArgumentException("Empty journal entry for {$memo}");
        }

        $farmId = $source->farm_id;
        $entry = new JournalEntry;
        $entry->forceFill([
            'farm_id' => $farmId, 'date' => $date, 'memo' => mb_substr($memo, 0, 255),
            'source_type' => $source->getMorphClass(), 'source_id' => $source->getKey(),
            'kind' => $kind, 'user_id' => auth()->id(),
        ])->save();

        $rows = array_map(fn ($l) => [
            'journal_entry_id' => $entry->id,
            'farm_id' => $farmId,
            'account_id' => self::accountId($farmId, $l['account']),
            'date' => $date,
            'debit' => $l['debit'] ?? 0,
            'credit' => $l['credit'] ?? 0,
            'customer_id' => $l['customer_id'] ?? null,
            'supplier_id' => $l['supplier_id'] ?? null,
            'animal_id' => $l['animal_id'] ?? null,
            'flock_id' => $l['flock_id'] ?? null,
        ], $lines);
        $entry->lines()->insert($rows);

        return $entry;
    }

    /** Removes a source's posting so it can be re-posted after an edit (inside the caller's transaction). */
    public static function unpost(Model $source, string $kind = 'main'): void
    {
        JournalEntry::where('source_type', $source->getMorphClass())->where('source_id', $source->getKey())
            ->where('kind', $kind)->get()->each(function (JournalEntry $e) {
                $e->lines()->delete();
                $e->delete();
            });
    }

    public static function cashAccountFor(string $method): string
    {
        return config("farmos.method_accounts.{$method}", 'cash');
    }
}
