<?php

namespace App\Http\Resources;

use App\Models;
use App\Support\Units;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * API output shapes. Stored integers (paisa, milli-units) leave the API as
 * decimal strings in human units, so clients never handle minor units.
 */
final class Present
{
    public static function page(LengthAwarePaginator $p, callable $fn, array $extra = []): array
    {
        return ['data' => array_map($fn, $p->items()), 'meta' => [
            'current_page' => $p->currentPage(), 'last_page' => $p->lastPage(), 'total' => $p->total(), 'per_page' => $p->perPage(),
        ]] + $extra;
    }

    public static function animal(Models\Animal $a): array
    {
        return [
            'id' => $a->id, 'tag' => $a->tag, 'name' => $a->name, 'type' => $a->type, 'breed' => $a->breed, 'gender' => $a->gender,
            'birth_date' => $a->birth_date?->toDateString(), 'acquired_at' => $a->acquired_at?->toDateString(),
            'acquisition' => $a->acquisition, 'purchase_price' => Units::m($a->purchase_price), 'current_value' => Units::m($a->current_value),
            'color' => $a->color, 'mother_id' => $a->mother_id, 'father_info' => $a->father_info,
            'reproductive_status' => $a->reproductive_status, 'lactation_status' => $a->lactation_status,
            'health_status' => $a->health_status, 'feed_group' => $a->feed_group, 'status' => $a->status,
            'status_date' => $a->status_date?->toDateString(), 'sale_price' => Units::m($a->sale_price),
            'weight' => Units::q($a->weight_g), 'notes' => $a->notes, 'archived' => $a->trashed(),
            'age_months' => $a->birth_date ? (int) $a->birth_date->diffInMonths(now()) : null,
        ];
    }

    public static function flock(Models\Flock $f): array
    {
        return [
            'id' => $f->id, 'code' => $f->code, 'name' => $f->name, 'species' => $f->species, 'breed' => $f->breed,
            'purpose' => $f->purpose, 'started_at' => $f->started_at?->toDateString(), 'initial_count' => $f->initial_count,
            'current_count' => $f->current_count, 'cost' => Units::m($f->cost), 'location' => $f->location,
            'status' => $f->status, 'notes' => $f->notes, 'age_weeks' => $f->started_at ? (int) $f->started_at->diffInWeeks(now()) : null,
        ];
    }

    public static function flockRecord(Models\FlockRecord $r): array
    {
        return $r->only(['id', 'flock_id', 'opening_count', 'added', 'deaths', 'sold', 'culled', 'closing_count', 'eggs', 'eggs_broken', 'sick', 'notes'])
            + ['date' => $r->date->toDateString(), 'water' => Units::q($r->water_ml)];
    }

    public static function feedItem(Models\FeedItem $f): array
    {
        return [
            'id' => $f->id, 'sku' => $f->sku, 'name' => $f->name, 'category' => $f->category, 'unit' => $f->unit,
            'stock' => Units::q($f->stock_milli), 'min_stock' => Units::q($f->min_stock_milli), 'stock_value' => Units::m($f->stock_value),
            'avg_cost' => $f->stock_milli > 0 ? Units::m(intdiv($f->stock_value * 1000, $f->stock_milli)) : '0.00',
            'low' => $f->min_stock_milli > 0 && $f->stock_milli <= $f->min_stock_milli,
            'supplier_id' => $f->supplier_id, 'location' => $f->location, 'expires_at' => $f->expires_at?->toDateString(), 'notes' => $f->notes,
        ];
    }

    public static function movement(Models\InventoryMovement $m): array
    {
        return [
            'id' => $m->id, 'date' => $m->date->toDateString(), 'type' => $m->type, 'feed_item_id' => $m->feed_item_id,
            'item' => $m->relationLoaded('feedItem') ? $m->feedItem?->name : null,
            'unit' => $m->relationLoaded('feedItem') ? $m->feedItem?->unit : null,
            'quantity' => Units::q($m->qty_milli), 'unit_cost' => Units::m($m->unit_cost), 'value' => Units::m($m->value),
            'target_type' => $m->target_type, 'target_id' => $m->target_id,
            'target' => $m->relationLoaded('target') && $m->target ? ($m->target->name ?? $m->target->tag) : null,
            'source_type' => $m->source_type, 'source_id' => $m->source_id, 'notes' => $m->notes,
        ];
    }

    public static function customer(Models\Customer $c): array
    {
        return [
            'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'phone' => $c->phone, 'alt_phone' => $c->alt_phone,
            'address' => $c->address, 'area' => $c->area, 'type' => $c->type, 'default_qty' => Units::q($c->default_qty_ml),
            'price' => Units::m($c->price), 'schedule' => $c->schedule, 'payment_terms' => $c->payment_terms,
            'employee_id' => $c->employee_id, 'status' => $c->status, 'balance' => Units::m($c->balance),
            'joined_at' => $c->joined_at?->toDateString(), 'notes' => $c->notes,
        ];
    }

    public static function delivery(Models\Delivery $d): array
    {
        return [
            'id' => $d->id, 'date' => $d->date->toDateString(), 'customer_id' => $d->customer_id,
            'customer' => $d->relationLoaded('customer') && $d->customer ? ['id' => $d->customer->id, 'name' => $d->customer->name,
                'phone' => $d->customer->phone, 'area' => $d->customer->area, 'address' => $d->customer->address, 'balance' => Units::m($d->customer->balance)] : null,
            'employee_id' => $d->employee_id,
            'employee' => $d->relationLoaded('employee') ? $d->employee?->name : null,
            'ordered' => Units::q($d->ordered_ml), 'delivered' => Units::q($d->delivered_ml), 'unit_price' => Units::m($d->unit_price),
            'discount' => Units::m($d->discount), 'amount' => Units::m($d->amount), 'status' => $d->status,
            'delivered_at' => $d->delivered_at?->toIso8601String(), 'invoice_id' => $d->invoice_id, 'notes' => $d->notes,
        ];
    }

    public static function invoice(Models\Invoice $i): array
    {
        return [
            'id' => $i->id, 'number' => $i->number, 'date' => $i->date->toDateString(), 'due_date' => $i->due_date?->toDateString(),
            'customer_id' => $i->customer_id, 'customer' => $i->relationLoaded('customer') ? $i->customer?->name : null,
            'category' => $i->category, 'description' => $i->description, 'subtotal' => Units::m($i->subtotal),
            'discount' => Units::m($i->discount), 'total' => Units::m($i->total), 'paid' => Units::m($i->paid),
            'due' => Units::m($i->total - $i->paid), 'status' => $i->status, 'source_type' => $i->source_type, 'source_id' => $i->source_id,
            'notes' => $i->notes,
            'items' => $i->relationLoaded('items') ? $i->items->map(fn ($l) => ['description' => $l->description,
                'quantity' => Units::q($l->qty_milli), 'unit_price' => Units::m($l->unit_price), 'amount' => Units::m($l->amount)])->all() : null,
        ];
    }

    public static function payment(Models\CustomerPayment $p): array
    {
        return [
            'id' => $p->id, 'date' => $p->date->toDateString(), 'customer_id' => $p->customer_id,
            'customer' => $p->relationLoaded('customer') ? $p->customer?->name : null,
            'amount' => Units::m($p->amount), 'unallocated' => Units::m($p->unallocated), 'method' => $p->method,
            'reference' => $p->reference, 'notes' => $p->notes,
        ];
    }

    public static function supplier(Models\Supplier $s): array
    {
        return ['id' => $s->id, 'name' => $s->name, 'phone' => $s->phone, 'address' => $s->address, 'type' => $s->type,
            'balance' => Units::m($s->balance), 'notes' => $s->notes];
    }

    public static function bill(Models\Bill $b): array
    {
        return [
            'id' => $b->id, 'number' => $b->number, 'date' => $b->date->toDateString(), 'due_date' => $b->due_date?->toDateString(),
            'supplier_id' => $b->supplier_id, 'supplier' => $b->relationLoaded('supplier') ? $b->supplier?->name : null,
            'kind' => $b->kind, 'category' => $b->category, 'description' => $b->description,
            'subtotal' => Units::m($b->subtotal), 'discount' => Units::m($b->discount), 'extra_cost' => Units::m($b->extra_cost),
            'total' => Units::m($b->total), 'paid' => Units::m($b->paid), 'due' => Units::m($b->total - $b->paid), 'status' => $b->status,
            'source_type' => $b->source_type, 'source_id' => $b->source_id, 'related_type' => $b->related_type, 'related_id' => $b->related_id,
            'notes' => $b->notes,
            'items' => $b->relationLoaded('items') ? $b->items->map(fn ($l) => ['description' => $l->description, 'feed_item_id' => $l->feed_item_id,
                'quantity' => Units::q($l->qty_milli), 'unit_price' => Units::m($l->unit_price), 'amount' => Units::m($l->amount)])->all() : null,
        ];
    }

    public static function treatment(Models\Treatment $t): array
    {
        return [
            'id' => $t->id, 'date' => $t->date->toDateString(), 'animal_id' => $t->animal_id, 'flock_id' => $t->flock_id,
            'subject' => self::subject($t), 'symptoms' => $t->symptoms, 'diagnosis' => $t->diagnosis, 'vet_name' => $t->vet_name,
            'vet_contact' => $t->vet_contact, 'medications' => $t->medications ?? [], 'cost' => Units::m($t->cost),
            'follow_up_date' => $t->follow_up_date?->toDateString(), 'outcome' => $t->outcome, 'notes' => $t->notes,
        ];
    }

    public static function vaccination(Models\Vaccination $v): array
    {
        return [
            'id' => $v->id, 'date' => $v->date->toDateString(), 'animal_id' => $v->animal_id, 'flock_id' => $v->flock_id,
            'subject' => self::subject($v), 'vaccine' => $v->vaccine, 'next_due_date' => $v->next_due_date?->toDateString(),
            'dose' => $v->dose, 'vet_name' => $v->vet_name, 'cost' => Units::m($v->cost), 'notes' => $v->notes,
        ];
    }

    public static function employee(Models\Employee $e): array
    {
        return ['id' => $e->id, 'code' => $e->code, 'name' => $e->name, 'phone' => $e->phone, 'address' => $e->address,
            'title' => $e->title, 'joined_at' => $e->joined_at?->toDateString(), 'salary' => Units::m($e->salary), 'status' => $e->status,
            'emergency_contact' => $e->emergency_contact, 'route' => $e->route, 'user_id' => $e->user_id, 'notes' => $e->notes];
    }

    public static function task(Models\FarmTask $t): array
    {
        return ['id' => $t->id, 'title' => $t->title, 'description' => $t->description, 'employee_id' => $t->employee_id,
            'employee' => $t->relationLoaded('employee') ? $t->employee?->name : null, 'due_date' => $t->due_date->toDateString(),
            'due_time' => $t->due_time ? substr($t->due_time, 0, 5) : null, 'priority' => $t->priority, 'recurrence' => $t->recurrence,
            'status' => $t->status, 'completed_at' => $t->completed_at?->toIso8601String(),
            'overdue' => in_array($t->status, ['pending', 'in_progress'], true) && $t->due_date->lt(today())];
    }

    private static function subject(Models\Treatment|Models\Vaccination $r): ?string
    {
        if ($r->relationLoaded('animal') && $r->animal) {
            return $r->animal->name ? "{$r->animal->tag} · {$r->animal->name}" : $r->animal->tag;
        }

        return $r->relationLoaded('flock') ? $r->flock?->name : null;
    }
}
