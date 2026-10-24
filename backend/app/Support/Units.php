<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Boundary conversion between human values and stored integers.
 *
 * Money:    "1250.50" taka  <-> 125050 paisa
 * Quantity: "12.5" litres   <-> 12500 milli-units (ml, g, or 1/1000 bag)
 *
 * Parsing is done on the decimal string, never through floats, so
 * "0.1" + "0.2" stays exactly 300 milli-units.
 */
final class Units
{
    public static function toMinor(string|int|float|null $value, int $scale = 100): int
    {
        if ($value === null || $value === '') {
            return 0;
        }
        $s = is_float($value) ? rtrim(rtrim(number_format($value, 6, '.', ''), '0'), '.') : trim((string) $value);
        if (! preg_match('/^(-)?(\d*)(?:\.(\d+))?$/', $s, $m) || ($m[2] === '' && ($m[3] ?? '') === '')) {
            throw new InvalidArgumentException("Invalid number: {$s}");
        }
        $digits = strlen((string) $scale) - 1;
        $int = (int) ($m[2] === '' ? '0' : $m[2]);
        $frac = substr(str_pad($m[3] ?? '', $digits + 1, '0'), 0, $digits + 1);
        // Round half up on the first dropped digit.
        $minor = $int * $scale + intdiv((int) $frac, 10) + ((int) substr($frac, -1) >= 5 ? 1 : 0);

        return $m[1] === '-' ? -$minor : $minor;
    }

    public static function money(string|int|float|null $value): int
    {
        return self::toMinor($value, 100);
    }

    public static function qty(string|int|float|null $value): int
    {
        return self::toMinor($value, 1000);
    }

    public static function fromMinor(?int $minor, int $scale = 100): ?string
    {
        if ($minor === null) {
            return null;
        }
        $digits = strlen((string) $scale) - 1;
        $sign = $minor < 0 ? '-' : '';
        $abs = abs($minor);

        return $sign.intdiv($abs, $scale).'.'.str_pad((string) ($abs % $scale), $digits, '0', STR_PAD_LEFT);
    }

    public static function m(?int $paisa): ?string
    {
        return self::fromMinor($paisa, 100);
    }

    public static function q(?int $milli): ?string
    {
        return self::fromMinor($milli, 1000);
    }

    /** qty (milli-units) × price (paisa per unit) → paisa, rounded half up. */
    public static function lineAmount(int $qtyMilli, int $unitPrice): int
    {
        return intdiv($qtyMilli * $unitPrice + ($qtyMilli * $unitPrice >= 0 ? 500 : -500), 1000);
    }
}
