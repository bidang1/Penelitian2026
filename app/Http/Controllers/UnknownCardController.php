<?php

namespace App\Http\Controllers;

use App\Models\UnknownCard;
use Illuminate\Http\Request;

class UnknownCardController extends Controller
{
    public function index()
    {
        $cards = UnknownCard::orderBy('last_seen', 'desc')->get();

        return response()->json([
            'success' => true,
            'data' => $cards,
        ]);
    }

    public function destroy(Request $request)
    {
        $uid = strtoupper(trim($request->input('uid', '')));

        if (empty($uid)) {
            return response()->json([
                'success' => false,
                'message' => 'UID kartu tidak boleh kosong.',
            ], 400);
        }

        UnknownCard::where('uid', $uid)->delete();

        return response()->json([
            'success' => true,
            'message' => 'Kartu unknown berhasil dihapus.',
        ]);
    }
}
