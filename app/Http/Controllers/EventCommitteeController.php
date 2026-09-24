<?php

namespace App\Http\Controllers;

use App\Models\EventCommittee;
use App\Models\Student;
use Illuminate\Http\Request;

class EventCommitteeController extends Controller
{
    public function index(Request $request)
    {
        $eventId = (int) $request->query('event_id', 0);
        if (! $eventId) {
            return response()->json(['success' => false, 'message' => 'event_id wajib disertakan.'], 400);
        }

        $committees = EventCommittee::query()
            ->with('student')
            ->where('event_id', $eventId)
            ->get()
            ->map(function ($ec) {
                return [
                    'id' => $ec->id,
                    'event_id' => $ec->event_id,
                    'student_id' => $ec->student_id,
                    'role' => $ec->role,
                    'committee_division' => $ec->division,
                    'created_at' => $ec->created_at ? $ec->created_at->format('Y-m-d H:i:s') : null,
                    'name' => $ec->student->name ?? '-',
                    'nim' => $ec->student->nim ?? '-',
                    'uid' => $ec->student->uid ?? '-',
                    'category' => $ec->student->category ?? 'Anggota',
                    'student_division' => $ec->student->division ?? '-',
                    'student_position' => $ec->student->position ?? '-',
                ];
            })
            ->sortBy(function ($item) {
                $role = strtolower($item['role']);
                if (str_contains($role, 'ketua panitia')) {
                    return 1;
                }
                if (str_contains($role, 'wakil')) {
                    return 2;
                }
                if (str_contains($role, 'sekretaris')) {
                    return 3;
                }
                if (str_contains($role, 'bendahara')) {
                    return 4;
                }
                if (str_contains($role, 'steering') || str_contains($role, 'sc')) {
                    return 5;
                }
                if (str_contains($role, 'koordinator') || str_contains($role, 'koor')) {
                    return 6;
                }

                return 7;
            })
            ->values();

        return response()->json([
            'success' => true,
            'event_id' => $eventId,
            'count' => $committees->count(),
            'data' => $committees,
        ]);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'event_id' => 'required|integer',
            'student_id' => 'nullable|integer',
            'uid' => 'nullable|string',
            'role' => 'required|string|max:100',
            'division' => 'nullable|string|max:100',
        ]);

        $studentId = $validated['student_id'] ?? null;
        if (! $studentId && ! empty($validated['uid'])) {
            $student = Student::where('uid', strtoupper(trim($validated['uid'])))->first();
            if ($student) {
                $studentId = $student->id;
            }
        }

        if (! $studentId) {
            return response()->json([
                'success' => false,
                'message' => 'Mahasiswa tidak ditemukan atau student_id tidak valid.',
            ], 400);
        }

        $committee = EventCommittee::updateOrCreate(
            [
                'event_id' => $validated['event_id'],
                'student_id' => $studentId,
            ],
            [
                'role' => strip_tags(trim($validated['role'])),
                'division' => isset($validated['division']) ? strip_tags(trim($validated['division'])) : null,
            ]
        );

        return response()->json([
            'success' => true,
            'message' => 'Panitia berhasil ditugaskan ke acara.',
            'data' => $committee,
        ]);
    }

    public function destroy(Request $request, $id = null)
    {
        $committeeId = $id ?: $request->input('id');
        $eventId = $request->input('event_id');
        $studentId = $request->input('student_id');

        if ($committeeId) {
            EventCommittee::where('id', $committeeId)->delete();
        } elseif ($eventId && $studentId) {
            EventCommittee::where('event_id', $eventId)->where('student_id', $studentId)->delete();
        } else {
            return response()->json([
                'success' => false,
                'message' => 'ID panitia tidak valid.',
            ], 400);
        }

        return response()->json([
            'success' => true,
            'message' => 'Panitia berhasil dihapus dari acara.',
        ]);
    }
}
