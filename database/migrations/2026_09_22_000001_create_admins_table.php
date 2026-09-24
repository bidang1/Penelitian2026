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
        if (! Schema::hasTable('admins')) {
            Schema::create('admins', function (Blueprint $table) {
                $table->id();
                $table->string('username', 50)->unique();
                $table->string('password_hash');
                $table->string('name', 100);
                $table->boolean('must_change_password')->default(false);
                $table->rememberToken();
                $table->timestamps();
            });
        } else {
            Schema::table('admins', function (Blueprint $table) {
                if (! Schema::hasColumn('admins', 'must_change_password')) {
                    $table->boolean('must_change_password')->default(false)->after('name');
                }
                if (! Schema::hasColumn('admins', 'remember_token')) {
                    $table->rememberToken()->after('must_change_password');
                }
                if (! Schema::hasColumn('admins', 'updated_at')) {
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
        Schema::dropIfExists('admins');
    }
};
