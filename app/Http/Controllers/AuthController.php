<?php

namespace App\Http\Controllers;

use App\Models\Admin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

class AuthController extends Controller
{
    public function showLoginForm()
    {
        if (Auth::check()) {
            return redirect()->route('dashboard');
        }

        return view('auth.login');
    }

    public function login(Request $request)
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $throttleKey = 'login:'.$request->ip();

        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return back()->withErrors([
                'login' => "Terlalu banyak percobaan login gagal. Silakan tunggu {$seconds} detik.",
            ])->withInput($request->only('username'));
        }

        $credentials = $request->only('username', 'password');

        if (Auth::attempt($credentials, $request->boolean('remember'))) {
            $request->session()->regenerate();
            RateLimiter::clear($throttleKey);

            $admin = Auth::user();
            if ($admin && ($admin->must_change_password || $request->password === 'admin123')) {
                return redirect()->route('dashboard', ['panel' => 'change-password']);
            }

            return redirect()->intended(route('dashboard'));
        }

        RateLimiter::hit($throttleKey, 60);
        $attemptsLeft = RateLimiter::remaining($throttleKey, 5);

        return back()->withErrors([
            'login' => "Username atau password salah. (Sisa percobaan: {$attemptsLeft})",
        ])->withInput($request->only('username'));
    }

    public function logout(Request $request)
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }

    public function changePassword(Request $request)
    {
        $request->validate([
            'old_password' => 'required|string',
            'new_password' => 'required|string|min:6',
            'confirm_password' => 'required|same:new_password',
        ]);

        /** @var Admin $admin */
        $admin = Auth::user();

        if (! $admin || ! Hash::check($request->old_password, $admin->password_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'Password lama yang dimasukkan tidak sesuai.',
            ], 400);
        }

        $admin->password_hash = Hash::make($request->new_password);
        $admin->must_change_password = false;
        $admin->save();

        return response()->json([
            'success' => true,
            'message' => 'Password administrator berhasil diperbarui.',
        ]);
    }

    public function getProfile()
    {
        /** @var Admin $admin */
        $admin = Auth::user();

        if (! $admin) {
            return response()->json(['success' => false, 'message' => 'Unauthenticated'], 401);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $admin->id,
                'username' => $admin->username,
                'name' => $admin->name,
                'created_at' => $admin->created_at ? $admin->created_at->format('Y-m-d H:i:s') : null,
            ],
        ]);
    }
}
