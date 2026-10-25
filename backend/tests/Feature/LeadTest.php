<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\FarmNotification;
use App\Models\Lead;
use App\Support\Phone;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

/** Landing-page enquiries: public submission, spam controls, staff follow-up and conversion. */
class LeadTest extends TestCase
{
    private function submit(array $data = [], ?int $farmId = null)
    {
        return $this->withHeaders([])->postJson('/api/public/farms/'.($farmId ?? $this->farm->id).'/leads', $data + [
            'name' => 'Selina Akter', 'phone' => '01712-345678', 'area' => 'Savar', 'quantity' => '2',
        ]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        RateLimiter::clear('leads');
    }

    public function test_phone_normalization_accepts_bangla_digits_and_country_code(): void
    {
        $this->assertSame('01712345678', Phone::normalizeBd('০১৭১২-৩৪৫৬৭৮'));
        $this->assertSame('01712345678', Phone::normalizeBd('+880 1712 345678'));
        $this->assertNull(Phone::normalizeBd('01212345678'));
        $this->assertNull(Phone::normalizeBd('12345'));
    }

    public function test_public_visitor_can_submit_without_login_and_staff_get_notified(): void
    {
        $this->defaultHeaders = [];
        $this->getJson("/api/public/farms/{$this->farm->id}")->assertOk()->assertJsonPath('name', $this->farm->name)->assertJsonMissingPath('settings');
        $this->submit()->assertCreated();

        $lead = Lead::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($this->farm->id, $lead->farm_id);
        $this->assertSame('01712345678', $lead->phone);
        $this->assertSame(2000, $lead->qty_ml);
        $this->assertSame(1, FarmNotification::withoutGlobalScopes()->where('type', 'new_lead')->count());
    }

    public function test_invalid_phone_and_honeypot_are_rejected(): void
    {
        $this->defaultHeaders = [];
        $this->submit(['phone' => '12345'])->assertStatus(422)->assertJsonValidationErrors('phone');
        $this->submit(['website' => 'http://spam.example'])->assertStatus(422);
        $this->assertSame(0, Lead::withoutGlobalScopes()->count());
    }

    public function test_repeat_submission_from_same_phone_updates_instead_of_duplicating(): void
    {
        $this->defaultHeaders = [];
        $this->submit()->assertCreated();
        $this->submit(['quantity' => '3', 'message' => 'Please start Sunday'])->assertCreated();

        $this->assertSame(1, Lead::withoutGlobalScopes()->count());
        $this->assertSame(3000, Lead::withoutGlobalScopes()->first()->qty_ml);
        $this->assertSame(1, FarmNotification::withoutGlobalScopes()->where('type', 'new_lead')->count());
    }

    public function test_submissions_are_rate_limited_per_ip(): void
    {
        $this->defaultHeaders = [];
        foreach (range(1, 5) as $i) {
            $this->submit(['phone' => '0171234567'.$i])->assertCreated();
        }
        $this->submit(['phone' => '01812345678'])->assertStatus(429);
    }

    public function test_staff_see_only_their_farms_leads_and_convert_to_customer(): void
    {
        [, $other] = $this->makeFarm();
        $this->submit()->assertCreated();
        $this->submit(['phone' => '01911111111', 'name' => 'Other farm lead'], $other->id)->assertCreated();

        $list = $this->getJson('/api/leads')->assertOk();
        $this->assertSame(1, $list->json('meta.total'));
        $id = $list->json('data.0.id');

        $this->patchJson("/api/leads/{$id}", ['status' => 'contacted', 'notes' => 'Called, wants 2 L from Sunday'])
            ->assertOk()->assertJsonPath('status', 'contacted');
        $res = $this->postJson("/api/leads/{$id}/convert", ['name' => 'Selina Akter', 'area' => 'Savar', 'default_qty' => '2', 'schedule' => 'daily'])
            ->assertCreated()->assertJsonPath('lead.status', 'converted');

        $customer = Customer::findOrFail($res->json('customer_id'));
        $this->assertSame('01712345678', $customer->phone);
        $this->assertSame(2000, $customer->default_qty_ml);
        $this->postJson("/api/leads/{$id}/convert", ['name' => 'Again', 'schedule' => 'daily'])->assertStatus(422);
    }

    public function test_workers_cannot_read_leads(): void
    {
        $this->actingAsMember($this->addMember('worker'), $this->farm);
        $this->getJson('/api/leads')->assertForbidden();
    }
}
