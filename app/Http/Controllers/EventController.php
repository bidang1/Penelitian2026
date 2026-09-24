<?php

namespace App\Http\Controllers;

use App\Models\Event;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EventController extends Controller
{
    public function index()
    {
        $events = Event::query()
            ->withCount([
                'attendances as total_hadir' => function ($q) {
                    $q->select(DB::raw('count(distinct student_id)'));
                },
                'committees as total_panitia',
            ])
            ->orderBy('is_active', 'desc')
            ->orderBy('event_date', 'desc')
            ->orderBy('id', 'desc')
            ->get();

        $activeEvent = $events->firstWhere('is_active', true);

        return response()->json([
            'success' => true,
            'active_event' => $activeEvent,
            'data' => $events,
        ]);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'description' => 'nullable|string',
            'event_date' => 'required|date',
            'start_time' => 'nullable|string',
            'end_time' => 'nullable|string',
            'target_audience' => 'nullable|in:all,committee_only,bpi_bph',
            'is_active' => 'nullable|boolean',
        ]);

        $isActive = $request->boolean('is_active');

        DB::beginTransaction();
        try {
            if ($isActive) {
                Event::where('is_active', true)->update(['is_active' => false]);
            }

            $event = Event::create([
                'name' => strip_tags(trim($validated['name'])),
                'description' => isset($validated['description']) ? strip_tags(trim($validated['description'])) : null,
                'event_date' => $validated['event_date'],
                'start_time' => $validated['start_time'] ?? '08:00:00',
                'end_time' => $validated['end_time'] ?: null,
                'target_audience' => $validated['target_audience'] ?? 'committee_only',
                'is_active' => $isActive,
            ]);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Program kerja atau acara berhasil dibuat.',
                'id' => $event->id,
                'data' => $event,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'success' => false,
                'message' => 'Gagal membuat program kerja: '.$e->getMessage(),
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        $event = Event::findOrFail($id);
        $action = $request->input('action');

        if ($action === 'set_active') {
            DB::transaction(function () use ($event) {
                Event::where('is_active', true)->update(['is_active' => false]);
                $event->update(['is_active' => true]);
            });

            return response()->json([
                'success' => true,
                'message' => 'Acara berhasil diaktifkan untuk presensi.',
            ]);
        }

        if ($action === 'set_inactive') {
            $event->update(['is_active' => false]);

            return response()->json([
                'success' => true,
                'message' => 'Acara berhasil dinonaktifkan.',
            ]);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'description' => 'nullable|string',
            'event_date' => 'required|date',
            'start_time' => 'nullable|string',
            'end_time' => 'nullable|string',
            'target_audience' => 'nullable|in:all,committee_only,bpi_bph',
            'is_active' => 'nullable|boolean',
        ]);

        $isActive = $request->boolean('is_active');

        DB::transaction(function () use ($event, $validated, $isActive) {
            if ($isActive) {
                Event::where('id', '!=', $event->id)->where('is_active', true)->update(['is_active' => false]);
            }

            $event->update([
                'name' => strip_tags(trim($validated['name'])),
                'description' => isset($validated['description']) ? strip_tags(trim($validated['description'])) : null,
                'event_date' => $validated['event_date'],
                'start_time' => $validated['start_time'] ?? '08:00:00',
                'end_time' => $validated['end_time'] ?: null,
                'target_audience' => $validated['target_audience'] ?? 'all',
                'is_active' => $isActive,
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'Data acara berhasil diperbarui.',
            'data' => $event,
        ]);
    }

    public function destroy($id)
    {
        $event = Event::findOrFail($id);
        $event->delete();

        return response()->json([
            'success' => true,
            'message' => 'Program kerja atau acara berhasil dihapus.',
        ]);
    }
}
