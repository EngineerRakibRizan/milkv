<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Tells every open client of a farm which data changed, so they refetch only
 * those queries. Carries entity names only; no business data goes over the socket.
 */
class FarmDataChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /** @param string[] $entities */
    public function __construct(public int $farmId, public array $entities) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("farm.{$this->farmId}");
    }

    public function broadcastAs(): string
    {
        return 'changed';
    }

    public function broadcastWith(): array
    {
        return ['entities' => array_values(array_unique($this->entities))];
    }
}
