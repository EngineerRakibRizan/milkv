<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Inventory, milk, customers, suppliers, sales, purchases, accounting. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('phone', 20)->nullable();
            $table->string('address')->nullable();
            $table->string('type', 30)->nullable(); // feed | medicine | equipment | other
            $table->bigInteger('balance')->default(0); // payable, paisa (cached from bills - payments)
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['farm_id', 'name']);
        });

        Schema::create('feed_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('sku', 40);
            $table->string('name');
            $table->string('category', 30);
            $table->string('unit', 10);                        // kg | l | bag | pcs
            $table->bigInteger('stock_milli')->default(0);     // cached sum of inventory_movements
            $table->bigInteger('stock_value')->default(0);     // cached, paisa
            $table->bigInteger('min_stock_milli')->default(0);
            $table->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $table->string('location')->nullable();
            $table->date('expires_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['farm_id', 'sku']);
        });

        Schema::create('inventory_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('feed_item_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->string('type', 20); // opening | purchase | consumption | wastage | spoilage | adjustment
            $table->bigInteger('qty_milli');   // signed
            $table->bigInteger('unit_cost');   // paisa per unit at time of movement
            $table->bigInteger('value');       // signed, paisa
            $table->nullableMorphs('target');  // animal or flock that consumed it
            $table->nullableMorphs('source');  // bill etc.
            $table->string('batch_no')->nullable();
            $table->string('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['farm_id', 'feed_item_id', 'date']);
            $table->index(['farm_id', 'type', 'date']);
        });

        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('code', 30);
            $table->string('name');
            $table->string('phone', 20)->nullable();
            $table->string('alt_phone', 20)->nullable();
            $table->string('address')->nullable();
            $table->string('area')->nullable();
            $table->string('type', 20)->default('household'); // household | shop | restaurant | wholesale
            $table->bigInteger('default_qty_ml')->default(0);
            $table->bigInteger('price')->nullable();          // paisa per litre; null = farm default
            $table->string('schedule', 20)->default('daily'); // daily | alternate | weekly | on_demand
            $table->string('payment_terms', 20)->default('monthly');
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete(); // delivery person
            $table->string('status', 20)->default('active');  // active | paused | inactive
            $table->bigInteger('balance')->default(0);        // receivable (positive = owes us)
            $table->date('joined_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['farm_id', 'code']);
            $table->index(['farm_id', 'status']);
            $table->index(['farm_id', 'phone']);
        });

        Schema::create('milk_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('animal_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->bigInteger('morning_ml')->default(0);
            $table->bigInteger('evening_ml')->default(0);
            $table->bigInteger('other_ml')->default(0);
            $table->bigInteger('total_ml')->default(0);
            $table->string('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->unique(['animal_id', 'date']);
            $table->index(['farm_id', 'date']);
        });

        Schema::create('milk_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->string('type', 20); // production | internal_use | spoilage | delivery | adjustment
            $table->bigInteger('qty_ml'); // signed
            $table->nullableMorphs('source');
            $table->string('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['farm_id', 'date', 'type']);
            $table->unique(['source_type', 'source_id', 'type']);
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('number', 30);
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->date('date');
            $table->date('due_date')->nullable();
            $table->string('category', 30);   // revenue account key: milk_sales | egg_sales | ...
            $table->string('description')->nullable();
            $table->bigInteger('subtotal');
            $table->bigInteger('discount')->default(0);
            $table->bigInteger('total');
            $table->bigInteger('paid')->default(0);
            $table->string('status', 20)->default('unpaid'); // unpaid | partial | paid | void
            $table->nullableMorphs('source');                // delivery, animal, flock
            $table->text('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->unique(['farm_id', 'number']);
            $table->unique(['source_type', 'source_id']);
            $table->index(['farm_id', 'customer_id', 'status']);
            $table->index(['farm_id', 'date']);
        });

        Schema::create('invoice_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->string('description');
            $table->bigInteger('qty_milli');
            $table->bigInteger('unit_price');
            $table->bigInteger('amount');
        });

        Schema::create('deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->bigInteger('ordered_ml');
            $table->bigInteger('delivered_ml')->default(0);
            $table->bigInteger('unit_price');            // paisa per litre
            $table->bigInteger('discount')->default(0);
            $table->bigInteger('amount')->default(0);    // of the delivered quantity
            $table->string('status', 20)->default('pending');
            $table->timestamp('delivered_at')->nullable();
            $table->foreignId('invoice_id')->nullable()->constrained()->nullOnDelete();
            $table->string('notes')->nullable();
            $table->timestamps();
            $table->unique(['customer_id', 'date']);
            $table->index(['farm_id', 'date', 'status']);
        });

        Schema::create('customer_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->date('date');
            $table->bigInteger('amount');
            $table->bigInteger('unallocated')->default(0);
            $table->string('method', 20);   // cash | bank | bkash | nagad | rocket | other
            $table->string('reference')->nullable();
            $table->string('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['farm_id', 'date']);
            $table->index(['farm_id', 'customer_id']);
        });

        Schema::create('payment_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_payment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->bigInteger('amount');
            $table->timestamps();
        });

        Schema::create('bills', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('number', 30);
            $table->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $table->date('date');
            $table->date('due_date')->nullable();
            $table->string('kind', 20);        // purchase (inventory) | expense | asset
            $table->string('category', 40);    // expense/asset account key
            $table->string('description')->nullable();
            $table->bigInteger('subtotal');
            $table->bigInteger('discount')->default(0);
            $table->bigInteger('extra_cost')->default(0);
            $table->bigInteger('total');
            $table->bigInteger('paid')->default(0);
            $table->string('status', 20)->default('unpaid'); // unpaid | partial | paid | void
            $table->nullableMorphs('source');   // treatment, vaccination, animal purchase
            $table->nullableMorphs('related');  // animal / flock for cost analysis
            $table->text('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->unique(['farm_id', 'number']);
            $table->unique(['source_type', 'source_id']);
            $table->index(['farm_id', 'date']);
            $table->index(['farm_id', 'supplier_id', 'status']);
        });

        Schema::create('bill_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bill_id')->constrained()->cascadeOnDelete();
            $table->foreignId('feed_item_id')->nullable()->constrained()->nullOnDelete();
            $table->string('description');
            $table->bigInteger('qty_milli');
            $table->bigInteger('unit_price');
            $table->bigInteger('amount');
        });

        Schema::create('supplier_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $table->date('date');
            $table->bigInteger('amount');
            $table->bigInteger('unallocated')->default(0);
            $table->string('method', 20);
            $table->string('reference')->nullable();
            $table->string('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['farm_id', 'date']);
        });

        Schema::create('bill_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('supplier_payment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('bill_id')->constrained()->cascadeOnDelete();
            $table->bigInteger('amount');
            $table->timestamps();
        });

        Schema::create('salary_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);         // salary | advance | bonus
            $table->string('period', 7)->nullable(); // YYYY-MM
            $table->date('date');
            $table->bigInteger('gross');
            $table->bigInteger('deduction')->default(0); // recovers earlier advances
            $table->bigInteger('net');
            $table->string('method', 20);
            $table->string('notes')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['farm_id', 'employee_id', 'date']);
        });

        // ---- Double-entry accounting -------------------------------------
        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->string('key', 40);       // stable system key: cash, ar, milk_sales, feed_expense, ...
            $table->string('code', 10);
            $table->string('name');
            $table->string('type', 10);      // asset | liability | equity | revenue | expense
            $table->string('section', 20)->nullable(); // cash | operating | cogs | capital ...
            $table->boolean('is_system')->default(true);
            $table->timestamps();
            $table->unique(['farm_id', 'key']);
        });

        Schema::create('journal_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->string('memo');
            $table->string('source_type');
            $table->unsignedBigInteger('source_id');
            $table->string('kind', 20)->default('main'); // allows e.g. main + reversal for one source
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            // The guarantee against double posting.
            $table->unique(['source_type', 'source_id', 'kind']);
            $table->index(['farm_id', 'date']);
        });

        Schema::create('journal_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('journal_entry_id')->constrained()->cascadeOnDelete();
            $table->foreignId('farm_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained();
            $table->date('date');                 // denormalized for fast period reports
            $table->bigInteger('debit')->default(0);
            $table->bigInteger('credit')->default(0);
            // Analysis dimensions for statements and profitability.
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('animal_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('flock_id')->nullable()->constrained()->nullOnDelete();
            $table->index(['farm_id', 'account_id', 'date']);
            $table->index(['farm_id', 'customer_id']);
            $table->index(['farm_id', 'animal_id']);
            $table->index(['farm_id', 'flock_id']);
        });
    }

    public function down(): void
    {
        foreach (['journal_lines', 'journal_entries', 'accounts', 'salary_payments', 'bill_allocations', 'supplier_payments', 'bill_items', 'bills',
            'payment_allocations', 'customer_payments', 'deliveries', 'invoice_items', 'invoices', 'milk_movements',
            'milk_records', 'customers', 'inventory_movements', 'feed_items', 'suppliers'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
