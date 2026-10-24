<?php

namespace App\Models\Concerns;

use App\Models\AuditLog;

/** Records who changed what on sensitive models (before/after snapshots). */
trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(fn ($m) => $m->writeAudit('created', null, $m->getAttributes()));
        static::updated(function ($m) {
            $changes = $m->getChanges();
            unset($changes['updated_at']);
            if ($changes) {
                $m->writeAudit('updated', array_intersect_key($m->getOriginal(), $changes), $changes);
            }
        });
        static::deleted(fn ($m) => $m->writeAudit('deleted', $m->getOriginal(), null));
    }

    protected function writeAudit(string $action, ?array $before, ?array $after): void
    {
        (new AuditLog)->forceFill([
            'farm_id' => $this->farm_id,
            'user_id' => auth()->id(),
            'action' => $action,
            'auditable_type' => $this->getMorphClass(),
            'auditable_id' => $this->getKey(),
            'before' => $before,
            'after' => $after,
            'ip' => request()?->ip(),
            'created_at' => now(),
        ])->save();
    }
}
