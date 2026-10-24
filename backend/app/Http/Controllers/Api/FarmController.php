<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\FarmChanges;
use App\Support\Units;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class FarmController extends Controller
{
    public function show()
    {
        $f = $this->current()->farm();

        return [
            'id' => $f->id, 'name' => $f->name, 'address' => $f->address, 'phone' => $f->phone, 'email' => $f->email,
            'currency' => $f->currency, 'timezone' => $f->timezone, 'locale' => $f->locale,
            'default_milk_price' => Units::m($f->default_milk_price), 'settings' => $f->settings ?? (object) [],
            'role' => $this->current()->role(), 'abilities' => $this->current()->abilities(),
        ];
    }

    public function update(Request $r)
    {
        $this->allow('settings.update');
        $d = $r->validate([
            'name' => 'sometimes|required|string|max:120', 'address' => 'nullable|string|max:255',
            'phone' => ['nullable', 'string', 'max:20', 'regex:/^\+?[0-9 \-]{6,20}$/'], 'email' => 'nullable|email',
            'currency' => 'sometimes|required|string|size:3', 'timezone' => 'sometimes|required|timezone',
            'locale' => 'sometimes|required|in:en,bn', 'default_milk_price' => 'sometimes|required|numeric|min:0',
            'settings' => 'nullable|array',
        ]);
        $this->current()->farm()->update($this->convert($d, ['default_milk_price']));
        FarmChanges::touch('farm');

        return $this->show();
    }

    public function members()
    {
        $this->allow('users.view');

        return $this->current()->farm()->users()->get()->map(fn ($u) => [
            'id' => $u->id, 'name' => $u->name, 'email' => $u->email, 'role' => $u->pivot->role, 'status' => $u->pivot->status,
        ]);
    }

    /** Adds a team member. Creates the login with a temporary password if the user is new. */
    public function addMember(Request $r)
    {
        $this->allow('users.manage');
        $d = $r->validate([
            'name' => 'required|string|max:120', 'email' => 'required|email',
            'role' => ['required', Rule::in(array_keys(config('farmos.roles')))],
        ]);
        $farm = $this->current()->farm();
        $temp = null;
        $user = User::where('email', $d['email'])->first();
        if (! $user) {
            $temp = Str::password(12, symbols: false);
            $user = User::create(['name' => $d['name'], 'email' => $d['email'], 'password' => $temp]);
        }
        $farm->users()->syncWithoutDetaching([$user->id => ['role' => $d['role'], 'status' => 'active']]);

        return response()->json(['id' => $user->id, 'temporary_password' => $temp], 201);
    }

    public function updateMember(Request $r, int $userId)
    {
        $this->allow('users.manage');
        $d = $r->validate(['role' => ['sometimes', Rule::in(array_keys(config('farmos.roles')))], 'status' => 'sometimes|in:active,disabled']);
        if ($userId === $r->user()->id) {
            abort(422, 'You cannot change your own role.');
        }
        $this->current()->farm()->users()->updateExistingPivot($userId, $d);

        return response()->noContent();
    }

    /** Chart of accounts = income & expense categories. */
    public function accounts()
    {
        return Account::orderBy('code')->get(['id', 'key', 'code', 'name', 'type', 'section', 'is_system']);
    }

    public function addAccount(Request $r)
    {
        $this->allow('settings.update');
        $d = $r->validate(['name' => 'required|string|max:80', 'type' => 'required|in:revenue,expense']);
        $key = Str::slug($d['name'], '_').($d['type'] === 'revenue' ? '_sales' : '_custom');
        abort_if(Account::where('key', $key)->exists(), 422, 'A category with this name already exists.');
        $code = (string) ((int) Account::where('type', $d['type'])->max('code') + 1);
        $a = new Account(['key' => $key, 'code' => $code, 'name' => $d['name'], 'type' => $d['type'],
            'section' => $d['type'] === 'revenue' ? 'sales' : 'operating', 'is_system' => false]);
        $a->save();

        return response()->json($a, 201);
    }

    public function audit(Request $r)
    {
        $this->allow('audit.view');

        return AuditLog::with('user:id,name')->latest('id')
            ->when($r->query('type'), fn ($q, $t) => $q->where('auditable_type', $t))
            ->when($r->query('id'), fn ($q, $id) => $q->where('auditable_id', $id))
            ->paginate($this->perPage($r));
    }
}
