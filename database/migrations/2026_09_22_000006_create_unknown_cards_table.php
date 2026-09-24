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
        if (! Schema::hasTable('unknown_cards')) {
            Schema::create('unknown_cards', function (Blueprint $table) {
                $table->id();
                $table->string('uid', 50)->unique();
                $table->dateTime('first_seen');
                $table->dateTime('last_seen');
                $table->integer('tap_count')->default(1);
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('unknown_cards');
    }
};
