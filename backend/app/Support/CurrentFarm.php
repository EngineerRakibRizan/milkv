<?php

namespace App\Support;

use App\Models\Farm;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * The farm (tenant) and role resolved for the current request.
 * Bound as a scoped singleton so it resets between Octane requests.
 */
final class CurrentFarm
{
    private ?Farm $farm = null;

    private ?string $role = null;

    public function set(Farm $farm, string $role): void
    {
        $this->farm = $farm;
        $this->role = $role;
    }

    public function clear(): void
    {
        $this->farm = null;
        $this->role = null;
    }

    public function has(): bool
    {
        return $this->farm !== null;
    }

    public function farm(): Farm
    {
        return $this->farm ?? throw new \LogicException('No farm resolved for this request.');
    }

    public function id(): ?int
    {
        return $this->farm?->id;
    }

    public function role(): ?string
    {
        return $this->role;
    }

    public function can(string $ability): bool
    {
        if ($this->role === null) {
            return false;
        }
        $abilities = config("farmos.roles.{$this->role}", []);

        return in_array('*', $abilities, true) || in_array($ability, $abilities, true)
            || in_array(explode('.', $ability)[0].'.*', $abilities, true);
    }

    public function authorize(string $ability): void
    {
        if (! $this->can($ability)) {
            throw new AuthorizationException('Your role does not allow this action.');
        }
    }

    public function abilities(): array
    {
        return config("farmos.roles.{$this->role}", []);
    }
}
