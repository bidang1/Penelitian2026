<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (! Schema::hasTable('events')) {
            Schema::create('events', function (Blueprint $table) {
                $table->id();
                $table->string('name', 150);
                $table->text('description')->nullable();
                $table->date('event_date');
                $table->time('start_time')->default('08:00:00');
                $table->time('end_time')->nullable();
                $table->enum('target_audience', ['all', 'committee_only', 'bpi_bph'])->default('all');
                $table->boolean('is_active')->default(false);
                $table->timestamps();
            });
        } else {
            Schema::table('events', function (Blueprint $table) {
                if (! Schema::hasColumn('events', 'start_time')) {
                    $table->time('start_time')->default('08:00:00')->after('event_date');
                }
                if (! Schema::hasColumn('events', 'end_time')) {
                    $table->time('end_time')->nullable()->after('start_time');
                }
                if (! Schema::hasColumn('events', 'target_audience')) {
                    $table->enum('target_audience', ['all', 'committee_only', 'bpi_bph'])->default('all')->after('end_time');
                }
                if (! Schema::hasColumn('events', 'updated_at')) {
                    $table->timestamp('updated_at')->nullable()->after('created_at');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('events');
    }
};
