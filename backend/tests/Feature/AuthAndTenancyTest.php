<?php

namespace Tests\Feature;

use App\Models\Animal;
use App\Models\Customer;
use App\Support\CurrentFarm;
use Tests\TestCase;

class AuthAndTenancyTest extends TestCase
{
    public function test_register_creates_owner_farm_and_chart_of_accounts(): void
    {
        $this->defaultHeaders = [];
        $res = $this->postJson('/api/auth/register', [
            'name' => 'Rahim', 'email' => 'rahim@example.com', 'password' => 'secret-pass-1', 'farm_name' => 'Rahim Dairy',
        ])->assertCreated()->assertJsonPath('farms.0.role', 'owner');

        $this->assertNotEmpty($res->json('token'));
        $this->getJson('/api/farm', ['Authorization' => 'Bearer '.$res->json('token'), 'X-Farm-Id' => $res->json('farms.0.id')])
            ->assertOk()->assertJsonPath('name', 'Rahim Dairy');
    }

    public function test_login_rejects_bad_password_and_logout_revokes_token(): void
    {
        $this->defaultHeaders = [];
        $this->postJson('/api/auth/login', ['email' => $this->owner->email, 'password' => 'wrong'])->assertStatus(422);
        $token = $this->postJson('/api/auth/login', ['email' => $this->owner->email, 'password' => 'password'])->assertOk()->json('token');

        $this->postJson('/api/auth/logout', [], ['Authorization' => "Bearer {$token}"])->assertNoContent();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/auth/me', ['Authorization' => "Bearer {$token}"])->assertUnauthorized();
    }

    public function test_requests_need_a_farm_the_user_belongs_to(): void
    {
        [, $other] = $this->makeFarm();
        $this->getJson('/api/animals', ['X-Farm-Id' => (string) $other->id])->assertForbidden();
        $this->getJson('/api/animals', ['X-Farm-Id' => ''])->assertForbidden();
    }

    public function test_farm_data_is_isolated_even_with_guessed_ids(): void
    {
        [$otherOwner, $otherFarm] = $this->makeFarm();
        app(CurrentFarm::class)->set($otherFarm, 'owner');
        $foreign = Animal::create(['tag' => 'X-1', 'type' => 'cow', 'gender' => 'female']);
        $foreignCustomer = Customer::create(['code' => 'C-1', 'name' => 'Other']);
        app(CurrentFarm::class)->clear();

        $this->getJson("/api/animals/{$foreign->id}")->assertNotFound();
        $this->putJson("/api/animals/{$foreign->id}", ['tag' => 'HACK', 'type' => 'cow', 'gender' => 'female', 'acquisition' => 'born'])->assertNotFound();
        $this->postKey('/api/payments', ['customer_id' => $foreignCustomer->id, 'date' => today()->toDateString(), 'amount' => 100, 'method' => 'cash'])
            ->assertStatus(422);
        $this->assertSame(0, $this->getJson('/api/animals?status=all')->json('meta.total'));
        $this->assertSame('X-1', Animal::withoutGlobalScopes()->find($foreign->id)->tag);
    }

    public function test_roles_are_enforced_on_the_server(): void
    {
        $worker = $this->addMember('worker');
        $this->actingAsMember($worker, $this->farm);

        $this->getJson('/api/animals')->assertOk();
        $this->postKey('/api/customers', ['name' => 'X', 'type' => 'household', 'schedule' => 'daily', 'payment_terms' => 'monthly', 'status' => 'active'])
            ->assertForbidden();
        $this->getJson('/api/reports/pnl')->assertForbidden();
        $this->getJson('/api/dashboard')->assertOk()->assertJsonMissingPath('finance');
    }
}
