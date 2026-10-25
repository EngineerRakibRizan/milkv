<?php

namespace App\Support;

/** Bangladesh mobile numbers: accepts Bangla digits, spaces, dashes and +88; stores 01XXXXXXXXX. */
final class Phone
{
    private const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

    public static function normalizeBd(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }
        $s = str_replace(self::BN_DIGITS, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], $raw);
        $s = preg_replace('/[^\d+]/', '', $s);
        $s = preg_replace('/^(\+?88)(?=01)/', '', $s);

        return preg_match('/^01[3-9]\d{8}$/', $s) ? $s : null;
    }
}
