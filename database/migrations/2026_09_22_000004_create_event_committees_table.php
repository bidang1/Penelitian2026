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
        if (! Schema::hasTable('event_committees')) {
            Schema::create('event_committees', function (Blueprint $table) {
                $table->id();
                $table->integer('event_id')->index();
                $table->integer('student_id')->index();
                $table->string('role', 100);
                $table->string('division', 100)->nullable();
                $table->timestamps();

                $table->unique(['event_id', 'student_id']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('event_committees');
    }
};
