<?php

namespace App\Http\Controllers;

use App\Models\Event;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class DashboardController extends Controller
{
    public function index(Request $request)
    {
        $currentUser = Auth::user();
        $initialPanel = $request->query('panel', 'dashboard');

        if (! in_array($initialPanel, ['dashboard', 'tambah', 'mahasiswa', 'rekap', 'events', 'change-password'], true)) {
            $initialPanel = 'dashboard';
        }

        $activeEvent = Event::active()->first();

        return view('dashboard.index', compact('currentUser', 'initialPanel', 'activeEvent'));
    }
}
