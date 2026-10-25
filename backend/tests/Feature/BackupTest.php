<?php

namespace Tests\Feature;

use App\Domain\Backup\BackupExporter;
use App\Domain\Backup\BackupImporter;
use App\Domain\Backup\BackupSchema;
use App\Models\Farm;
use App\Models\User;
use App\Support\CurrentFarm;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;
use ZipArchive;

/**
 * Backup → restore round trips on the full 30-day demo farm. A restored farm
 * must be indistinguishable from the original: same rows per table, same
 * balances, same reports, and every reference pointing inside the new farm.
 */
class BackupTest extends TestCase
{
    private Farm $demo;

    private User $demoOwner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        app(CurrentFarm::class)->clear();
        $this->demo = Farm::where('name', 'Aura Dairy & Agro')->firstOrFail();
        $this->demoOwner = User::where('email', 'owner@farmos.test')->firstOrFail();
        $this->actingAsMember($this->demoOwner, $this->demo);
    }

    private function exportTo(string $format): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bkt');
        $format === 'csv' ? app(BackupExporter::class)->csv($this->demo, $path) : app(BackupExporter::class)->full($this->demo, $path);

        return $path;
    }

    /** Key business figures, read through the API as that farm's owner. */
    private function fingerprint(Farm $farm): array
    {
        $this->actingAsMember($this->demoOwner, $farm);
        $from = now()->subDays(40)->toDateString();
        $get = fn (string $u): TestResponse => $this->getJson($u)->assertOk();

        return [
            'pnl' => $get("/api/reports/pnl?from={$from}")->json(),
            'cash' => $get("/api/reports/cashflow?from={$from}")->json('closing'),
            'receivables' => $get('/api/reports/receivables')->json('total'),
            'payables' => $get('/api/reports/payables')->json('total'),
            'inventory' => $get('/api/inventory')->json('total_value'),
            'milk' => $get('/api/milk/sheet?date='.today()->toDateString())->json('summary.stock'),
            'animals' => $get('/api/animals?status=all')->json('meta.total'),
            'profit_per_cow' => collect($get("/api/reports/profitability?dimension=animal&from={$from}")->json())->pluck('profit', 'label')->sort()->all(),
        ];
    }

    private function assertRestoredMatches(array $result): void
    {
        $new = Farm::findOrFail($result['farm_id']);
        $this->assertStringStartsWith('Aura Dairy & Agro (restored', $new->name);

        foreach (array_keys(BackupSchema::TABLES) as $table) {
            if (isset(BackupSchema::TABLES[$table]['parent'])) {
                continue;
            }
            $this->assertSame(
                DB::table($table)->where('farm_id', $this->demo->id)->count(),
                DB::table($table)->where('farm_id', $new->id)->count(), "row count of {$table}");
        }
        // Every journal line belongs to an entry and account of the NEW farm.
        $this->assertSame(0, DB::table('journal_lines')->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')->where('journal_lines.farm_id', $new->id)
            ->where(fn ($q) => $q->where('journal_entries.farm_id', '!=', $new->id)->orWhere('accounts.farm_id', '!=', $new->id))->count());
        // Circular and polymorphic references were re-pointed, not left on the old farm.
        $this->assertSame(0, DB::table('deliveries')->join('invoices', 'invoices.id', '=', 'deliveries.invoice_id')
            ->where('deliveries.farm_id', $new->id)->where('invoices.farm_id', '!=', $new->id)->count());
        $this->assertSame(
            DB::table('deliveries')->where('farm_id', $this->demo->id)->whereNotNull('invoice_id')->count(),
            DB::table('deliveries')->where('farm_id', $new->id)->whereNotNull('invoice_id')->count());
        $this->assertSame(0, DB::table('animals as c')->join('animals as m', 'm.id', '=', 'c.mother_id')
            ->where('c.farm_id', $new->id)->where('m.farm_id', '!=', $new->id)->count());
        $this->assertSame(3, DB::table('animals')->where('farm_id', $new->id)->whereNotNull('mother_id')->count());

        $this->assertEquals($this->fingerprint($this->demo), $this->fingerprint($new));
    }

    public function test_full_backup_restores_as_identical_new_farm(): void
    {
        $zip = $this->exportTo('full');
        $result = app(BackupImporter::class)->import($zip, $this->demoOwner);
        $this->assertRestoredMatches($result);
        $this->assertGreaterThan(5000, array_sum($result['counts']));
    }

    public function test_csv_backup_is_also_importable(): void
    {
        $zip = $this->exportTo('csv');
        $this->assertRestoredMatches(app(BackupImporter::class)->import($zip, $this->demoOwner));
    }

    public function test_owner_downloads_all_formats_and_imports_through_the_api(): void
    {
        foreach (['full' => 'application/zip', 'csv' => 'application/zip', 'sql' => 'application/sql'] as $format => $mime) {
            $res = $this->get("/api/backup/download?format={$format}")->assertOk();
            $this->assertStringContainsString($mime, $res->headers->get('Content-Type'));
            $this->assertStringContainsString('aura-dairy-agro-backup-', $res->headers->get('Content-Disposition'));
        }

        $file = new \Illuminate\Http\UploadedFile($this->exportTo('full'), 'aura.farmos.zip', 'application/zip', null, true);
        $res = $this->post('/api/backup/import', ['file' => $file])->assertCreated();
        // The owner can switch to the restored farm right away.
        $this->assertTrue($this->demoOwner->farms()->whereKey($res->json('farm_id'))->exists());
    }

    public function test_sql_backup_contains_only_this_farm(): void
    {
        [, $other] = $this->makeFarm();
        app(CurrentFarm::class)->set($other, 'owner');
        \App\Models\Customer::create(['code' => 'X-1', 'name' => 'Other Farm Secret Customer']);
        app(CurrentFarm::class)->clear();

        $path = tempnam(sys_get_temp_dir(), 'sql');
        app(BackupExporter::class)->sql($this->demo, $path);
        $sql = file_get_contents($path);
        $this->assertStringContainsString('INSERT INTO "journal_lines"', $sql);
        $this->assertStringContainsString('Savar Milk Collection Centre', $sql);
        $this->assertStringNotContainsString('Other Farm Secret Customer', $sql);
        $this->assertStringNotContainsString('"users"', $sql);
    }

    public function test_server_keeps_stored_backups(): void
    {
        $this->postJson('/api/backup/stored')->assertCreated();
        $list = $this->getJson('/api/backup/stored')->assertOk();
        $name = $list->json('backups.0.name');
        $this->assertStringEndsWith('.farmos.zip', $name);
        $this->get("/api/backup/stored/{$name}")->assertOk();
        $this->get('/api/backup/stored/..%2F..%2F.env')->assertNotFound();
    }

    public function test_edited_backup_is_rejected_and_nothing_is_imported(): void
    {
        $zipPath = $this->exportTo('full');
        $zip = new ZipArchive;
        $zip->open($zipPath);
        $zip->addFromString('data/customers.json', '[]');
        $zip->close();
        $farms = Farm::count();

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        try {
            app(BackupImporter::class)->import($zipPath, $this->demoOwner);
        } finally {
            $this->assertSame($farms, Farm::count());
        }
    }

    public function test_only_the_owner_can_back_up_or_restore(): void
    {
        $manager = User::where('email', 'manager@farmos.test')->firstOrFail();
        $this->actingAsMember($manager, $this->demo);
        $this->get('/api/backup/download?format=full')->assertForbidden();
        $this->getJson('/api/backup/stored')->assertForbidden();
        $this->postJson('/api/backup/import')->assertForbidden();
    }
}
