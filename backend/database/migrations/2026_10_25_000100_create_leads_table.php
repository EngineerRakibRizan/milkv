<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Enquiries from the public landing page ("I want daily milk"). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('phone', 20);                 // normalized: 01XXXXXXXXX
            $table->string('area')->nullable();
            $table->string('address')->nullable();
            $table->bigInteger('qty_ml')->default(0);    // requested litres per day
            $table->date('start_date')->nullable();
            $table->string('message', 1000)->nullable();
            $table->string('source', 30)->default('website');
            $table->string('status', 20)->default('new'); // new | contacted | converted | lost
            $table->text('notes')->nullable();            // staff follow-up notes
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('ip', 45)->nullable();
            $table->timestamp('contacted_at')->nullable();
            $table->timestamps();
            $table->index(['farm_id', 'status', 'created_at']);
            $table->index(['farm_id', 'phone']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leads');
    }
};
