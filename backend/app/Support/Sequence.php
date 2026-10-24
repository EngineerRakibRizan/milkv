<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Human document numbers per farm: INV-000001, BILL-000001, ...
 *
 * A counter row per (farm, prefix) is incremented under SELECT … FOR UPDATE
 * inside the caller's transaction, so concurrent requests queue on that one
 * row and can never hand out the same number (works the same on PostgreSQL,
 * MySQL and SQLite).
 */
final class Sequence
{
    public static function next(string $prefix, int $farmId): string
    {
        $key = ['farm_id' => $farmId, 'prefix' => $prefix];
        DB::table('document_sequences')->insertOrIgnore($key + ['next' => 1]);
        $n = (int) DB::table('document_sequences')->where($key)->lockForUpdate()->value('next');
        DB::table('document_sequences')->where($key)->update(['next' => $n + 1]);

        return $prefix.'-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT);
    }
}
