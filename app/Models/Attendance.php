<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Attendance extends Model
{
    protected $table = 'attendance';

    protected $fillable = [
        'student_id',
        'event_id',
        'session_id',
        'session_name',
        'uid',
        'tap_time',
        'tap_date',
        'telat',
    ];

    protected function casts(): array
    {
        return [
            'tap_time' => 'datetime',
            'tap_date' => 'date:Y-m-d',
            'telat' => 'boolean',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(Student::class, 'student_id');
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class, 'event_id');
    }
}
