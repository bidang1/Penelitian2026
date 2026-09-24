<?php

namespace App\Http\Controllers;

use App\Models\Attendance;
use App\Models\Event;
use App\Models\EventCommittee;
use App\Models\Student;
use App\Models\UnknownCard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class DeviceApiController extends Controller
{
    /**
     * Check UID when tapped by ESP8266 or dashboard.
     */
    public function checkUid(Request $request)
    {
        // 1. Device key verification if configured in .env
        $expectedKey = env('DEVICE_API_KEY');
        if (! empty($expectedKey)) {
            $deviceKey = $request->header('X-Device-Key', $request->query('key'));
            if ($deviceKey !== $expectedKey) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized: Akses perangkat ditolak.',
                ], 401);
            }
        }

        $uid = strtoupper(trim($request->input('uid', '')));
        if (empty($uid)) {
            return response()->json([
                'success' => false,
                'message' => 'UID tidak boleh kosong.',
            ], 400);
        }

        // 2. Cooldown debounce per-UID (2 detik)
        $cacheKey = 'tap_cooldown_'.md5($uid);
        if (Cache::has($cacheKey)) {
            return response()->json([
                'success' => false,
                'status' => 'duplicate_burst',
                'message' => 'Kartu baru saja di-tap. Harap beri jeda 2 detik.',
            ], 429);
        }
        Cache::put($cacheKey, true, now()->addSeconds(2));

        // 3. Cek mahasiswa terdaftar
        $student = Student::active()->where('uid', $uid)->first();

        if (! $student) {
            // Catat ke unknown_cards
            $unknown = UnknownCard::where('uid', $uid)->first();
            if ($unknown) {
                $unknown->increment('tap_count');
                $unknown->update(['last_seen' => now()]);
            } else {
                UnknownCard::create([
                    'uid' => $uid,
                    'first_seen' => now(),
                    'last_seen' => now(),
                    'tap_count' => 1,
                ]);
            }

            return response()->json([
                'success' => true,
                'status' => 'unknown',
                'uid' => $uid,
                'message' => 'Kartu belum terdaftar di sistem.',
            ]);
        }

        // 4. Tentukan sesi aktif & acara aktif
        $today = date('Y-m-d');
        $sessionId = trim($request->input('session_id', 'sesi_1'));
        if (empty($sessionId)) {
            $sessionId = 'sesi_1';
        }

        $sessionNames = [
            'sesi_1' => 'Sesi 1 (Datang)',
            'sesi_2' => 'Sesi 2 (Ishoma)',
            'sesi_3' => 'Sesi 3 (Pulang)',
        ];
        $sessionName = $sessionNames[$sessionId] ?? ucfirst($sessionId);

        $activeEvent = Event::active()->first();
        if (! $activeEvent) {
            $activeEvent = Event::orderBy('id', 'asc')->first();
        }

        $eventId = $activeEvent ? $activeEvent->id : 1;
        $eventName = $activeEvent ? $activeEvent->name : 'Kegiatan HIMA Umum';
        $startTime = ($activeEvent && ! empty($activeEvent->start_time)) ? $activeEvent->start_time : '08:00:00';
        $targetAudience = $activeEvent ? $activeEvent->target_audience : 'all';

        // 5. Validasi Kepanitiaan & Hak Akses
        $isCommittee = false;
        $committeeRole = '';
        $committeeDiv = '';

        if ($eventId > 0) {
            $comm = EventCommittee::where('event_id', $eventId)->where('student_id', $student->id)->first();
            if ($comm) {
                $isCommittee = true;
                $committeeRole = $comm->role;
                $committeeDiv = $comm->division;
            }
        }

        if (! $isCommittee) {
            $commAny = EventCommittee::where('student_id', $student->id)->first();
            if ($commAny) {
                $isCommittee = true;
                $committeeRole = $commAny->role;
                $committeeDiv = $commAny->division;
            }
        }

        if (! $isCommittee && ! empty($student->position)) {
            $posLower = strtolower($student->position);
            $keywords = ['panitia', 'ketua', 'sie', 'koor', 'sekretaris', 'bendahara', 'pengurus', 'divisi', 'bidang'];
            foreach ($keywords as $kw) {
                if (str_contains($posLower, $kw)) {
                    $isCommittee = true;
                    $committeeRole = $student->position;
                    $committeeDiv = $student->division ?? '';
                    break;
                }
            }
        }

        // Cek target audience
        $isAllowed = false;
        $rejectMsg = '';

        if ($targetAudience === 'all') {
            $isAllowed = true;
        } elseif ($targetAudience === 'bpi_bph') {
            $cat = strtoupper(trim($student->category ?? ''));
            if (in_array($cat, ['BPI', 'BPH'], true) || $isCommittee) {
                $isAllowed = true;
            } else {
                $rejectMsg = 'Akses Ditolak: Acara ini khusus untuk pengurus BPI & BPH.';
            }
        } else { // committee_only
            if ($isCommittee) {
                $isAllowed = true;
            } else {
                $rejectMsg = 'Akses Ditolak: Hanya mahasiswa yang terdaftar sebagai panitia yang dapat melakukan presensi.';
            }
        }

        if (! $isAllowed) {
            return response()->json([
                'success' => false,
                'status' => 'not_allowed',
                'uid' => $uid,
                'name' => $student->name,
                'nim' => $student->nim,
                'session_id' => $sessionId,
                'session' => $sessionName,
                'has_active_event' => ! empty($activeEvent),
                'event_name' => $eventName,
                'message' => $rejectMsg,
            ], 403);
        }

        // 6. Cek apakah sudah absen pada sesi ini
        $alreadyAttended = Attendance::where('student_id', $student->id)
            ->where('event_id', $eventId)
            ->where('tap_date', $today)
            ->where('session_id', $sessionId)
            ->first();

        if ($alreadyAttended) {
            return response()->json([
                'success' => true,
                'status' => 'already_attended',
                'uid' => $uid,
                'name' => $student->name,
                'nim' => $student->nim,
                'session_id' => $sessionId,
                'session' => $sessionName,
                'has_active_event' => ! empty($activeEvent),
                'event_name' => $eventName,
                'message' => 'Sudah absen pada '.$sessionName,
            ]);
        }

        // 7. Hitung status telat
        $currentTime = date('H:i:s');
        $isServerLate = ($currentTime > $startTime);
        $isClientLate = $request->boolean('telat')
                     || $request->boolean('is_late')
                     || strtolower($request->input('status', '')) === 'telat';

        $isTelat = ($sessionId === 'sesi_1' && $isServerLate) || $isClientLate;

        try {
            Attendance::create([
                'student_id' => $student->id,
                'event_id' => $eventId,
                'session_id' => $sessionId,
                'session_name' => $sessionName,
                'uid' => $uid,
                'tap_time' => now(),
                'tap_date' => $today,
                'telat' => $isTelat,
            ]);
        } catch (\Throwable $e) {
            // Double-tap race condition
            return response()->json([
                'success' => true,
                'status' => 'already_attended',
                'uid' => $uid,
                'name' => $student->name,
                'nim' => $student->nim,
                'session_id' => $sessionId,
                'session' => $sessionName,
                'has_active_event' => ! empty($activeEvent),
                'event_name' => $eventName,
                'message' => 'Sudah absen pada '.$sessionName,
            ]);
        }

        return response()->json([
            'success' => true,
            'status' => 'registered',
            'uid' => $uid,
            'name' => $student->name,
            'nim' => $student->nim,
            'session_id' => $sessionId,
            'session' => $sessionName,
            'has_active_event' => ! empty($activeEvent),
            'event_name' => $eventName,
            'is_committee' => $isCommittee,
            'committee_role' => $committeeRole,
            'telat' => $isTelat ? 1 : 0,
            'message' => 'Selamat datang: '.$student->name.($committeeRole ? " ($committeeRole)" : ''),
        ]);
    }

    /**
     * Heartbeat monitoring for ESP8266 IoT device.
     */
    public function espStatus(Request $request)
    {
        if ($request->isMethod('post')) {
            $ip = $request->ip();
            Cache::put('esp_heartbeat_timestamp', time(), now()->addMinutes(2));
            Cache::put('esp_heartbeat_ip', $ip, now()->addMinutes(2));

            $activeEvent = Event::active()->first();

            return response()->json([
                'success' => true,
                'message' => 'Heartbeat received',
                'ip' => $ip,
                'has_active_event' => ! empty($activeEvent),
                'event_name' => $activeEvent ? $activeEvent->name : '',
            ]);
        }

        // GET: check if online (within 45 seconds)
        $lastSeen = Cache::get('esp_heartbeat_timestamp', 0);
        $ip = Cache::get('esp_heartbeat_ip', '');
        $online = ($lastSeen > 0 && (time() - $lastSeen) < 45);

        return response()->json([
            'online' => $online,
            'last_seen' => $lastSeen ? date('H:i:s', $lastSeen) : null,
            'ip' => $ip,
        ]);
    }
}
