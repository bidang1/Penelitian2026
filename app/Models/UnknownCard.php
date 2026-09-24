<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UnknownCard extends Model
{
    protected $table = 'unknown_cards';

    protected $fillable = [
        'uid',
        'first_seen',
        'last_seen',
        'tap_count',
    ];

    protected function casts(): array
    {
        return [
            'first_seen' => 'datetime',
            'last_seen' => 'datetime',
            'tap_count' => 'integer',
        ];
    }
}
