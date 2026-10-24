<?php

use App\Http\Middleware\Idempotency;
use App\Http\Middleware\ResolveFarm;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(__DIR__.'/../routes/channels.php', ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum', 'farm']])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['farm' => ResolveFarm::class, 'idempotent' => Idempotency::class]);
        // The tenant must be resolved before route-model binding runs, so a
        // bound model is always looked up inside the current farm's scope.
        $middleware->prependToPriorityList(SubstituteBindings::class, ResolveFarm::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
