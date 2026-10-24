<?php

namespace App\Http\Controllers\Api;

use App\Domain\Purchasing\PurchasingService;
use App\Http\Controllers\Controller;
use App\Http\Resources\Present;
use App\Models\Employee;
use App\Models\FarmNotification;
use App\Models\FarmTask;
use App\Models\SalaryPayment;
use App\Support\FarmChanges;
use App\Support\Units;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Employees, salaries, farm tasks and notifications. */
class TeamController extends Controller
{
    public function employees(Request $r)
    {
        $this->allow('employees.view');

        return Employee::query()
            ->when($r->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($r->query('search'), fn ($q, $s) => $q->where(fn ($q) => $q->where('name', 'like', "%{$s}%")->orWhere('phone', 'like', "%{$s}%")))
            ->orderBy('name')->get()->map([Present::class, 'employee']);
    }

    public function showEmployee(int $id)
    {
        $this->allow('employees.view');
        $e = Employee::withTrashed()->findOrFail($id);
        $payments = SalaryPayment::where('employee_id', $id)->orderByDesc('date')->get();
        $advances = (int) $payments->where('type', 'advance')->sum('gross') - (int) $payments->sum('deduction');

        return [
            'employee' => Present::employee($e),
            'outstanding_advance' => Units::m($advances),
            'payments' => $payments->map(fn ($p) => ['id' => $p->id, 'type' => $p->type, 'period' => $p->period, 'date' => $p->date->toDateString(),
                'gross' => Units::m($p->gross), 'deduction' => Units::m($p->deduction), 'net' => Units::m($p->net), 'method' => $p->method, 'notes' => $p->notes]),
            'tasks' => FarmTask::where('employee_id', $id)->whereIn('status', ['pending', 'in_progress'])->orderBy('due_date')->get()->map([Present::class, 'task']),
        ];
    }

    public function storeEmployee(Request $r)
    {
        $this->allow('employees.create');
        $d = $this->convert($this->employeeData($r), ['salary']);
        $d['code'] ??= 'E-'.str_pad((string) (Employee::withTrashed()->count() + 1), 3, '0', STR_PAD_LEFT);
        $e = Employee::create($d)->refresh();
        FarmChanges::touch('employees');

        return response()->json(Present::employee($e), 201);
    }

    public function updateEmployee(Request $r, Employee $employee)
    {
        $this->allow('employees.update');
        $employee->update($this->convert($this->employeeData($r, $employee), ['salary']));
        FarmChanges::touch('employees');

        return Present::employee($employee);
    }

    public function paySalary(Request $r, Employee $employee, PurchasingService $service)
    {
        $this->allow('salaries.create');
        $d = $r->validate([
            'type' => 'required|in:salary,advance,bonus', 'period' => 'nullable|date_format:Y-m',
            'date' => 'required|date|before_or_equal:today', 'gross' => 'required|numeric|gt:0', 'deduction' => 'nullable|numeric|min:0',
            'method' => ['required', Rule::in(config('farmos.payment_methods'))], 'notes' => 'nullable|string|max:255',
        ]);
        $p = $service->paySalary($employee, $this->convert($d, ['gross', 'deduction']));

        return response()->json(['id' => $p->id, 'net' => Units::m($p->net)], 201);
    }

    public function tasks(Request $r)
    {
        $this->allow('tasks.view');
        $today = today()->toDateString();
        $q = FarmTask::with('employee:id,name')
            ->when($r->query('view', 'open') === 'open', fn ($q) => $q->whereIn('status', ['pending', 'in_progress']))
            ->when($r->query('view') === 'today', fn ($q) => $q->where('due_date', $today))
            ->when($r->query('view') === 'overdue', fn ($q) => $q->whereIn('status', ['pending', 'in_progress'])->where('due_date', '<', $today))
            ->when($r->query('view') === 'done', fn ($q) => $q->whereIn('status', ['completed', 'cancelled']))
            ->when($r->query('employee_id'), fn ($q, $e) => $q->where('employee_id', $e));
        if (in_array($this->current()->role(), ['worker', 'delivery', 'vet'], true)) {
            $q->where('employee_id', Employee::where('user_id', $r->user()->id)->value('id') ?? 0);
        }

        return $q->orderBy('due_date', $r->query('view') === 'done' ? 'desc' : 'asc')->orderBy('due_time')->limit(300)->get()->map([Present::class, 'task']);
    }

    public function storeTask(Request $r)
    {
        $this->allow('tasks.create');
        $t = FarmTask::create($this->taskData($r) + ['user_id' => $r->user()->id])->refresh();
        FarmChanges::touch('tasks');

        return response()->json(Present::task($t->load('employee:id,name')), 201);
    }

    /** Edit or move status. Completing a recurring task schedules its next occurrence. */
    public function updateTask(Request $r, FarmTask $task)
    {
        $this->allow('tasks.update');
        $limited = in_array($this->current()->role(), ['worker', 'delivery', 'vet'], true);
        $d = $limited ? $r->validate(['status' => 'required|in:pending,in_progress,completed']) : $this->taskData($r, partial: true);

        if (($d['status'] ?? null) === 'completed' && $task->status !== 'completed') {
            $d['completed_at'] = now();
            if ($task->recurrence !== 'none') {
                $next = CarbonImmutable::parse($task->due_date);
                $next = match ($task->recurrence) { 'daily' => $next->addDay(), 'weekly' => $next->addWeek(), default => $next->addMonth() };
                FarmTask::create($task->only(['title', 'description', 'employee_id', 'due_time', 'priority', 'recurrence', 'related_type', 'related_id'])
                    + ['due_date' => $next->toDateString(), 'status' => 'pending', 'user_id' => $task->user_id]);
            }
        }
        $task->update($d);
        FarmChanges::touch('tasks');

        return Present::task($task->load('employee:id,name'));
    }

    public function notifications(Request $r)
    {
        $this->allow('notifications.view');
        $q = FarmNotification::query()->when($r->boolean('unread'), fn ($q) => $q->whereNull('read_at'))->latest('id');

        return Present::page($q->paginate($this->perPage($r)), fn ($n) => $n->only(['id', 'type', 'severity', 'title', 'body', 'link'])
            + ['read' => $n->read_at !== null, 'created_at' => $n->created_at->toIso8601String()],
            ['unread' => FarmNotification::whereNull('read_at')->count()]);
    }

    public function readNotifications(Request $r)
    {
        $this->allow('notifications.view');
        $ids = $r->validate(['ids' => 'nullable|array', 'ids.*' => 'integer'])['ids'] ?? null;
        FarmNotification::whereNull('read_at')->when($ids, fn ($q) => $q->whereIn('id', $ids))->update(['read_at' => now()]);
        FarmChanges::touch('notifications');

        return response()->noContent();
    }

    private function employeeData(Request $r, ?Employee $e = null): array
    {
        $farm = $this->current()->id();

        return $r->validate([
            'code' => ['nullable', 'string', 'max:30', Rule::unique('employees')->where('farm_id', $farm)->ignore($e?->id)],
            'name' => 'required|string|max:120', 'phone' => ['nullable', 'string', 'max:20', 'regex:/^\+?[0-9 \-]{6,20}$/'],
            'address' => 'nullable|string|max:255', 'title' => 'nullable|string|max:80', 'joined_at' => 'nullable|date',
            'salary' => 'nullable|numeric|min:0', 'status' => 'required|in:active,inactive',
            'emergency_contact' => 'nullable|string|max:120', 'route' => 'nullable|string|max:80', 'notes' => 'nullable|string|max:1000',
            'user_id' => ['nullable', 'integer', Rule::exists('farm_user', 'user_id')->where('farm_id', $farm)],
        ]);
    }

    private function taskData(Request $r, bool $partial = false): array
    {
        $req = $partial ? 'sometimes|required' : 'required';

        return $r->validate([
            'title' => "{$req}|string|max:160", 'description' => 'nullable|string|max:2000',
            'employee_id' => ['nullable', 'integer', Rule::exists('employees', 'id')->where('farm_id', $this->current()->id())],
            'due_date' => "{$req}|date", 'due_time' => 'nullable|date_format:H:i',
            'priority' => "{$req}|in:low,normal,high", 'recurrence' => 'sometimes|in:none,daily,weekly,monthly',
            'status' => 'sometimes|in:pending,in_progress,completed,cancelled',
            'related_type' => 'nullable|in:animal,flock,feed_item', 'related_id' => 'nullable|integer',
        ]);
    }
}
