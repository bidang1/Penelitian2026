<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Event extends Model
{
    protected $table = 'events';

    protected $fillable = [
        'name',
        'description',
        'event_date',
        'start_time',
        'end_time',
        'target_audience',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'event_date' => 'date:Y-m-d',
            'is_active' => 'boolean',
        ];
    }

    public function attendances(): HasMany
    {
        return $this->hasMany(Attendance::class, 'event_id');
    }

    public function committees(): HasMany
    {
        return $this->hasMany(EventCommittee::class, 'event_id');
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
