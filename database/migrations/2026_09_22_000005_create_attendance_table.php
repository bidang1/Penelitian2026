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
        if (! Schema::hasTable('attendance')) {
            Schema::create('attendance', function (Blueprint $table) {
                $table->id();
                $table->integer('student_id')->index();
                $table->integer('event_id')->nullable()->index();
                $table->string('session_id', 30)->default('sesi_1')->index();
                $table->string('session_name', 60)->default('Sesi 1 (Datang)');
                $table->string('uid', 50);
                $table->dateTime('tap_time');
                $table->date('tap_date')->index();
                $table->boolean('telat')->default(false);
                $table->timestamps();

                $table->unique(['student_id', 'tap_date', 'session_id'], 'uniq_student_date_session');
            });
        } else {
            Schema::table('attendance', function (Blueprint $table) {
                if (! Schema::hasColumn('attendance', 'telat')) {
                    $table->boolean('telat')->default(false)->after('session_name');
                }
                if (! Schema::hasColumn('attendance', 'created_at')) {
                    $table->timestamp('created_at')->nullable()->after('tap_date');
                }
                if (! Schema::hasColumn('attendance', 'updated_at')) {
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
        Schema::dropIfExists('attendance');
    }
};
