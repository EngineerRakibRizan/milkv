<?php

namespace App\Http\Controllers;

use App\Support\CurrentFarm;
use App\Support\Units;
use Illuminate\Http\Request;

abstract class Controller
{
    protected function current(): CurrentFarm
    {
        return app(CurrentFarm::class);
    }

    /** Server-side permission check; the UI only mirrors these. */
    protected function allow(string $ability): void
    {
        $this->current()->authorize($ability);
    }

    protected function perPage(Request $r): int
    {
        return min(100, max(5, (int) $r->query('per_page', 25)));
    }

    /** Converts human-unit inputs to stored integers: money → paisa, qty → milli-units. */
    protected function convert(array $data, array $money = [], array $qty = []): array
    {
        foreach ($money as $from => $to) {
            [$from, $to] = is_int($from) ? [$to, $to] : [$from, $to];
            if (array_key_exists($from, $data)) {
                $v = $data[$from];
                unset($data[$from]);
                $data[$to] = $v === null || $v === '' ? null : Units::money($v);
            }
        }
        foreach ($qty as $from => $to) {
            [$from, $to] = is_int($from) ? [$to, $to] : [$from, $to];
            if (array_key_exists($from, $data)) {
                $v = $data[$from];
                unset($data[$from]);
                $data[$to] = $v === null || $v === '' ? null : Units::qty($v);
            }
        }

        return $data;
    }
}
