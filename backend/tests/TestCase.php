<?php

namespace Tests;

use App\Domain\Accounting\Ledger;
use App\Models\Farm;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Str;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected Farm $farm;

    protected User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        Ledger::forgetCache();
        [$this->owner, $this->farm] = $this->makeFarm();
        $this->actingAsMember($this->owner, $this->farm);
    }

    /** @return array{0: User, 1: Farm} */
    protected function makeFarm(string $role = 'owner'): array
    {
        $user = User::factory()->create();
        $farm = Farm::create(['name' => 'Test Farm '.Str::random(4), 'default_milk_price' => 10000]);
        $farm->users()->attach($user->id, ['role' => $role, 'status' => 'active']);
        Ledger::seedAccounts($farm);

        return [$user, $farm];
    }

    protected function addMember(string $role, ?Farm $farm = null): User
    {
        $user = User::factory()->create();
        ($farm ?? $this->farm)->users()->attach($user->id, ['role' => $role, 'status' => 'active']);

        return $user;
    }

    /** Authenticates with a real Sanctum token and selects the farm, like the SPA does. */
    protected function actingAsMember(User $user, Farm $farm): static
    {
        $this->app['auth']->forgetGuards();
        $token = $user->createToken('test')->plainTextToken;
        $this->defaultHeaders = ['Authorization' => "Bearer {$token}", 'X-Farm-Id' => (string) $farm->id, 'Accept' => 'application/json'];

        return $this;
    }

    /** POST with a fresh idempotency key (or a given one to simulate a retry). */
    protected function postKey(string $uri, array $data = [], ?string $key = null)
    {
        return $this->postJson($uri, $data, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }
}
