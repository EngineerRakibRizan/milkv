<?php

/*
| FarmOS domain configuration: roles/abilities and the default chart of
| accounts. Categories shown to users ARE accounts, so income/expense
| reports always reconcile with the journal.
*/

return [

    // Public self-signup (creates a new farm). Turn off on a single-farm production server;
    // create the owner with `php artisan farmos:create-owner` instead.
    'registration' => (bool) env('FARMOS_REGISTRATION', true),

    // Abilities are "<module>.<action>". "module.*" grants every action in it.
    'roles' => [
        'owner' => ['*'],
        'manager' => [
            'dashboard.view', 'animals.*', 'flocks.*', 'inventory.*', 'vet.*', 'milk.*', 'deliveries.*',
            'customers.*', 'leads.*', 'payments.create', 'invoices.view', 'invoices.create', 'suppliers.*', 'bills.*',
            'employees.view', 'tasks.*', 'notifications.*', 'reports.operational',
        ],
        'vet' => ['dashboard.view', 'animals.view', 'flocks.view', 'vet.*', 'tasks.view', 'tasks.update', 'notifications.view'],
        'accountant' => [
            'dashboard.view', 'dashboard.finance', 'customers.view', 'invoices.*', 'payments.*', 'suppliers.*', 'bills.*',
            'salaries.*', 'employees.view', 'reports.*', 'deliveries.view', 'inventory.view', 'notifications.view',
        ],
        'delivery' => ['deliveries.view', 'deliveries.update', 'customers.view', 'payments.create', 'tasks.view', 'tasks.update', 'notifications.view'],
        'worker' => [
            'dashboard.view', 'animals.view', 'flocks.view', 'flocks.record', 'milk.view', 'milk.record',
            'inventory.view', 'inventory.consume', 'tasks.view', 'tasks.update', 'notifications.view',
        ],
    ],

    'payment_methods' => ['cash', 'bank', 'bkash', 'nagad', 'rocket', 'other'],

    // Which cash-type account each payment method settles into.
    'method_accounts' => [
        'cash' => 'cash', 'bank' => 'bank', 'bkash' => 'mobile_wallet', 'nagad' => 'mobile_wallet',
        'rocket' => 'mobile_wallet', 'other' => 'cash',
    ],

    'feed_categories' => ['cow_feed', 'calf_feed', 'hen_feed', 'duck_feed', 'concentrate', 'green_fodder', 'hay_silage', 'rice_bran', 'supplement', 'medicine', 'other'],

    'units' => ['kg', 'l', 'bag', 'pcs'],

    // key => [code, name, type, group]
    'chart_of_accounts' => [
        'cash' => ['1000', 'Cash in hand', 'asset', 'cash'],
        'bank' => ['1010', 'Bank account', 'asset', 'cash'],
        'mobile_wallet' => ['1020', 'Mobile wallet (bKash/Nagad/Rocket)', 'asset', 'cash'],
        'ar' => ['1100', 'Accounts receivable', 'asset', 'receivable'],
        'staff_advances' => ['1150', 'Staff advances', 'asset', 'current'],
        'feed_inventory' => ['1200', 'Feed & supplies inventory', 'asset', 'inventory'],
        'livestock_assets' => ['1500', 'Livestock (capital)', 'asset', 'capital'],
        'equipment_assets' => ['1510', 'Equipment & buildings', 'asset', 'capital'],
        'ap' => ['2000', 'Accounts payable', 'liability', 'payable'],
        'owner_equity' => ['3000', 'Owner equity', 'equity', 'equity'],

        'milk_sales' => ['4000', 'Milk sales', 'revenue', 'sales'],
        'egg_sales' => ['4010', 'Egg sales', 'revenue', 'sales'],
        'animal_sales' => ['4020', 'Cow & calf sales', 'revenue', 'sales'],
        'poultry_sales' => ['4030', 'Hen & duck sales', 'revenue', 'sales'],
        'manure_sales' => ['4040', 'Manure sales', 'revenue', 'sales'],
        'other_income' => ['4900', 'Other income', 'revenue', 'other'],

        'feed_expense' => ['5000', 'Feed consumed', 'expense', 'direct'],
        'inventory_loss' => ['5010', 'Feed wastage & spoilage', 'expense', 'direct'],
        'vet_expense' => ['5100', 'Veterinary treatment', 'expense', 'direct'],
        'vaccine_expense' => ['5110', 'Vaccinations', 'expense', 'direct'],
        'medicine_expense' => ['5120', 'Medicines', 'expense', 'direct'],
        'salaries' => ['5200', 'Labour & salaries', 'expense', 'operating'],
        'electricity' => ['5300', 'Electricity', 'expense', 'operating'],
        'water' => ['5310', 'Water', 'expense', 'operating'],
        'fuel_transport' => ['5320', 'Fuel & transport', 'expense', 'operating'],
        'delivery_expense' => ['5330', 'Milk delivery costs', 'expense', 'operating'],
        'packaging' => ['5340', 'Packaging', 'expense', 'operating'],
        'maintenance' => ['5400', 'Repairs & maintenance', 'expense', 'operating'],
        'rent' => ['5410', 'Rent', 'expense', 'operating'],
        'admin_expense' => ['5500', 'Administrative', 'expense', 'operating'],
        'other_expense' => ['5900', 'Other expenses', 'expense', 'operating'],
    ],
];
