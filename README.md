# Sistem Presensi Mahasiswa Berbasis RFID (Presensi HIMATIF) - Laravel Edition

Sistem Presensi Mahasiswa terintegrasi berbasis kartu RFID / NFC dengan antarmuka Web Neo-Brutalist (*Wireframe-Inspired*), Cloud Database (Firebase Realtime Database), Backend Framework Laravel (PHP 8.4 + Eloquent ORM + Blade Views), Aplikasi Desktop GUI (Python Tkinter), serta integrasi Hardware IoT (ESP8266 NodeMCU + PN532 / RC522).

---

## Fitur Utama

- **Web Dashboard (Laravel + Neo-Brutalist + Real-time Sync)**:
  - Tampilan *Clean Wireframe* monokrom elegan berorientasi keterbacaan tinggi (Neo-Brutalist design system).
  - Autentikasi sesi Administrator aman dengan proteksi brute force rate-limiting.
  - Sinkronisasi instan *sub-detik* dengan Firebase Realtime Database saat kartu di-tap.
  - Live Tap Feed pemantauan absensi secara langsung.
  - Manajemen Master Data Mahasiswa (Tambah, Edit, Hapus, Filter Divisi/Bidang, dan Batch CSV Import).
  - Manajemen Program Kerja / Acara HIMA (hanya 1 proker aktif bersamaan, auto-deactivate proker lain).
  - Pendaftaran otomatis kartu belum terdaftar (*Unknown Cards*).
  - Rekapitulasi & Export data presensi ke format CSV dengan sanitasi formula injection.
  - Indikator status perangkat IoT (Online / Offline).

- **Hardware & IoT Compatibility (ESP8266 REST Mode)**:
  - Endpoint REST API `/api/check_uid` (kompatibel penuh dengan firmware ESP8266 lama).
  - Endpoint telemetry `/api/esp_status` untuk heartbeat status perangkat.
  - Cooldown tap kartu 2 detik untuk mencegah duplicate tap ganda.
  - Pengecekan otomatis target audience kepanitiaan dan deteksi keterlambatan.

- **Desktop Application (Python Tkinter)**:
  - Antarmuka GUI desktop untuk monitoring dan rekapitulasi mandiri.
  - Terletak pada direktori `python/`.

---

## Struktur Direktori

```text
├── app/
│   ├── Http/Controllers/    # Controller REST API, Auth, Dashboard, Student, Event, Export, IoT
│   └── Models/              # Eloquent Models (Admin, Student, Event, Attendance, UnknownCard, dll.)
├── bootstrap/               # Bootstrap loader & exception / middleware config
├── config/                  # Konfigurasi aplikasi Laravel
├── database/
│   ├── factories/           # Factory seeder
│   ├── migrations/          # Migrasi skema database terstruktur
│   └── seeders/             # Database Seeder
├── public/
│   ├── assets/              # Desain Neo-Brutalist CSS, JS frontend, dan Firebase SDK
│   └── index.php            # Entry point web server
├── python/                  # Aplikasi desktop GUI Python (Tkinter)
├── resources/
│   └── views/               # Blade Templates (Layout Neo-Brutalist, Auth, Dashboard)
├── routes/
│   ├── api.php              # Rute hardware IoT
│   └── web.php              # Rute dashboard dan CRUD API terproteksi sesi
├── sql/                     # Skema SQL legacy dan import Hostinger
├── storage/                 # Cache, logs, dan sessions
├── tests/                   # Automated Feature & Unit Test Suite (PHPUnit)
├── .env.example             # Template konfigurasi environment
├── artisan                  # Artisan CLI runner
└── composer.json            # Manajemen dependensi PHP
```

---

## Panduan Instalasi & Menjalankan

### 1. Kebutuhan Sistem
- PHP >= 8.3 (direkomendasikan PHP 8.4)
- Composer
- Database MySQL / MariaDB

### 2. Instalasi Dependensi
```bash
composer install
```

### 3. Konfigurasi Environment
Salin template environment:
```bash
cp .env.example .env
php artisan key:generate
```
Sesuaikan konfigurasi database pada `.env`:
```ini
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=presensi
DB_USERNAME=root
DB_PASSWORD=
```

### 4. Migrasi Database
Jalankan migrasi tabel:
```bash
php artisan migrate
```

### 5. Menjalankan Server Lokal
```bash
php artisan serve
```
Akses dashboard melalui browser: `http://localhost:8000`.

---

## Pengujian Otomatis (PHPUnit)

Jalankan pengujian untuk memverifikasi seluruh fungsionalitas:
```bash
php vendor/bin/phpunit
# atau
php artisan test
```
Semua test mencakup pengujian autentikasi, aktivasi acara, API mahasiswa, dan kompatibilitas endpoint IoT ESP8266.
