<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attachment;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Photos, invoices, receipts and vet documents. Files live on the private
 * disk under the farm's folder and are only served through this controller,
 * after the farm scope has been applied, never by public URL.
 */
class AttachmentController extends Controller
{
    private const TYPES = ['animal', 'flock', 'bill', 'invoice', 'treatment', 'vaccination', 'customer', 'employee'];

    public function index(Request $r)
    {
        $d = $r->validate(['type' => 'required|in:'.implode(',', self::TYPES), 'id' => 'required|integer']);

        return Attachment::where('attachable_type', $d['type'])->where('attachable_id', $d['id'])->latest()->get(['id', 'name', 'mime', 'size', 'created_at']);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'type' => 'required|in:'.implode(',', self::TYPES), 'id' => 'required|integer',
            'file' => 'required|file|max:10240|mimes:jpg,jpeg,png,webp,pdf',
        ]);
        $this->allow(match ($d['type']) { 'animal' => 'animals.update', 'flock' => 'flocks.update', 'bill' => 'bills.create',
            'invoice' => 'invoices.create', 'treatment', 'vaccination' => 'vet.update', 'customer' => 'customers.update', default => 'employees.update' });
        // Farm-scoped lookup proves the parent belongs to this farm.
        Relation::getMorphedModel($d['type'])::findOrFail($d['id']);

        $farmId = $this->current()->id();
        $file = $d['file'];
        $path = $file->store("farms/{$farmId}/{$d['type']}", 'local');
        $a = new Attachment(['attachable_type' => $d['type'], 'attachable_id' => $d['id'], 'path' => $path,
            'name' => mb_substr($file->getClientOriginalName(), 0, 200), 'mime' => $file->getMimeType(), 'size' => $file->getSize(), 'user_id' => $r->user()->id]);
        $a->save();
        if ($d['type'] === 'animal' && str_starts_with($a->mime, 'image/')) {
            \App\Models\Animal::whereKey($d['id'])->update(['photo_path' => $path]);
        }

        return response()->json($a->only(['id', 'name', 'mime', 'size']), 201);
    }

    public function download(int $id)
    {
        $a = Attachment::findOrFail($id);

        return Storage::disk('local')->response($a->path, $a->name, ['Cache-Control' => 'private, max-age=86400']);
    }
}
