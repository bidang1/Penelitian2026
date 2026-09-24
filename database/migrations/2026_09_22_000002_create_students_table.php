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
        if (! Schema::hasTable('students')) {
            Schema::create('students', function (Blueprint $table) {
                $table->id();
                $table->string('uid', 50)->unique();
                $table->string('name', 100);
                $table->string('nim', 20)->nullable();
                $table->enum('category', ['BPI', 'BPH', 'Anggota'])->default('Anggota');
                $table->string('division', 100)->nullable();
                $table->string('position', 100)->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        } else {
            Schema::table('students', function (Blueprint $table) {
                if (! Schema::hasColumn('students', 'category')) {
                    $table->enum('category', ['BPI', 'BPH', 'Anggota'])->default('Anggota')->after('nim');
                }
                if (! Schema::hasColumn('students', 'division')) {
                    $table->string('division', 100)->nullable()->after('category');
                }
                if (! Schema::hasColumn('students', 'position')) {
                    $table->string('position', 100)->nullable()->after('division');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('students');
    }
};
