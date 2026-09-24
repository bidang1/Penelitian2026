@extends('layouts.app')

@section('title', 'Dashboard Presensi HIMATIF - RFID / ESP8266')

@section('body-attrs')
data-initial-panel="{{ $initialPanel }}"
@endsection

@section('content')
<div class="app-wrapper">

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="sidebar-brand">
        <img src="{{ asset('assets/Image/logo-himatif-light.png') }}" alt="Logo HIMATIF UMS" class="sidebar-logo-img">
        <div class="sidebar-brand-text">
          <span class="sidebar-brand-badge">HIMATIF UMS</span>
          <h1 class="sidebar-brand-title">Sistem Presensi</h1>
        </div>
      </div>
      <div class="version">ESP8266 + RFID &bull; Proker HIMA</div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-label">Navigasi Utama</div>

      <div class="nav-item active" data-panel="dashboard" onclick="showPanel('dashboard')">
        <span class="nav-indicator">[01]</span>
        <span>Dashboard</span>
      </div>

      <div class="nav-item" data-panel="tambah" onclick="showPanel('tambah')">
        <span class="nav-indicator">[02]</span>
        <span>Tambah Peserta</span>
        <span class="nav-badge" id="unknown-badge" style="display:none">0</span>
      </div>

      <div class="nav-item" data-panel="mahasiswa" onclick="showPanel('mahasiswa')">
        <span class="nav-indicator">[03]</span>
        <span>Data Mahasiswa</span>
      </div>

      <div class="nav-item" data-panel="rekap" onclick="showPanel('rekap')">
        <span class="nav-indicator">[04]</span>
        <span>Rekap Absensi</span>
      </div>

      <div class="nav-item" data-panel="events" onclick="showPanel('events')">
        <span class="nav-indicator">[05]</span>
        <span>Program Kerja</span>
      </div>
    </nav>

    <div class="sidebar-footer">
      <!-- Admin Profile Box -->
      <div class="admin-profile-box">
        <div class="admin-avatar">AD</div>
        <div class="admin-details">
          <div class="admin-name">{{ $currentUser->name ?? 'Administrator' }}</div>
          <div class="admin-role">{{ '@' . ($currentUser->username ?? 'admin') }}</div>
        </div>
        <div class="flex gap-1" style="margin-left: auto;">
          <button type="button" class="btn btn-secondary btn-xs" onclick="openChangePasswordModal()" title="Ubah Password Admin">
            KUNCI
          </button>
          <a href="{{ route('logout') }}" class="btn btn-danger btn-xs" title="Keluar dari sistem">
            KELUAR
          </a>
        </div>
      </div>

      <div class="esp-status">
        <div class="esp-dot" id="esp-dot"></div>
        <div class="esp-info">
          <div class="esp-label">Perangkat IoT</div>
          <div class="esp-status-text" id="esp-status-text">Menghubungkan...</div>
        </div>
      </div>
    </div>
  </aside>

  <!-- Main content -->
  <main class="main-content">

    <!-- Top Bar -->
    <header class="top-bar">
      <div>
        <h1 class="page-title" id="page-title">Dashboard</h1>
        <div class="page-subtitle" id="page-subtitle">Rekap absensi kehadiran hari ini</div>
      </div>
      <div class="top-bar-actions">
        <!-- Active Event Badge -->
        <div class="active-event-badge" id="active-event-badge" onclick="showPanel('events')" style="cursor: pointer; display: inline-flex; align-items: center; gap: 8px; background: var(--color-yellow); border: 2px solid #000; padding: 6px 12px; font-size: 11px; font-weight: 800; box-shadow: 2px 2px 0px #000;" title="Klik untuk kelola Program Kerja / Acara">
          <span style="background: #000; color: #fff; padding: 2px 6px; font-size: 10px; letter-spacing: 0.05em;">ACARA</span>
          <span id="active-event-title">{{ $activeEvent ? $activeEvent->name : 'Memuat acara...' }}</span>
          <span id="active-event-date" class="font-mono text-xs" style="color: #333;">{{ $activeEvent ? $activeEvent->event_date->format('d/m/Y') : '' }}</span>
        </div>

        <!-- Active Session Selector -->
        <div class="session-selector-box" style="display: inline-flex; align-items: center; gap: 6px; background: #ffffff; border: 2px solid #000; padding: 4px 8px; box-shadow: 2px 2px 0px #000;">
          <span style="font-size: 10px; font-weight: 800; background: #000; color: #fff; padding: 2px 6px; letter-spacing: 0.05em;">SESI</span>
          <select id="select-active-session" onchange="onSessionChange(this.value)" style="border: none; background: transparent; font-family: var(--font-mono); font-size: 11px; font-weight: 700; cursor: pointer; padding: 2px 4px;">
            <option value="sesi_1">Sesi 1 (Datang / Pagi)</option>
            <option value="sesi_2">Sesi 2 (Setelah Ishoma / Siang)</option>
            <option value="sesi_3">Sesi 3 (Pulang / Penutupan)</option>
          </select>
        </div>

        <!-- Session Status (Tepat Waktu / Telat Mode) Toggle -->
        <div class="session-status-box" id="session-status-box" onclick="toggleSessionStatus()" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px; background: #ffffff; border: 2px solid #000; padding: 4px 8px; box-shadow: 2px 2px 0px #000;" title="Klik untuk mengubah status sesi: BUKA (Tepat Waktu) atau KUNCI (Semua yang tap dianggap TELAT)">
          <span style="font-size: 10px; font-weight: 800; background: #000; color: #fff; padding: 2px 6px; letter-spacing: 0.05em;">STATUS</span>
          <span id="session-status-badge" class="badge badge-success font-mono font-bold text-xs" style="margin: 0; padding: 2px 6px;">BUKA (AKTIF)</span>
        </div>

        <button class="btn btn-secondary btn-xs audio-toggle-btn" id="audio-toggle-btn" onclick="toggleAudioChime()" title="Aktifkan atau nonaktifkan notifikasi suara tap">
          <span id="audio-status-label">Suara: Aktif</span>
        </button>
        <div class="datetime-display">
          <div class="date" id="live-date">-</div>
          <div class="time" id="live-time">-</div>
        </div>
      </div>
    </header>

    <!-- Panel 1: Dashboard -->
    <section class="panel active" id="panel-dashboard">

      <!-- Live Feed -->
      <div class="live-feed">
        <div class="live-feed-header">
          <div class="live-dot"></div>
          <span>Status &bull; Live Feed</span>
        </div>
        <div class="latest-tap" id="latest-tap">
          <span class="text-muted">Menunggu tap kartu RFID...</span>
        </div>
      </div>

      <!-- Stat Cards -->
      <div class="stats-grid">
        <div class="stat-card stat-card-success">
          <div class="stat-info">
            <div class="stat-label">Hadir Hari Ini</div>
            <div class="stat-value" id="stat-hadir">0</div>
          </div>
        </div>
        <div class="stat-card stat-card-primary">
          <div class="stat-info">
            <div class="stat-label">Total Mahasiswa</div>
            <div class="stat-value" id="stat-total">0</div>
          </div>
        </div>
        <div class="stat-card stat-card-danger" onclick="openAlphaModal()" style="cursor: pointer;" title="Klik untuk melihat daftar anggota yang belum hadir (Alpha)">
          <div class="stat-info">
            <div class="stat-label">Belum Hadir</div>
            <div class="stat-value" id="stat-alpha">0</div>
            <div class="font-mono text-xs mt-1" style="font-weight: 700; text-decoration: underline; color: var(--color-red);">Lihat daftar alpha</div>
          </div>
        </div>
        <div class="stat-card stat-card-warning">
          <div class="stat-info">
            <div class="stat-label">Tingkat Kehadiran</div>
            <div class="stat-value" id="stat-persen">0%</div>
          </div>
        </div>
      </div>

      <!-- Progress Bar Card -->
      <div class="card" style="padding: 20px;">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-bold text-secondary" style="text-transform: uppercase; letter-spacing: 0.05em;">Persentase Kehadiran Hari Ini</span>
          <span class="text-sm font-bold font-mono" id="stat-persen2">0%</span>
        </div>
        <div class="attendance-bar">
          <div class="attendance-bar-fill" id="bar-fill" style="width: 0%"></div>
        </div>
      </div>

      <!-- Tabel Absensi Hari Ini -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Absensi Hari Ini</div>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" onclick="loadDashboard()">Refresh</button>
            <button class="btn btn-primary btn-sm" onclick="exportAttendanceToday('csv')">Download CSV (Hari Ini)</button>
            <button class="btn btn-secondary btn-sm" onclick="exportAttendanceToday('excel')">Download Excel</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>UID Kartu</th>
                <th>Nama Mahasiswa</th>
                <th>NIM</th>
                <th>Sesi</th>
                <th>Jam Tap</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="dashboard-tbody">
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <div class="empty-text">Memuat data...</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Panel 2: Tambah peserta -->
    <section class="panel" id="panel-tambah">

      <div class="alert-box alert-warning" style="margin-bottom: 24px;">
        <div class="alert-content">
          <div class="alert-title">Panduan Registrasi Kartu Mahasiswa</div>
          <div class="alert-desc">
            1. Tempelkan kartu RFID ke alat pembaca (reader).<br>
            2. Kartu baru akan otomatis muncul pada tabel di bawah ini.<br>
            3. Klik tombol <strong>"Daftarkan"</strong> lalu isi Nama Lengkap &amp; NIM.<br>
            4. Anda juga dapat memilih <strong>"Tambah Manual"</strong> bila UID kartu sudah diketahui.
          </div>
        </div>
      </div>

      <div class="flex gap-2 mb-3">
        <button class="btn btn-warning" onclick="openAddManualModal()">+ Tambah Manual</button>
        <button class="btn btn-secondary" onclick="loadUnknownCards()">Refresh Kartu</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">
            Kartu Belum Terdaftar
            <span class="badge badge-warning" id="unknown-count-badge">0 kartu</span>
          </div>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">No</th>
                <th>UID Kartu</th>
                <th>Jumlah Tap</th>
                <th>Terakhir Terdeteksi</th>
                <th style="width: 130px;">Aksi</th>
              </tr>
            </thead>
            <tbody id="unknown-tbody">
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    <div class="empty-text">Memuat data...</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Panel 3: Data mahasiswa -->
    <section class="panel" id="panel-mahasiswa">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Daftar Mahasiswa &amp; Struktur Organisasi</div>
            <div class="text-xs text-muted font-mono mt-1">Klasifikasi kepengurusan: BPI (Badan Pengurus Inti), BPH (Badan Pengurus Harian), dan Anggota HIMA</div>
          </div>
          <div class="flex gap-2 items-center" style="flex-wrap: wrap;">
            <div class="search-box">
              <input type="search" id="search-students" placeholder="Cari nama, NIM, bidang, atau UID..."
                     oninput="searchStudents(this.value)">
            </div>
            <button class="btn btn-warning btn-sm" onclick="openAddManualModal()">+ Tambah Mahasiswa</button>
            <button class="btn btn-primary btn-sm" onclick="openImportModal()">+ Import CSV/Excel</button>
            <button class="btn btn-secondary btn-sm" onclick="exportStudents('csv')">Download CSV</button>
            <button class="btn btn-secondary btn-sm" onclick="exportStudents('excel')">Download Excel</button>
          </div>
        </div>

        <!-- Filter Tab Kategori Organisasi -->
        <div style="padding: 10px 16px; background: var(--bg-alt); border-bottom: 2px solid #000; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="font-mono text-xs font-bold" style="letter-spacing: 0.05em;">FILTER STRUKTUR:</span>
          <button type="button" class="btn btn-xs btn-primary filter-org-btn active" id="filter-btn-all" onclick="filterStudentsByCategory('')" style="border: 2px solid #000; font-weight: 800;">SEMUA (<span id="count-all">0</span>)</button>
          <button type="button" class="btn btn-xs filter-org-btn" id="filter-btn-bpi" onclick="filterStudentsByCategory('BPI')" style="background: #f0abfc; color: #000; border: 2px solid #000; font-weight: 800;">BPI (<span id="count-bpi">0</span>)</button>
          <button type="button" class="btn btn-xs filter-org-btn" id="filter-btn-bph" onclick="filterStudentsByCategory('BPH')" style="background: #67e8f9; color: #000; border: 2px solid #000; font-weight: 800;">BPH (<span id="count-bph">0</span>)</button>
          <button type="button" class="btn btn-xs filter-org-btn" id="filter-btn-anggota" onclick="filterStudentsByCategory('Anggota')" style="background: #fef08a; color: #000; border: 2px solid #000; font-weight: 800;">ANGGOTA (<span id="count-anggota">0</span>)</button>
        </div>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">No</th>
                <th>UID Kartu</th>
                <th>Nama Mahasiswa</th>
                <th>NIM</th>
                <th>Kategori</th>
                <th>Bidang &amp; Jabatan</th>
                <th>Total Hadir</th>
                <th style="width: 130px;">Aksi</th>
              </tr>
            </thead>
            <tbody id="students-tbody">
              <tr>
                <td colspan="8">
                  <div class="empty-state">
                    <div class="empty-text">Memuat data mahasiswa...</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Panel 4: Rekap absensi -->
    <section class="panel" id="panel-rekap">

      <!-- Filter Tanggal & Export Actions Bar -->
      <div class="card" style="padding: 16px 20px; margin-bottom: 20px;">
        <div class="flex items-center justify-between gap-3" style="flex-wrap: wrap;">
          <!-- Date & Session Selector -->
          <div class="flex items-center gap-2" style="flex-wrap: wrap;">
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap; font-size: 12px;">Tanggal:</label>
            <input type="date" id="rekap-date" onchange="loadRekap()" style="width: auto; min-width: 140px; padding: 6px 10px; font-size: 12px;">
            <button class="btn btn-secondary btn-sm" onclick="setQuickDate('today')" type="button">Hari Ini</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuickDate('yesterday')" type="button">Kemarin</button>
            
            <label class="form-label" style="margin-bottom: 0; white-space: nowrap; font-size: 12px; margin-left: 6px;">Filter Sesi:</label>
            <select id="rekap-session-filter" onchange="loadRekap()" style="width: auto; min-width: 130px; padding: 6px 8px; font-size: 12px; font-family: var(--font-mono); border: 2px solid #000;">
              <option value="">Semua Sesi</option>
              <option value="sesi_1">Sesi 1 (Datang)</option>
              <option value="sesi_2">Sesi 2 (Ishoma)</option>
              <option value="sesi_3">Sesi 3 (Pulang)</option>
            </select>

            <label class="form-label" style="margin-bottom: 0; white-space: nowrap; font-size: 12px; margin-left: 6px;">Kategori:</label>
            <select id="rekap-category-filter" onchange="loadRekap()" style="width: auto; min-width: 120px; padding: 6px 8px; font-size: 12px; font-family: var(--font-mono); border: 2px solid #000;">
              <option value="">Semua Kategori</option>
              <option value="BPI">BPI</option>
              <option value="BPH">BPH</option>
              <option value="Anggota">Anggota</option>
            </select>
          </div>

          <!-- Download Action Buttons -->
          <div class="flex gap-2" style="flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="exportAttendance('csv')">Download CSV</button>
            <button class="btn btn-secondary btn-sm" onclick="exportAttendance('excel')">Download Excel</button>
            <button class="btn btn-secondary btn-sm" onclick="exportAllAttendance('csv')">Download Semua (CSV)</button>
          </div>
        </div>
      </div>

      <!-- Stat Cards Summary -->
      <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 20px;">
        <div class="stat-card stat-card-success">
          <div class="stat-info">
            <div class="stat-label">Hadir Terdata</div>
            <div class="stat-value" id="rekap-total-hadir">0</div>
          </div>
        </div>
        <div class="stat-card stat-card-primary">
          <div class="stat-info">
            <div class="stat-label">Total Target</div>
            <div class="stat-value" id="rekap-total-mhs">0</div>
          </div>
        </div>
        <div class="stat-card stat-card-warning">
          <div class="stat-info">
            <div class="stat-label">Total Telat</div>
            <div class="stat-value" id="rekap-total-telat">0</div>
          </div>
        </div>
        <div class="stat-card stat-card-secondary" style="background: #f1f5f9;">
          <div class="stat-info">
            <div class="stat-label">Persentase Kehadiran</div>
            <div class="stat-value" id="rekap-persen">0%</div>
          </div>
        </div>
      </div>

      <!-- Tabel Rekap Kehadiran -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Log Data Kehadiran</div>
          <div class="flex gap-2">
            <button class="btn btn-danger btn-sm" onclick="clearRekapByDate()">Hapus Rekap Tanggal Ini</button>
            <button class="btn btn-secondary btn-sm" onclick="loadRekap()">Refresh</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>UID Kartu</th>
                <th>Nama Mahasiswa</th>
                <th>NIM</th>
                <th>Kategori &amp; Peran</th>
                <th>Sesi Presensi</th>
                <th>Waktu Tap</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="rekap-tbody">
              <tr>
                <td colspan="8">
                  <div class="empty-state">
                    <div class="empty-text">Pilih tanggal untuk melihat rekap</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Panel 5: Program kerja dan acara -->
    <section class="panel" id="panel-events">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Manajemen Program Kerja &amp; Acara</div>
            <div class="text-xs text-muted font-mono mt-1">Pilih acara yang sedang berlangsung agar rekap absensi terhubung dengan kegiatan</div>
          </div>
          <div class="flex gap-2 items-center" style="flex-wrap: wrap;">
            <button class="btn btn-warning btn-sm" onclick="openCreateEventModal()">+ Buat Acara Baru</button>
            <button class="btn btn-secondary btn-sm" onclick="loadEvents()">Refresh Acara</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">No</th>
                <th>Nama Program Kerja / Acara</th>
                <th>Waktu Pelaksanaan</th>
                <th>Target Presensi</th>
                <th>Panitia</th>
                <th>Total Hadir</th>
                <th>Status</th>
                <th style="width: 170px;">Aksi</th>
              </tr>
            </thead>
            <tbody id="events-tbody">
              <tr>
                <td colspan="8">
                  <div class="empty-state">
                    <div class="empty-text">Memuat data program kerja...</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

  </main>
</div>

<!-- Modal: Register peserta -->
<div class="modal-overlay" id="modal-register">
  <div class="modal-box">
    <div class="modal-title" id="modal-reg-title">Daftarkan Mahasiswa</div>

    <div class="form-group">
      <label class="form-label">UID Kartu RFID *</label>
      <input type="text" id="reg-uid" placeholder="Contoh: A1B2C3D4" style="font-family: monospace; text-transform: uppercase;">
      <div class="text-xs text-muted mt-1 font-mono">UID otomatis terisi dari tap kartu, atau masukkan manual.</div>
    </div>

    <div class="form-group">
      <label class="form-label">Nama Mahasiswa *</label>
      <input type="text" id="reg-name" placeholder="Nama lengkap mahasiswa">
    </div>

    <div class="form-group">
      <label class="form-label">NIM (Nomor Induk Mahasiswa)</label>
      <input type="text" id="reg-nim" placeholder="Contoh: L200220001">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="form-group">
        <label class="form-label">Kategori Organisasi *</label>
        <select id="reg-category" style="width: 100%; border: 2px solid #000; padding: 8px 10px; font-weight: 700; background: #fff;">
          <option value="Anggota" selected>Anggota (Umum)</option>
          <option value="BPI">BPI (Badan Pengurus Inti)</option>
          <option value="BPH">BPH (Badan Pengurus Harian)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Bidang</label>
        <select id="reg-division" style="width: 100%; border: 2px solid #000; padding: 8px 10px; font-weight: 700; background: #fff;">
          <option value="">-- Pilih Bidang --</option>
          <option value="Keilmuan dan Penelitian">Keilmuan dan Penelitian</option>
          <option value="Kemahasiswaan">Kemahasiswaan</option>
          <option value="Minat dan Bakat">Minat dan Bakat</option>
          <option value="Kaderisasi">Kaderisasi</option>
          <option value="Sosial Masyarakat">Sosial Masyarakat</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Jabatan Formal di Himpunan</label>
      <input type="text" id="reg-position" placeholder="Contoh: Ketua Umum, Ketua Bidang, Staf">
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeRegisterModal()">Batal</button>
      <button class="btn btn-primary" onclick="submitRegister()">Simpan Data</button>
    </div>
  </div>
</div>

<!-- Modal: Edit data mahasiswa -->
<div class="modal-overlay" id="modal-edit">
  <div class="modal-box">
    <div class="modal-title">Edit Data Mahasiswa</div>

    <input type="hidden" id="edit-id">

    <div class="form-group">
      <label class="form-label">UID Kartu RFID</label>
      <input type="text" id="edit-uid" placeholder="UID Kartu" style="font-family: monospace; text-transform: uppercase;">
    </div>

    <div class="form-group">
      <label class="form-label">Nama Mahasiswa *</label>
      <input type="text" id="edit-name" placeholder="Nama lengkap">
    </div>

    <div class="form-group">
      <label class="form-label">NIM</label>
      <input type="text" id="edit-nim" placeholder="NIM">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="form-group">
        <label class="form-label">Kategori Organisasi *</label>
        <select id="edit-category" style="width: 100%; border: 2px solid #000; padding: 8px 10px; font-weight: 700; background: #fff;">
          <option value="Anggota">Anggota (Umum)</option>
          <option value="BPI">BPI (Badan Pengurus Inti)</option>
          <option value="BPH">BPH (Badan Pengurus Harian)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Bidang</label>
        <select id="edit-division" style="width: 100%; border: 2px solid #000; padding: 8px 10px; font-weight: 700; background: #fff;">
          <option value="">-- Pilih Bidang --</option>
          <option value="Keilmuan dan Penelitian">Keilmuan dan Penelitian</option>
          <option value="Kemahasiswaan">Kemahasiswaan</option>
          <option value="Minat dan Bakat">Minat dan Bakat</option>
          <option value="Kaderisasi">Kaderisasi</option>
          <option value="Sosial Masyarakat">Sosial Masyarakat</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Jabatan Formal di Himpunan</label>
      <input type="text" id="edit-position" placeholder="Contoh: Ketua Umum, Ketua Bidang, Staf">
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeEditModal()">Batal</button>
      <button class="btn btn-primary" onclick="submitEdit()">Simpan Perubahan</button>
    </div>
  </div>
</div>

<!-- Modal: Buat program kerja dan acara -->
<div class="modal-overlay" id="modal-create-event">
  <div class="modal-box">
    <div class="modal-title">Buat Program Kerja / Acara Baru</div>

    <div class="form-group">
      <label class="form-label">Nama Acara / Program Kerja *</label>
      <input type="text" id="event-name" placeholder="Contoh: Rapat Pleno 1, Makrab HIMA, Workshop IT">
    </div>

    <div class="form-group">
      <label class="form-label">Tanggal Pelaksanaan</label>
      <input type="date" id="event-date">
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="form-group">
        <label class="form-label">Jam Mulai (Format 24 Jam) *</label>
        <input type="text" id="event-start-time" class="time-24h-input font-mono font-bold" placeholder="08:00" value="08:00" maxlength="5" required>
        <div class="text-xs text-muted font-mono mt-1">Format 24 Jam (00:00 - 23:59 WIB)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Jam Selesai (Format 24 Jam)</label>
        <input type="text" id="event-end-time" class="time-24h-input font-mono font-bold" placeholder="17:00 (Opsional)" maxlength="5">
        <div class="text-xs text-muted font-mono mt-1">Opsional, format 24 jam (HH:mm)</div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Target Presensi Acara *</label>
      <select id="event-target-audience" style="width: 100%; border: 2px solid #000; padding: 8px 10px; font-weight: 700; background: #fff;">
        <option value="committee_only" selected>Khusus Panitia (Hanya Panitia Terdaftar)</option>
        <option value="all">Semua Anggota (Umum)</option>
        <option value="bpi_bph">Khusus Pengurus (BPI &amp; BPH Saja)</option>
      </select>
      <div class="text-xs text-muted font-mono mt-1">Hanya mahasiswa yang didaftarkan sebagai panitia yang diizinkan melakukan presensi.</div>
    </div>

    <div class="form-group">
      <label class="form-label">Keterangan / Deskripsi Singkat</label>
      <input type="text" id="event-desc" placeholder="Contoh: Wajib untuk seluruh pengurus bidang">
    </div>

    <div class="form-group" style="margin-top: 12px;">
      <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; cursor: pointer;">
        <input type="checkbox" id="event-active" checked style="width: 18px; height: 18px; accent-color: #000;">
        Langsung jadikan acara aktif saat ini
      </label>
      <div class="text-xs text-muted font-mono mt-1">Perangkat RFID dan web akan langsung mencatat presensi untuk acara ini.</div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeCreateEventModal()">Batal</button>
      <button class="btn btn-primary" onclick="submitCreateEvent()">Simpan Acara</button>
    </div>
  </div>
</div>

<!-- Modal: Kelola Panitia Program Kerja -->
<div class="modal-overlay" id="modal-committees">
  <div class="modal-box" style="max-width: 800px; width: 95%;">
    <div class="flex items-center justify-between" style="border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px;">
      <div>
        <div class="modal-title" id="committee-modal-title" style="margin-bottom: 4px;">Susunan Panitia Program Kerja</div>
        <div class="text-xs font-mono text-muted" id="committee-modal-subtitle">Acara: -</div>
      </div>
      <span class="badge badge-committee font-mono" id="committee-count-badge">0 PANITIA</span>
    </div>

    <!-- Form Tambah Panitia -->
    <div class="card" style="background: var(--bg-alt); padding: 14px; margin-bottom: 16px; border: 2px solid #000; box-shadow: 2px 2px 0px #000;">
      <div class="font-bold text-xs uppercase mb-2" style="letter-spacing: 0.05em;">+ Tambah / Tetapkan Panitia Baru</div>
      <div style="display: grid; grid-template-columns: 2fr 1.5fr 1fr auto; gap: 8px; align-items: end;">
        <div>
          <label class="form-label" style="font-size: 11px; margin-bottom: 4px;">Pilih Mahasiswa *</label>
          <select id="comm-student-select" style="width: 100%; border: 2px solid #000; padding: 6px 8px; font-size: 12px; font-weight: 700; background: #fff;">
            <option value="">-- Pilih Mahasiswa --</option>
          </select>
        </div>
        <div>
          <label class="form-label" style="font-size: 11px; margin-bottom: 4px;">Jabatan / Role *</label>
          <input type="text" id="comm-role-input" list="role-suggestions" placeholder="Cth: Ketua Panitia, Sie Acara" style="width: 100%; border: 2px solid #000; padding: 6px 8px; font-size: 12px; font-weight: 700;">
          <datalist id="role-suggestions">
            <option value="Ketua Panitia">
            <option value="Wakil Ketua">
            <option value="Sekretaris Panitia">
            <option value="Bendahara Panitia">
            <option value="Steering Committee (SC)">
            <option value="Sie Acara">
            <option value="Sie Perlengkapan">
            <option value="Sie Konsumsi">
            <option value="Sie Humas &amp; Publikasi">
            <option value="Sie Dokumentasi &amp; Medinfo">
            <option value="Sie Keamanan">
            <option value="Sie Sponsor &amp; Dana Usaha">
            <option value="Sie Medis">
          </datalist>
        </div>
        <div>
          <label class="form-label" style="font-size: 11px; margin-bottom: 4px;">Seksi / Divisi</label>
          <input type="text" id="comm-division-input" placeholder="Cth: Acara, Humas" style="width: 100%; border: 2px solid #000; padding: 6px 8px; font-size: 12px; font-weight: 700;">
        </div>
        <div>
          <button type="button" class="btn btn-warning btn-sm" onclick="submitAddCommittee()" style="font-weight: 800; border: 2px solid #000; box-shadow: 2px 2px 0px #000; height: 35px;">
            + Tetapkan
          </button>
        </div>
      </div>
    </div>

    <!-- Tabel Daftar Panitia -->
    <div class="table-wrapper" style="max-height: 280px; overflow-y: auto; border: 2px solid #000; margin-bottom: 16px;">
      <table>
        <thead>
          <tr>
            <th style="width: 40px;">No</th>
            <th>Nama Mahasiswa</th>
            <th>NIM</th>
            <th>Jabatan Panitia</th>
            <th>Kategori Himpunan</th>
            <th style="width: 70px;">Aksi</th>
          </tr>
        </thead>
        <tbody id="committee-tbody">
          <tr><td colspan="6"><div class="empty-state"><div class="empty-text">Belum ada panitia yang ditambahkan</div></div></td></tr>
        </tbody>
      </table>
    </div>

    <div class="modal-actions" style="display: flex; justify-content: flex-end;">
      <button class="btn btn-secondary btn-sm" onclick="closeCommitteesModal()">Tutup</button>
    </div>
  </div>
</div>

<!-- Modal: Daftar anggota belum hadir -->
<div class="modal-overlay" id="modal-alpha">
  <div class="modal-box" style="max-width: 650px; width: 95%;">
    <div class="flex items-center justify-between" style="border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px;">
      <div>
        <div class="modal-title" style="margin-bottom: 4px; color: var(--color-red);">Daftar Anggota Belum Hadir (Alpha)</div>
        <div class="text-xs font-mono text-muted" id="alpha-date-title">Tanggal: Hari Ini</div>
      </div>
      <span class="badge badge-danger font-mono" id="alpha-count-badge">0 ANGGOTA</span>
    </div>

    <div class="table-wrapper" style="max-height: 340px; overflow-y: auto; border: 2px solid #000; margin-bottom: 16px;">
      <table>
        <thead>
          <tr>
            <th>No</th>
            <th>Nama Anggota</th>
            <th>NIM</th>
            <th>UID Kartu</th>
          </tr>
        </thead>
        <tbody id="alpha-tbody">
          <tr><td colspan="4"><div class="empty-state"><div class="empty-text">Memuat...</div></div></td></tr>
        </tbody>
      </table>
    </div>

    <div class="modal-actions" style="display: flex; justify-content: space-between; align-items: center;">
      <button class="btn btn-success btn-sm" onclick="copyAlphaListToWhatsApp()">
        Salin Format WhatsApp
      </button>
      <button class="btn btn-secondary btn-sm" onclick="closeAlphaModal()">
        Tutup
      </button>
    </div>
  </div>
</div>

<!-- Modal: Import batch mahasiswa -->
<div class="modal-overlay" id="modal-import">
  <div class="modal-box" style="max-width: 600px; width: 95%;">
    <div class="modal-title">Import Massal Data Mahasiswa</div>
    <div class="text-xs text-muted font-mono mb-3">Upload file CSV atau Excel (.xlsx) dengan kolom: <strong>UID</strong>, <strong>Nama</strong>, dan <strong>NIM</strong>.</div>

    <div class="form-group">
      <input type="file" id="import-file-input" accept=".csv, .xlsx, .xls" onchange="handleImportFile(event)"
             style="border: 2px dashed #000; padding: 20px; width: 100%; background: var(--bg-alt); cursor: pointer; text-align: center;">
    </div>

    <div class="flex items-center justify-between mb-2">
      <div class="font-mono text-xs font-bold">Preview Data Terdeteksi:</div>
      <span class="badge badge-primary font-mono" id="import-count-badge">0 DATA</span>
    </div>

    <div class="table-wrapper" style="max-height: 220px; overflow-y: auto; border: 2px solid #000; margin-bottom: 16px;">
      <table>
        <thead>
          <tr>
            <th>No</th>
            <th>UID</th>
            <th>Nama</th>
            <th>NIM</th>
          </tr>
        </thead>
        <tbody id="import-preview-tbody">
          <tr>
            <td colspan="4">
              <div class="empty-state">
                <div class="empty-text">PILIH FILE TERLEBIH DAHULU</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeImportModal()">Batal</button>
      <button class="btn btn-primary" id="btn-submit-import" onclick="submitBatchImport()" disabled>Mulai Import</button>
    </div>
  </div>
</div>

<!-- Modal: Ubah password admin -->
@php
  $mustChangePwd = !empty($currentUser->must_change_password) || ($initialPanel === 'change-password');
@endphp
<div class="modal-overlay {{ $mustChangePwd ? 'active open' : '' }}" id="modal-password" {{ $mustChangePwd ? 'data-force="1"' : '' }}>
  <div class="modal-box" style="max-width: 440px;">
    <div class="modal-title">{{ $mustChangePwd ? 'Peringatan: Wajib Ganti Password' : 'Ubah Password Administrator' }}</div>
    @if ($mustChangePwd)
      <div class="alert alert-danger font-bold text-xs mb-3" style="background:#fee2e2; border:1px solid #ef4444; color:#b91c1c; padding:10px; border-radius:0;">
        Akun Anda terdeteksi masih menggunakan password default (<strong>admin123</strong>). Demi keamanan, Anda wajib membuat password baru sebelum dapat mengakses sistem.
      </div>
    @else
      <div class="text-xs text-muted font-mono mb-3">Pastikan password baru kuat dan mudah Anda ingat.</div>
    @endif

    <form id="form-change-password" onsubmit="event.preventDefault(); submitChangePassword();">
      <input type="text" name="username" value="{{ $currentUser->username ?? 'admin' }}" autocomplete="username" style="display:none;" aria-hidden="true">
      <div class="form-group">
        <label class="form-label" for="pwd-old">Password Lama *</label>
        <input type="password" id="pwd-old" placeholder="Masukkan password lama" autocomplete="current-password" required value="{{ $mustChangePwd ? 'admin123' : '' }}">
      </div>

      <div class="form-group">
        <label class="form-label" for="pwd-new">Password Baru * (Min. 6 karakter)</label>
        <input type="password" id="pwd-new" placeholder="Masukkan password baru" autocomplete="new-password" required minlength="6">
      </div>

      <div class="form-group">
        <label class="form-label" for="pwd-confirm">Konfirmasi Password Baru *</label>
        <input type="password" id="pwd-confirm" placeholder="Ulangi password baru" autocomplete="new-password" required minlength="6">
      </div>

      <div class="modal-actions">
        @if (!$mustChangePwd)
          <button type="button" class="btn btn-secondary" onclick="closeChangePasswordModal()">Batal</button>
        @endif
        <button type="submit" class="btn btn-warning" style="{{ $mustChangePwd ? 'width:100%;' : '' }}">Simpan &amp; Aktifkan Akun</button>
      </div>
    </form>
  </div>
</div>
@endsection
