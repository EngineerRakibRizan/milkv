<?php

namespace App\Http\Controllers\Api;

use App\Domain\Accounting\Ledger;
use App\Http\Controllers\Controller;
use App\Models\Farm;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /** Creates the owner account and their first farm in one step. */
    public function register(Request $r)
    {
        abort_unless(config('farmos.registration'), 403, 'Sign-up is closed on this server. Ask the farm owner for an account.');
        $d = $r->validate([
            'name' => 'required|string|max:120',
            'email' => 'required|email|max:190|unique:users,email',
            'password' => ['required', Password::min(8)],
            'farm_name' => 'required|string|max:120',
            'locale' => 'nullable|in:en,bn',
        ]);

        [$user, $farm] = DB::transaction(function () use ($d) {
            $user = User::create(['name' => $d['name'], 'email' => $d['email'], 'password' => $d['password'], 'locale' => $d['locale'] ?? 'en']);
            $farm = Farm::create(['name' => $d['farm_name'], 'locale' => $d['locale'] ?? 'en']);
            $farm->users()->attach($user->id, ['role' => 'owner', 'status' => 'active']);
            Ledger::seedAccounts($farm);

            return [$user, $farm];
        });

        return response()->json($this->session($user, $user->createToken('spa')->plainTextToken), 201);
    }

    public function login(Request $r)
    {
        $d = $r->validate(['email' => 'required|email', 'password' => 'required|string']);
        $user = User::where('email', $d['email'])->first();
        if (! $user || ! Hash::check($d['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'These credentials do not match our records.']);
        }

        return $this->session($user, $user->createToken('spa')->plainTextToken);
    }

    public function me(Request $r)
    {
        return $this->session($r->user());
    }

    public function logout(Request $r)
    {
        $r->user()->currentAccessToken()?->delete();

        return response()->noContent();
    }

    private function session(User $user, ?string $token = null): array
    {
        $farms = $user->farms()->wherePivot('status', 'active')->get();

        return array_filter([
            'token' => $token,
            'user' => ['id' => $user->id, 'name' => $user->name, 'email' => $user->email, 'locale' => $user->locale],
            'farms' => $farms->map(fn (Farm $f) => [
                'id' => $f->id, 'name' => $f->name, 'role' => $f->pivot->role, 'currency' => $f->currency, 'locale' => $f->locale,
                'timezone' => $f->timezone, 'default_milk_price' => \App\Support\Units::m($f->default_milk_price),
                'abilities' => config("farmos.roles.{$f->pivot->role}", []),
            ])->values(),
        ], fn ($v) => $v !== null);
    }
}
