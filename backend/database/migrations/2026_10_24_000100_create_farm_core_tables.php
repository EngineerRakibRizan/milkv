<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tenancy, access control and platform tables.
 *
 * Conventions used across every FarmOS migration:
 *  - money columns are BIGINT minor units (paisa); never floats
 *  - quantities are BIGINT milli-units of the item's unit (1 kg = 1000, 1 L = 1000 ml)
 *  - every business row carries farm_id and is indexed by it first
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone', 20)->nullable()->after('email');
            $table->string('locale', 5)->default('en')->after('phone');
        });

        Schema::create('farms', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('address')->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('email')->nullable();
            $table->string('logo_path')->nullable();
            $table->string('currency', 3)->default('BDT');
            $table->string('timezone')->default('Asia/Dhaka');
            $table->string('locale', 5)->default('en');
            $table->bigInteger('default_milk_price')->default(10000); // paisa per litre
            $table->json('settings')->nullable();
            $table->timestamps();
        });

        Schema::create('farm_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 20);
            $table->string('status', 20)->default('active');
            $table->timestamps();
            $table->unique(['farm_id', 'user_id']);
        });

        // Gap-free document numbers (INV-000001…) per farm; incremented under a row lock.
        Schema::create('document_sequences', function (Blueprint $table) {
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('prefix', 10);
            $table->unsignedBigInteger('next')->default(1);
            $table->primary(['farm_id', 'prefix']);
        });

        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('key', 100);
            $table->string('method', 10);
            $table->string('path');
            $table->unsignedSmallInteger('status');
            $table->longText('response');
            $table->timestamp('created_at')->index();
            $table->unique(['user_id', 'key']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 20);
            $table->string('auditable_type');
            $table->unsignedBigInteger('auditable_id');
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at');
            $table->index(['farm_id', 'auditable_type', 'auditable_id']);
        });

        Schema::create('attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->morphs('attachable');
            $table->string('path');
            $table->string('name');
            $table->string('mime', 100);
            $table->unsignedInteger('size');
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('farm_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('type', 40);
            $table->string('severity', 10)->default('info'); // info | warning | danger
            $table->string('title');
            $table->text('body')->nullable();
            $table->string('link')->nullable();
            $table->string('dedupe_key');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();
            $table->unique(['farm_id', 'dedupe_key']);
            $table->index(['farm_id', 'read_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('farm_notifications');
        Schema::dropIfExists('attachments');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('idempotency_keys');
        Schema::dropIfExists('document_sequences');
        Schema::dropIfExists('farm_user');
        Schema::dropIfExists('farms');
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['phone', 'locale']));
    }
};
