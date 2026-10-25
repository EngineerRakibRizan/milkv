<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AccountTest extends TestCase
{
    public function test_name_can_change_without_password(): void
    {
        $this->putJson('/api/auth/me', ['name' => 'Rizan'])->assertOk()->assertJsonPath('user.name', 'Rizan');
    }

    public function test_email_change_requires_current_password(): void
    {
        $this->putJson('/api/auth/me', ['email' => 'new@example.com'])->assertStatus(422)->assertJsonValidationErrors('current_password');
        $this->putJson('/api/auth/me', ['email' => 'new@example.com', 'current_password' => 'wrong'])->assertStatus(422);
        $this->putJson('/api/auth/me', ['email' => 'new@example.com', 'current_password' => 'password'])
            ->assertOk()->assertJsonPath('user.email', 'new@example.com');

        // The new email signs in.
        $this->defaultHeaders = [];
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => 'new@example.com', 'password' => 'password'])->assertOk();
    }

    public function test_email_must_be_unique(): void
    {
        $other = $this->addMember('manager');
        $this->putJson('/api/auth/me', ['email' => $other->email, 'current_password' => 'password'])->assertStatus(422)->assertJsonValidationErrors('email');
    }

    public function test_password_change_signs_out_other_devices(): void
    {
        $otherDevice = $this->owner->createToken('phone')->plainTextToken;
        $this->putJson('/api/auth/me', ['current_password' => 'password', 'password' => 'new-secret-9', 'password_confirmation' => 'new-secret-9'])->assertOk();

        $this->assertTrue(Hash::check('new-secret-9', $this->owner->fresh()->password));
        $this->assertSame(1, $this->owner->tokens()->count()); // only the device that made the change
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/auth/me', ['Authorization' => "Bearer {$otherDevice}"])->assertUnauthorized();
    }
}
