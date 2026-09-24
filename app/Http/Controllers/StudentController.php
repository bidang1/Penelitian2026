<?php

namespace App\Http\Controllers;

use App\Models\Student;
use App\Models\UnknownCard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StudentController extends Controller
{
    public function index(Request $request)
    {
        $search = trim($request->query('search', ''));
        $category = trim($request->query('category', ''));
        $division = trim($request->query('division', ''));

        $query = Student::query()
            ->withCount('attendances as total_hadir');

        if (! empty($search)) {
            $query->search($search);
        }

        if (! empty($category) && in_array($category, ['BPI', 'BPH', 'Anggota'], true)) {
            $query->where('category', $category);
        }

        if (! empty($division)) {
            $query->where('division', $division);
        }

        $query->orderByRaw("
            CASE category
                WHEN 'BPI' THEN 1
                WHEN 'BPH' THEN 2
                ELSE 3
            END ASC
        ")->orderBy('division', 'asc')->orderBy('name', 'asc');

        $students = $query->get();

        return response()->json([
            'success' => true,
            'data' => $students,
        ]);
    }

    public function store(Request $request)
    {
        // Batch Import
        if ($request->boolean('batch') && is_array($request->input('students'))) {
            $studentsList = $request->input('students');
            $processed = 0;

            DB::beginTransaction();
            try {
                foreach ($studentsList as $item) {
                    $uid = strtoupper(trim($item['uid'] ?? ''));
                    $name = strip_tags(trim($item['name'] ?? ''));
                    $nim = strip_tags(trim($item['nim'] ?? ''));
                    $cat = trim($item['category'] ?? 'Anggota');
                    if (! in_array($cat, ['BPI', 'BPH', 'Anggota'], true)) {
                        $cat = 'Anggota';
                    }
                    $div = strip_tags(trim($item['division'] ?? ''));
                    $pos = strip_tags(trim($item['position'] ?? ''));

                    if (! empty($uid) && ! empty($name)) {
                        Student::updateOrCreate(
                            ['uid' => $uid],
                            [
                                'name' => $name,
                                'nim' => $nim ?: null,
                                'category' => $cat,
                                'division' => $div ?: null,
                                'position' => $pos ?: null,
                                'is_active' => true,
                            ]
                        );

                        UnknownCard::where('uid', $uid)->delete();
                        $processed++;
                    }
                }

                DB::commit();

                return response()->json([
                    'success' => true,
                    'message' => "Berhasil memproses import {$processed} data mahasiswa.",
                    'count' => $processed,
                ]);
            } catch (\Throwable $e) {
                DB::rollBack();

                return response()->json([
                    'success' => false,
                    'message' => 'Gagal memproses batch import data: '.$e->getMessage(),
                ], 500);
            }
        }

        // Single Create
        $validated = $request->validate([
            'uid' => 'required|string|max:50',
            'name' => 'required|string|max:100',
            'nim' => 'nullable|string|max:20',
            'category' => 'nullable|in:BPI,BPH,Anggota',
            'division' => 'nullable|string|max:100',
            'position' => 'nullable|string|max:100',
            'is_active' => 'nullable|boolean',
        ]);

        $uid = strtoupper(trim($validated['uid']));

        if (Student::where('uid', $uid)->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'UID kartu ini sudah terdaftar di sistem.',
            ], 409);
        }

        $student = Student::create([
            'uid' => $uid,
            'name' => strip_tags(trim($validated['name'])),
            'nim' => isset($validated['nim']) ? strip_tags(trim($validated['nim'])) : null,
            'category' => $validated['category'] ?? 'Anggota',
            'division' => isset($validated['division']) ? strip_tags(trim($validated['division'])) : null,
            'position' => isset($validated['position']) ? strip_tags(trim($validated['position'])) : null,
            'is_active' => $validated['is_active'] ?? true,
        ]);

        UnknownCard::where('uid', $uid)->delete();

        return response()->json([
            'success' => true,
            'message' => 'Mahasiswa berhasil didaftarkan.',
            'id' => $student->id,
            'data' => $student,
        ]);
    }

    public function update(Request $request, $id = null)
    {
        $studentId = $id ?: $request->input('id');
        $uid = $request->input('uid') ? strtoupper(trim($request->input('uid'))) : null;

        $student = null;
        if ($studentId) {
            $student = Student::find($studentId);
        } elseif ($uid) {
            $student = Student::where('uid', $uid)->first();
        }

        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'uid' => 'nullable|string|max:50',
            'nim' => 'nullable|string|max:20',
            'category' => 'nullable|in:BPI,BPH,Anggota',
            'division' => 'nullable|string|max:100',
            'position' => 'nullable|string|max:100',
            'is_active' => 'nullable|boolean',
        ]);

        $updateData = [
            'name' => strip_tags(trim($validated['name'])),
            'nim' => isset($validated['nim']) ? strip_tags(trim($validated['nim'])) : null,
            'category' => $validated['category'] ?? 'Anggota',
            'division' => isset($validated['division']) ? strip_tags(trim($validated['division'])) : null,
            'position' => isset($validated['position']) ? strip_tags(trim($validated['position'])) : null,
            'is_active' => $validated['is_active'] ?? true,
        ];

        if (! empty($validated['uid'])) {
            $updateData['uid'] = strtoupper(trim($validated['uid']));
        }

        if ($student) {
            $student->update($updateData);
        } elseif (! empty($updateData['uid'])) {
            // Fallback insert jika dipanggil sinkronisasi
            $student = Student::create($updateData);
        } else {
            return response()->json([
                'success' => false,
                'message' => 'Data mahasiswa tidak ditemukan.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Data mahasiswa berhasil diperbarui.',
            'data' => $student,
        ]);
    }

    public function destroy(Request $request, $id = null)
    {
        $studentId = $id ?: $request->input('id');
        $uid = $request->input('uid') ? strtoupper(trim($request->input('uid'))) : null;

        if ($studentId) {
            Student::where('id', $studentId)->delete();
        } elseif ($uid) {
            Student::where('uid', $uid)->delete();
        } else {
            return response()->json([
                'success' => false,
                'message' => 'ID atau UID mahasiswa tidak valid.',
            ], 400);
        }

        return response()->json([
            'success' => true,
            'message' => 'Data mahasiswa berhasil dihapus.',
        ]);
    }
}
