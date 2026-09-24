<?php

namespace App\Http\Controllers;

use App\Models\Attendance;
use App\Models\Event;
use App\Models\EventCommittee;
use App\Models\Student;
use Illuminate\Http\Request;

class AttendanceController extends Controller
{
    public function index(Request $request)
    {
        $date = $request->query('date', date('Y-m-d'));
        $eventId = (int) $request->query('event_id', 0);
        $studentId = (int) $request->query('student_id', 0);
        $sessionId = trim($request->query('session_id', ''));
        $all = $request->boolean('all');

        $query = Attendance::query()
            ->with(['student', 'event']);

        if ($eventId > 0) {
            $query->where('event_id', $eventId);
        } elseif ($all) {
            $query->limit(500);
        } elseif ($studentId > 0) {
            $query->where('student_id', $studentId);
        } else {
            $query->where('tap_date', $date);
        }

        if (! empty($sessionId)) {
            $query->where('session_id', $sessionId);
        }

        $query->orderBy('tap_time', 'desc');
        $records = $query->get()->map(function ($a) {
            return [
                'id' => $a->id,
                'uid' => $a->uid,
                'name' => $a->student->name ?? '-',
                'nim' => $a->student->nim ?? '-',
                'category' => $a->student->category ?? 'Anggota',
                'division' => $a->student->division ?? '-',
                'position' => $a->student->position ?? '-',
                'waktu' => $a->tap_time ? $a->tap_time->format('d/m/Y H:i:s') : '-',
                'tap_date' => $a->tap_date ? $a->tap_date->format('Y-m-d') : null,
                'event_id' => $a->event_id,
                'session_id' => $a->session_id ?? 'sesi_1',
                'session_name' => $a->session_name ?? 'Sesi 1 (Datang)',
                'telat' => $a->telat ? 1 : 0,
                'event_name' => $a->event->name ?? 'Kegiatan HIMA Umum',
            ];
        });

        // Hitung target total mahasiswa
        $targetAudience = 'all';
        if ($eventId > 0) {
            $ev = Event::find($eventId);
            if ($ev) {
                $targetAudience = $ev->target_audience;
            }
        } else {
            $ev = Event::active()->first();
            if ($ev) {
                $targetAudience = $ev->target_audience;
            }
        }

        if ($targetAudience === 'committee_only' && $eventId > 0) {
            $totalMhs = EventCommittee::where('event_id', $eventId)->distinct('student_id')->count('student_id');
        } elseif ($targetAudience === 'bpi_bph') {
            $totalMhs = Student::active()->whereIn('category', ['BPI', 'BPH'])->count();
        } else {
            $totalMhs = Student::active()->count();
        }

        $uniqueUids = $records->pluck('uid')->filter()->unique();
        $totalHadir = $uniqueUids->count();
        $totalAlpha = max(0, $totalMhs - $totalHadir);

        return response()->json([
            'success' => true,
            'date' => $date,
            'event_id' => $eventId,
            'session_id' => $sessionId,
            'total_hadir' => $totalHadir,
            'total_alpha' => $totalAlpha,
            'total_mhs' => $totalMhs,
            'data' => $records,
        ]);
    }

    public function destroy(Request $request)
    {
        $id = (int) $request->input('id', 0);
        $date = trim($request->input('date', ''));

        if ($id > 0) {
            Attendance::where('id', $id)->delete();

            return response()->json([
                'success' => true,
                'message' => 'Data absensi berhasil dihapus.',
            ]);
        }

        if (! empty($date)) {
            Attendance::where('tap_date', $date)->delete();

            return response()->json([
                'success' => true,
                'message' => "Semua absensi tanggal {$date} berhasil dihapus.",
            ]);
        }

        return response()->json([
            'success' => false,
            'message' => 'ID atau tanggal absensi tidak valid.',
        ], 400);
    }

    public function toggleLate(Request $request)
    {
        $id = (int) $request->input('id', 0);
        $attendance = Attendance::with('student')->find($id);

        if (! $attendance) {
            return response()->json([
                'success' => false,
                'message' => 'Data absensi tidak ditemukan.',
            ], 404);
        }

        $explicitTelat = $request->has('telat') ? $request->boolean('telat') : null;
        $newTelat = $explicitTelat !== null ? $explicitTelat : ! $attendance->telat;

        $attendance->telat = $newTelat;
        $attendance->save();

        return response()->json([
            'success' => true,
            'message' => 'Status kehadiran berhasil diperbarui.',
            'id' => $attendance->id,
            'name' => $attendance->student->name ?? '-',
            'telat' => $newTelat ? 1 : 0,
        ]);
    }
}
