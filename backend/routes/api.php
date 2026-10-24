<?php

use App\Http\Controllers\Api\AttachmentController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\FarmController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\LivestockController;
use App\Http\Controllers\Api\MilkController;
use App\Http\Controllers\Api\PoultryController;
use App\Http\Controllers\Api\PurchasingController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SalesController;
use App\Http\Controllers\Api\TeamController;
use App\Http\Controllers\Api\VetController;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:auth')->group(function () {
    Route::post('auth/register', [AuthController::class, 'register']);
    Route::post('auth/login', [AuthController::class, 'login']);
});

Route::middleware(['auth:sanctum', 'throttle:api', 'idempotent'])->group(function () {
    Route::get('auth/me', [AuthController::class, 'me']);
    Route::post('auth/logout', [AuthController::class, 'logout']);

    // Everything below is tenant-scoped by the X-Farm-Id header.
    Route::middleware('farm')->group(function () {

        Route::get('dashboard', [ReportController::class, 'dashboard']);
        Route::get('reports/{type}', [ReportController::class, 'show']);

        Route::get('farm', [FarmController::class, 'show']);
        Route::put('farm', [FarmController::class, 'update']);
        Route::get('farm/members', [FarmController::class, 'members']);
        Route::post('farm/members', [FarmController::class, 'addMember']);
        Route::patch('farm/members/{user}', [FarmController::class, 'updateMember']);
        Route::get('accounts', [FarmController::class, 'accounts']);
        Route::post('accounts', [FarmController::class, 'addAccount']);
        Route::get('audit', [FarmController::class, 'audit']);

        Route::get('animals', [LivestockController::class, 'index']);
        Route::post('animals', [LivestockController::class, 'store']);
        Route::get('animals/{id}', [LivestockController::class, 'show'])->whereNumber('id');
        Route::put('animals/{animal}', [LivestockController::class, 'update']);
        Route::delete('animals/{animal}', [LivestockController::class, 'destroy']);
        Route::post('animals/{id}/restore', [LivestockController::class, 'restore']);
        Route::post('animals/{animal}/weights', [LivestockController::class, 'addWeight']);
        Route::post('animals/{animal}/events', [LivestockController::class, 'addEvent']);
        Route::post('animals/{animal}/status', [LivestockController::class, 'changeStatus']);

        Route::get('flocks', [PoultryController::class, 'index']);
        Route::post('flocks', [PoultryController::class, 'store']);
        Route::get('flocks/{id}', [PoultryController::class, 'show'])->whereNumber('id');
        Route::put('flocks/{flock}', [PoultryController::class, 'update']);
        Route::post('flocks/{flock}/records', [PoultryController::class, 'storeRecord']);

        Route::get('inventory', [InventoryController::class, 'index']);
        Route::post('inventory', [InventoryController::class, 'store']);
        Route::put('inventory/{feedItem}', [InventoryController::class, 'update']);
        Route::post('inventory/{feedItem}/adjust', [InventoryController::class, 'adjust']);
        Route::get('inventory-movements', [InventoryController::class, 'movements']);
        Route::post('inventory-issues', [InventoryController::class, 'issue']);

        Route::get('treatments', [VetController::class, 'treatments']);
        Route::post('treatments', [VetController::class, 'storeTreatment']);
        Route::put('treatments/{treatment}', [VetController::class, 'updateTreatment']);
        Route::get('vaccinations', [VetController::class, 'vaccinations']);
        Route::post('vaccinations', [VetController::class, 'storeVaccination']);
        Route::put('vaccinations/{vaccination}', [VetController::class, 'updateVaccination']);

        Route::get('milk/sheet', [MilkController::class, 'sheet']);
        Route::post('milk/sheet', [MilkController::class, 'saveSheet']);
        Route::post('milk/out', [MilkController::class, 'out']);
        Route::get('milk/movements', [MilkController::class, 'movements']);
        Route::get('milk/history', [MilkController::class, 'history']);

        Route::get('customers', [CustomerController::class, 'index']);
        Route::post('customers', [CustomerController::class, 'store']);
        Route::get('customers/{id}', [CustomerController::class, 'show'])->whereNumber('id');
        Route::get('customers/{id}/statement', [CustomerController::class, 'statement']);
        Route::put('customers/{customer}', [CustomerController::class, 'update']);
        Route::delete('customers/{customer}', [CustomerController::class, 'destroy']);

        Route::get('deliveries', [SalesController::class, 'deliveries']);
        Route::post('deliveries', [SalesController::class, 'storeDelivery']);
        Route::post('deliveries/generate', [SalesController::class, 'generate']);
        Route::patch('deliveries/{delivery}', [SalesController::class, 'updateDelivery']);
        Route::get('invoices', [SalesController::class, 'invoices']);
        Route::post('invoices', [SalesController::class, 'storeInvoice']);
        Route::get('invoices/{invoice}', [SalesController::class, 'showInvoice']);
        Route::post('invoices/{invoice}/void', [SalesController::class, 'voidInvoice']);
        Route::get('payments', [SalesController::class, 'payments']);
        Route::post('payments', [SalesController::class, 'storePayment']);

        Route::get('suppliers', [PurchasingController::class, 'suppliers']);
        Route::post('suppliers', [PurchasingController::class, 'storeSupplier']);
        Route::get('suppliers/{id}', [PurchasingController::class, 'showSupplier'])->whereNumber('id');
        Route::put('suppliers/{supplier}', [PurchasingController::class, 'updateSupplier']);
        Route::get('bills', [PurchasingController::class, 'bills']);
        Route::post('bills', [PurchasingController::class, 'storeBill']);
        Route::get('bills/{bill}', [PurchasingController::class, 'showBill']);
        Route::post('bills/{bill}/void', [PurchasingController::class, 'voidBill']);
        Route::post('supplier-payments', [PurchasingController::class, 'storePayment']);

        Route::get('employees', [TeamController::class, 'employees']);
        Route::post('employees', [TeamController::class, 'storeEmployee']);
        Route::get('employees/{id}', [TeamController::class, 'showEmployee'])->whereNumber('id');
        Route::put('employees/{employee}', [TeamController::class, 'updateEmployee']);
        Route::post('employees/{employee}/salary', [TeamController::class, 'paySalary']);
        Route::get('tasks', [TeamController::class, 'tasks']);
        Route::post('tasks', [TeamController::class, 'storeTask']);
        Route::patch('tasks/{task}', [TeamController::class, 'updateTask']);
        Route::get('notifications', [TeamController::class, 'notifications']);
        Route::post('notifications/read', [TeamController::class, 'readNotifications']);

        Route::get('attachments', [AttachmentController::class, 'index']);
        Route::post('attachments', [AttachmentController::class, 'store']);
        Route::get('attachments/{id}', [AttachmentController::class, 'download']);
    });
});
