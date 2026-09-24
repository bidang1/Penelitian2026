<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Event;
use App\Models\Student;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PresensiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Admin::create([
            'username' => 'admin',
            'password_hash' => Hash::make('admin123'),
            'name' => 'Administrator',
            'must_change_password' => false,
        ]);
    }

    public function test_login_page_is_accessible(): void
    {
        $response = $this->get('/login');
        $response->assertStatus(200);
        $response->assertSee('PRESENSI RFID');
    }

    public function test_admin_can_login_with_valid_credentials(): void
    {
        $response = $this->post('/login', [
            'username' => 'admin',
            'password' => 'admin123',
        ]);

        // Karena password default admin123, otomatis diarahkan untuk ganti password
        $response->assertRedirect('/dashboard?panel=change-password');
        $this->assertAuthenticated();
    }

    public function test_guest_cannot_access_dashboard(): void
    {
        $response = $this->get('/dashboard');
        $response->assertRedirect('/login');
    }

    public function test_authenticated_admin_can_access_dashboard(): void
    {
        $admin = Admin::first();
        $response = $this->actingAs($admin)->get('/dashboard');
        $response->assertStatus(200);
        $response->assertSee('Sistem Presensi');
    }

    public function test_check_uid_records_unknown_card(): void
    {
        $response = $this->getJson('/api/check_uid?uid=TESTUNKNOWN123');
        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'status' => 'unknown',
            'uid' => 'TESTUNKNOWN123',
        ]);

        $this->assertDatabaseHas('unknown_cards', [
            'uid' => 'TESTUNKNOWN123',
        ]);
    }

    public function test_check_uid_records_registered_student_tap(): void
    {
        $student = Student::create([
            'uid' => 'STUDENT123',
            'name' => 'Ahmad Dahlan',
            'nim' => 'L200220001',
            'category' => 'Anggota',
            'is_active' => true,
        ]);

        $event = Event::create([
            'name' => 'Rapat Pleno HIMATIF',
            'event_date' => date('Y-m-d'),
            'start_time' => '08:00:00',
            'target_audience' => 'all',
            'is_active' => true,
        ]);

        $response = $this->getJson('/api/check_uid?uid=STUDENT123&session_id=sesi_1');
        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'status' => 'registered',
            'name' => 'Ahmad Dahlan',
        ]);

        $this->assertDatabaseHas('attendance', [
            'student_id' => $student->id,
            'uid' => 'STUDENT123',
            'session_id' => 'sesi_1',
        ]);
    }

    public function test_student_crud_api(): void
    {
        $admin = Admin::first();

        // Create
        $response = $this->actingAs($admin)->postJson('/api/students', [
            'uid' => 'NEWUID999',
            'name' => 'Budi Santoso',
            'nim' => 'L200220002',
            'category' => 'BPH',
            'division' => 'Keilmuan',
            'position' => 'Ketua Bidang',
        ]);
        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        $this->assertDatabaseHas('students', ['uid' => 'NEWUID999']);

        // List
        $listResponse = $this->actingAs($admin)->getJson('/api/students');
        $listResponse->assertStatus(200);
        $listResponse->assertJsonFragment(['name' => 'Budi Santoso']);

        // Delete
        $student = Student::where('uid', 'NEWUID999')->first();
        $delResponse = $this->actingAs($admin)->deleteJson('/api/students', ['id' => $student->id]);
        $delResponse->assertStatus(200);
        $this->assertDatabaseMissing('students', ['uid' => 'NEWUID999']);
    }
}
