<?php

namespace App\Domain\Backup;

/**
 * Which tables make up one farm's data, in an order where every NOT NULL
 * reference points to a table that comes earlier. Used by export (what to
 * dump) and import (in which order to insert and how to re-map ids).
 *
 *  fk     column => referenced table ('users' is never migrated: set to null)
 *  morph  polymorphic prefixes: <prefix>_type / <prefix>_id
 *  parent child tables without farm_id: column => parent table that has it
 *  bool   boolean columns (normalized so SQL/CSV restore works on any database)
 */
final class BackupSchema
{
    public const VERSION = 1;

    public const TABLES = [
        'accounts' => ['bool' => ['is_system']],
        'employees' => ['fk' => ['user_id' => 'users']],
        'suppliers' => [],
        'customers' => ['fk' => ['employee_id' => 'employees']],
        'animals' => ['fk' => ['mother_id' => 'animals']],
        'animal_weights' => ['fk' => ['animal_id' => 'animals']],
        'animal_events' => ['fk' => ['animal_id' => 'animals', 'related_animal_id' => 'animals', 'user_id' => 'users']],
        'flocks' => [],
        'flock_records' => ['fk' => ['flock_id' => 'flocks', 'user_id' => 'users']],
        'treatments' => ['fk' => ['animal_id' => 'animals', 'flock_id' => 'flocks', 'user_id' => 'users']],
        'vaccinations' => ['fk' => ['animal_id' => 'animals', 'flock_id' => 'flocks', 'user_id' => 'users']],
        'feed_items' => ['fk' => ['supplier_id' => 'suppliers']],
        'milk_records' => ['fk' => ['animal_id' => 'animals', 'user_id' => 'users']],
        'deliveries' => ['fk' => ['customer_id' => 'customers', 'employee_id' => 'employees', 'invoice_id' => 'invoices']],
        'invoices' => ['fk' => ['customer_id' => 'customers', 'user_id' => 'users'], 'morph' => ['source']],
        'invoice_items' => ['parent' => ['invoice_id' => 'invoices']],
        'customer_payments' => ['fk' => ['customer_id' => 'customers', 'user_id' => 'users']],
        'payment_allocations' => ['parent' => ['customer_payment_id' => 'customer_payments'], 'fk' => ['invoice_id' => 'invoices']],
        'bills' => ['fk' => ['supplier_id' => 'suppliers', 'user_id' => 'users'], 'morph' => ['source', 'related']],
        'bill_items' => ['parent' => ['bill_id' => 'bills'], 'fk' => ['feed_item_id' => 'feed_items']],
        'supplier_payments' => ['fk' => ['supplier_id' => 'suppliers', 'user_id' => 'users']],
        'bill_allocations' => ['parent' => ['supplier_payment_id' => 'supplier_payments'], 'fk' => ['bill_id' => 'bills']],
        'inventory_movements' => ['fk' => ['feed_item_id' => 'feed_items', 'user_id' => 'users'], 'morph' => ['target', 'source']],
        'milk_movements' => ['fk' => ['user_id' => 'users'], 'morph' => ['source']],
        'salary_payments' => ['fk' => ['employee_id' => 'employees', 'user_id' => 'users']],
        'farm_tasks' => ['fk' => ['employee_id' => 'employees', 'user_id' => 'users'], 'morph' => ['related']],
        'leads' => ['fk' => ['customer_id' => 'customers']],
        'document_sequences' => ['noid' => true],
        'journal_entries' => ['fk' => ['user_id' => 'users'], 'morph' => ['source']],
        'journal_lines' => ['fk' => ['journal_entry_id' => 'journal_entries', 'account_id' => 'accounts', 'customer_id' => 'customers',
            'supplier_id' => 'suppliers', 'animal_id' => 'animals', 'flock_id' => 'flocks']],
        'farm_notifications' => [],
        'attachments' => ['fk' => ['user_id' => 'users'], 'morph' => ['attachable']],
        'audit_logs' => ['fk' => ['user_id' => 'users'], 'morph' => ['auditable']],
    ];

    /** Farm settings copied on restore (never ids or secrets). */
    public const FARM_FIELDS = ['name', 'address', 'phone', 'email', 'currency', 'timezone', 'locale', 'default_milk_price', 'settings'];
}
