<?php

namespace App\Http\Controllers;

use App\Models\Attendance;
use App\Models\Student;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExportController extends Controller
{
    private function sanitizeFormula($val): string
    {
        if ($val === null || $val === '') {
            return '-';
        }
        $str = (string) $val;
        if (isset($str[0]) && in_array($str[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'".$str;
        }

        return $str;
    }

    public function export(Request $request)
    {
        $type = $request->query('type', 'attendance');
        $format = strtolower($request->query('format', 'xls'));

        if ($type === 'students') {
            return $this->exportStudents($format);
        }

        return $this->exportAttendance($request, $format);
    }

    private function exportStudents(string $format)
    {
        $students = Student::active()
            ->withCount('attendances as total_hadir')
            ->orderByRaw("
                CASE category
                    WHEN 'BPI' THEN 1
                    WHEN 'BPH' THEN 2
                    ELSE 3
                END ASC
            ")->orderBy('division', 'asc')->orderBy('name', 'asc')
            ->get();

        $filename = 'Daftar_Mahasiswa_'.date('Ymd_His');

        if ($format === 'csv') {
            return new StreamedResponse(function () use ($students) {
                $out = fopen('php://output', 'w');
                echo "\xEF\xBB\xBF"; // UTF-8 BOM
                fputcsv($out, ['# SISTEM PRESENSI MAHASISWA RFID (HIMA)']);
                fputcsv($out, ['# MASTER DATA MAHASISWA TERDAFTAR']);
                fputcsv($out, ['# TOTAL: '.$students->count().' Mahasiswa']);
                fputcsv($out, ['# WAKTU CETAK: '.date('d/m/Y H:i:s')]);
                fputcsv($out, ['']);
                fputcsv($out, ['NO', 'UID KARTU', 'NAMA MAHASISWA', 'NIM', 'KATEGORI', 'BIDANG', 'JABATAN', 'TOTAL HADIR', 'TERDAFTAR SEJAK']);

                foreach ($students as $i => $s) {
                    fputcsv($out, [
                        $i + 1,
                        $this->sanitizeFormula($s->uid),
                        $this->sanitizeFormula($s->name),
                        $this->sanitizeFormula($s->nim ?: '-'),
                        $this->sanitizeFormula($s->category ?: 'Anggota'),
                        $this->sanitizeFormula($s->division ?: '-'),
                        $this->sanitizeFormula($s->position ?: '-'),
                        $s->total_hadir.'x',
                        $this->sanitizeFormula($s->created_at ? $s->created_at->format('Y-m-d H:i:s') : '-'),
                    ]);
                }
                fclose($out);
            }, 200, [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Content-Disposition' => "attachment; filename=\"{$filename}.csv\"",
            ]);
        }

        // Format XLS (HTML table compatible with Excel)
        $html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
        $html .= '<head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:sans-serif;} th{background:#ffe600;border:1px solid #000;padding:8px;} td{border:1px solid #000;padding:6px;}</style></head><body>';
        $html .= '<h2>DAFTAR MASTER MAHASISWA HIMATIF</h2>';
        $html .= '<p>Total: '.$students->count().' | Waktu Cetak: '.date('d/m/Y H:i:s').'</p>';
        $html .= '<table><thead><tr><th>No</th><th>UID</th><th>Nama</th><th>NIM</th><th>Kategori</th><th>Bidang</th><th>Jabatan</th><th>Total Hadir</th></tr></thead><tbody>';

        foreach ($students as $i => $s) {
            $html .= '<tr>';
            $html .= '<td>'.($i + 1).'</td>';
            $html .= '<td style="mso-number-format:\'@\';">'.htmlspecialchars($this->sanitizeFormula($s->uid)).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($s->name)).'</td>';
            $html .= '<td style="mso-number-format:\'@\';">'.htmlspecialchars($this->sanitizeFormula($s->nim ?: '-')).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($s->category ?: 'Anggota')).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($s->division ?: '-')).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($s->position ?: '-')).'</td>';
            $html .= '<td>'.$s->total_hadir.'x</td>';
            $html .= '</tr>';
        }
        $html .= '</tbody></table></body></html>';

        return response($html, 200, [
            'Content-Type' => 'application/vnd.ms-excel; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}.xls\"",
        ]);
    }

    private function exportAttendance(Request $request, string $format)
    {
        $date = $request->query('date', date('Y-m-d'));
        $eventId = (int) $request->query('event_id', 0);
        $all = $request->boolean('all');

        $query = Attendance::with(['student', 'event']);

        if ($eventId > 0) {
            $query->where('event_id', $eventId);
        } elseif (! $all) {
            $query->where('tap_date', $date);
        }

        $records = $query->orderBy('tap_time', 'desc')->get();
        $filename = 'Rekap_Presensi_'.($eventId ? "Event_{$eventId}_" : "Tanggal_{$date}_").date('His');

        if ($format === 'csv') {
            return new StreamedResponse(function () use ($records) {
                $out = fopen('php://output', 'w');
                echo "\xEF\xBB\xBF";
                fputcsv($out, ['NO', 'WAKTU TAP', 'TANGGAL', 'UID', 'NAMA', 'NIM', 'KATEGORI', 'SESI', 'ACARA', 'STATUS KEHADIRAN']);

                foreach ($records as $i => $a) {
                    $status = $a->telat ? 'Terlambat' : 'Tepat Waktu';
                    fputcsv($out, [
                        $i + 1,
                        $a->tap_time ? $a->tap_time->format('d/m/Y H:i:s') : '-',
                        $a->tap_date ? $a->tap_date->format('Y-m-d') : '-',
                        $this->sanitizeFormula($a->uid),
                        $this->sanitizeFormula($a->student->name ?? '-'),
                        $this->sanitizeFormula($a->student->nim ?? '-'),
                        $this->sanitizeFormula($a->student->category ?? 'Anggota'),
                        $this->sanitizeFormula($a->session_name ?? 'Sesi 1'),
                        $this->sanitizeFormula($a->event->name ?? 'Kegiatan HIMA Umum'),
                        $status,
                    ]);
                }
                fclose($out);
            }, 200, [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Content-Disposition' => "attachment; filename=\"{$filename}.csv\"",
            ]);
        }

        $html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
        $html .= '<head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:sans-serif;} th{background:#ffe600;border:1px solid #000;padding:8px;} td{border:1px solid #000;padding:6px;}</style></head><body>';
        $html .= '<h2>REKAP PRESENSI MAHASISWA HIMATIF</h2>';
        $html .= '<p>Total: '.$records->count().' | Waktu Cetak: '.date('d/m/Y H:i:s').'</p>';
        $html .= '<table><thead><tr><th>No</th><th>Waktu Tap</th><th>Tanggal</th><th>UID</th><th>Nama</th><th>NIM</th><th>Kategori</th><th>Sesi</th><th>Acara</th><th>Status</th></tr></thead><tbody>';

        foreach ($records as $i => $a) {
            $status = $a->telat ? 'Terlambat' : 'Tepat Waktu';
            $html .= '<tr>';
            $html .= '<td>'.($i + 1).'</td>';
            $html .= '<td>'.($a->tap_time ? $a->tap_time->format('d/m/Y H:i:s') : '-').'</td>';
            $html .= '<td>'.($a->tap_date ? $a->tap_date->format('Y-m-d') : '-').'</td>';
            $html .= '<td style="mso-number-format:\'@\';">'.htmlspecialchars($this->sanitizeFormula($a->uid)).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($a->student->name ?? '-')).'</td>';
            $html .= '<td style="mso-number-format:\'@\';">'.htmlspecialchars($this->sanitizeFormula($a->student->nim ?? '-')).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($a->student->category ?? 'Anggota')).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($a->session_name ?? 'Sesi 1')).'</td>';
            $html .= '<td>'.htmlspecialchars($this->sanitizeFormula($a->event->name ?? 'Kegiatan HIMA Umum')).'</td>';
            $html .= '<td>'.$status.'</td>';
            $html .= '</tr>';
        }
        $html .= '</tbody></table></body></html>';

        return response($html, 200, [
            'Content-Type' => 'application/vnd.ms-excel; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}.xls\"",
        ]);
    }
}
