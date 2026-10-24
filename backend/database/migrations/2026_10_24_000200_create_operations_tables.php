<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Livestock, poultry, staff, tasks, veterinary. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('code', 30);
            $table->string('name');
            $table->string('phone', 20)->nullable();
            $table->string('address')->nullable();
            $table->string('title')->nullable();
            $table->date('joined_at')->nullable();
            $table->bigInteger('salary')->default(0); // monthly, paisa
            $table->string('status', 20)->default('active');
            $table->string('emergency_contact')->nullable();
            $table->string('route')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['farm_id', 'code']);
        });

        Schema::create('animals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('tag', 40);
            $table->string('name')->nullable();
            $table->string('type', 20);              // cow | heifer | bull | calf
            $table->string('breed')->nullable();
            $table->string('gender', 10);            // female | male
            $table->date('birth_date')->nullable();
            $table->date('acquired_at')->nullable();
            $table->string('acquisition', 20)->default('born'); // born | purchased | gift
            $table->bigInteger('purchase_price')->default(0);
            $table->bigInteger('current_value')->default(0);
            $table->string('color')->nullable();
            $table->foreignId('mother_id')->nullable()->constrained('animals')->nullOnDelete();
            $table->string('father_info')->nullable();
            $table->string('reproductive_status', 20)->nullable(); // open | inseminated | pregnant
            $table->string('lactation_status', 20)->nullable();    // lactating | dry
            $table->string('health_status', 20)->default('healthy'); // healthy | sick | under_treatment
            $table->string('feed_group')->nullable();
            $table->string('photo_path')->nullable();
            $table->string('status', 20)->default('active');  // active | sold | deceased | transferred
            $table->date('status_date')->nullable();
            $table->bigInteger('sale_price')->nullable();
            $table->bigInteger('weight_g')->nullable();        // latest weight, cached from animal_weights
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['farm_id', 'tag']);
            $table->index(['farm_id', 'status', 'type']);
        });

        Schema::create('animal_weights', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('animal_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->bigInteger('weight_g');
            $table->string('notes')->nullable();
            $table->timestamps();
            $table->index(['animal_id', 'date']);
        });

        // Breeding, calving, birth, sale, death, transfer: one timeline table.
        Schema::create('animal_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('animal_id')->constrained()->cascadeOnDelete();
            $table->string('type', 30);
            $table->date('date');
            $table->foreignId('related_animal_id')->nullable()->constrained('animals')->nullOnDelete();
            $table->json('details')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['animal_id', 'date']);
        });

        Schema::create('flocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('code', 30);
            $table->string('name');
            $table->string('species', 10);         // hen | duck
            $table->string('breed')->nullable();
            $table->string('purpose', 20)->default('layer'); // layer | broiler | breeder | mixed
            $table->date('started_at');
            $table->unsignedInteger('initial_count');
            $table->unsignedInteger('current_count');
            $table->bigInteger('cost')->default(0);
            $table->string('location')->nullable();
            $table->string('status', 20)->default('active');
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['farm_id', 'code']);
        });

        Schema::create('flock_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('flock_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->unsignedInteger('opening_count');
            $table->unsignedInteger('added')->default(0);
            $table->unsignedInteger('deaths')->default(0);
            $table->unsignedInteger('sold')->default(0);
            $table->unsignedInteger('culled')->default(0);
            $table->unsignedInteger('closing_count');
            $table->unsignedInteger('eggs')->default(0);
            $table->unsignedInteger('eggs_broken')->default(0);
            $table->unsignedInteger('sick')->default(0);
            $table->bigInteger('water_ml')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->unique(['flock_id', 'date']);
            $table->index(['farm_id', 'date']);
        });

        Schema::create('treatments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('animal_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('flock_id')->nullable()->constrained()->nullOnDelete();
            $table->date('date');
            $table->text('symptoms')->nullable();
            $table->string('diagnosis')->nullable();
            $table->string('vet_name')->nullable();
            $table->string('vet_contact')->nullable();
            $table->json('medications')->nullable(); // [{name, dosage, frequency, duration}] as prescribed
            $table->bigInteger('cost')->default(0);
            $table->date('follow_up_date')->nullable();
            $table->string('outcome', 20)->default('ongoing'); // ongoing | recovered | referred | died
            $table->text('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['farm_id', 'date']);
            $table->index(['farm_id', 'follow_up_date']);
        });

        Schema::create('vaccinations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('animal_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('flock_id')->nullable()->constrained()->nullOnDelete();
            $table->string('vaccine');
            $table->date('date');
            $table->date('next_due_date')->nullable();
            $table->string('dose')->nullable();
            $table->string('vet_name')->nullable();
            $table->bigInteger('cost')->default(0);
            $table->text('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['farm_id', 'next_due_date']);
        });

        Schema::create('farm_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->text('description')->nullable();
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->date('due_date');
            $table->time('due_time')->nullable();
            $table->string('priority', 10)->default('normal'); // low | normal | high
            $table->string('recurrence', 10)->default('none'); // none | daily | weekly | monthly
            $table->string('status', 20)->default('pending');  // pending | in_progress | completed | cancelled
            $table->timestamp('completed_at')->nullable();
            $table->nullableMorphs('related');
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['farm_id', 'status', 'due_date']);
        });
    }

    public function down(): void
    {
        foreach (['farm_tasks', 'vaccinations', 'treatments', 'flock_records', 'flocks', 'animal_events', 'animal_weights', 'animals', 'employees'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
