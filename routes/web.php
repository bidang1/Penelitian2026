<?php

use App\Http\Controllers\AttendanceController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\EventCommitteeController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\ExportController;
use App\Http\Controllers\StudentController;
use App\Http\Controllers\UnknownCardController;
use Illuminate\Support\Facades\Route;

// Guest Auth routes
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'showLoginForm'])->name('login');
    Route::post('/login', [AuthController::class, 'login']);
});

// Logout route
Route::match(['get', 'post'], '/logout', [AuthController::class, 'logout'])->name('logout');

// Protected Dashboard routes
Route::middleware('auth')->group(function () {
    Route::get('/', function () {
        return redirect()->route('dashboard');
    });

    Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');

    // Clean Pretty URLs for direct tab navigation
    Route::get('/tambah', function () {
        return redirect()->route('dashboard', ['panel' => 'tambah']);
    });
    Route::get('/mahasiswa', function () {
        return redirect()->route('dashboard', ['panel' => 'mahasiswa']);
    });
    Route::get('/rekap', function () {
        return redirect()->route('dashboard', ['panel' => 'rekap']);
    });
    Route::get('/events', function () {
        return redirect()->route('dashboard', ['panel' => 'events']);
    });
    Route::get('/proker', function () {
        return redirect()->route('dashboard', ['panel' => 'events']);
    });

    // Authenticated API routes for dashboard operations (supports both /api/path and /api/path.php)
    Route::prefix('api')->group(function () {
        // Admin profile & password change
        Route::get('/admin', [AuthController::class, 'getProfile']);
        Route::get('/admin.php', [AuthController::class, 'getProfile']);
        Route::post('/admin', [AuthController::class, 'changePassword']);
        Route::post('/admin.php', [AuthController::class, 'changePassword']);

        // Students CRUD
        Route::get('/students', [StudentController::class, 'index']);
        Route::get('/students.php', [StudentController::class, 'index']);
        Route::post('/students', [StudentController::class, 'store']);
        Route::post('/students.php', [StudentController::class, 'store']);
        Route::put('/students', [StudentController::class, 'update']);
        Route::put('/students.php', [StudentController::class, 'update']);
        Route::delete('/students', [StudentController::class, 'destroy']);
        Route::delete('/students.php', [StudentController::class, 'destroy']);
        Route::delete('/students/{id}', [StudentController::class, 'destroy']);

        // Events CRUD
        Route::get('/events', [EventController::class, 'index']);
        Route::get('/events.php', [EventController::class, 'index']);
        Route::post('/events', [EventController::class, 'store']);
        Route::post('/events.php', [EventController::class, 'store']);
        Route::put('/events', [EventController::class, 'update']);
        Route::put('/events.php', [EventController::class, 'update']);
        Route::put('/events/{id}', [EventController::class, 'update']);
        Route::delete('/events/{id}', [EventController::class, 'destroy']);

        // Event Committees
        Route::get('/event_committees', [EventCommitteeController::class, 'index']);
        Route::get('/event_committees.php', [EventCommitteeController::class, 'index']);
        Route::post('/event_committees', [EventCommitteeController::class, 'store']);
        Route::post('/event_committees.php', [EventCommitteeController::class, 'store']);
        Route::delete('/event_committees', [EventCommitteeController::class, 'destroy']);
        Route::delete('/event_committees.php', [EventCommitteeController::class, 'destroy']);

        // Attendance
        Route::get('/attendance', [AttendanceController::class, 'index']);
        Route::get('/attendance.php', [AttendanceController::class, 'index']);
        Route::put('/attendance', [AttendanceController::class, 'toggleLate']);
        Route::put('/attendance.php', [AttendanceController::class, 'toggleLate']);
        Route::delete('/attendance', [AttendanceController::class, 'destroy']);
        Route::delete('/attendance.php', [AttendanceController::class, 'destroy']);

        // Unknown cards
        Route::get('/unknown_cards', [UnknownCardController::class, 'index']);
        Route::get('/unknown_cards.php', [UnknownCardController::class, 'index']);
        Route::delete('/unknown_cards', [UnknownCardController::class, 'destroy']);
        Route::delete('/unknown_cards.php', [UnknownCardController::class, 'destroy']);

        // Export
        Route::get('/export', [ExportController::class, 'export']);
        Route::get('/export.php', [ExportController::class, 'export']);
    });
});
