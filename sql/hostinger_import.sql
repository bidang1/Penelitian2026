-- Database schema for Hostinger phpMyAdmin import
-- Safe for shared hosting: no CREATE DATABASE or USE statements

CREATE TABLE IF NOT EXISTS `students` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(50) NOT NULL COMMENT 'UID kartu RFID/NFC',
  `name` VARCHAR(100) NOT NULL COMMENT 'Nama mahasiswa',
  `nim` VARCHAR(20) DEFAULT NULL COMMENT 'Nomor Induk Mahasiswa',
  `category` ENUM('BPI', 'BPH', 'Anggota') NOT NULL DEFAULT 'Anggota' COMMENT 'Tingkat kepengurusan',
  `division` VARCHAR(100) DEFAULT NULL COMMENT 'Divisi/Departemen (cth: Inti, Kaderisasi, Kominfo, Humas)',
  `position` VARCHAR(100) DEFAULT NULL COMMENT 'Jabatan formal (cth: Ketua Umum, Ketua Divisi, Staf)',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=aktif, 0=nonaktif',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`),
  KEY `idx_category` (`category`),
  KEY `idx_division` (`division`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `events` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL COMMENT 'Nama acara atau program kerja',
  `description` TEXT DEFAULT NULL COMMENT 'Keterangan acara',
  `event_date` DATE NOT NULL COMMENT 'Tanggal pelaksanaan',
  `start_time` TIME NULL DEFAULT '08:00:00' COMMENT 'Jam mulai acara (WIB)',
  `end_time` TIME NULL DEFAULT NULL COMMENT 'Jam selesai acara (WIB)',
  `target_audience` ENUM('all', 'committee_only', 'bpi_bph') NOT NULL DEFAULT 'all' COMMENT 'Target presensi acara',
  `is_active` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=sedang berlangsung, 0=nonaktif',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `event_committees` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `event_id` INT(11) NOT NULL COMMENT 'Relasi ke events.id',
  `student_id` INT(11) NOT NULL COMMENT 'Relasi ke students.id',
  `role` VARCHAR(100) NOT NULL COMMENT 'Jabatan panitia: Ketua Panitia, Sekretaris, Bendahara, Sie Acara, dll',
  `division` VARCHAR(100) DEFAULT NULL COMMENT 'Sie / Seksi panitia (Acara, Perlengkapan, Konsumsi, dll)',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_event_student` (`event_id`, `student_id`),
  KEY `idx_event_comm` (`event_id`),
  KEY `idx_student_comm` (`student_id`),
  CONSTRAINT `fk_comm_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_comm_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `events` (`id`, `name`, `description`, `event_date`, `target_audience`, `is_active`) VALUES
(1, 'Kegiatan HIMA Umum', 'Presensi kegiatan reguler / program kerja HIMA', CURDATE(), 'all', 1)
ON DUPLICATE KEY UPDATE `name` = `name`;

CREATE TABLE IF NOT EXISTS `attendance` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `student_id` INT(11) NOT NULL COMMENT 'Relasi ke students.id',
  `event_id` INT(11) DEFAULT NULL COMMENT 'Relasi ke events.id',
  `session_id` VARCHAR(30) NOT NULL DEFAULT 'sesi_1' COMMENT 'ID sesi (sesi_1, sesi_2, dst)',
  `session_name` VARCHAR(60) NOT NULL DEFAULT 'Sesi 1 (Datang)' COMMENT 'Label sesi presensi',
  `telat` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0=tepat waktu, 1=telat',
  `uid` VARCHAR(50) NOT NULL COMMENT 'UID kartu',
  `tap_time` DATETIME NOT NULL COMMENT 'Waktu tap kartu',
  `tap_date` DATE NOT NULL COMMENT 'Tanggal tap',
  PRIMARY KEY (`id`),
  KEY `idx_student_date` (`student_id`, `tap_date`),
  KEY `idx_tap_date` (`tap_date`),
  KEY `idx_tap_date_session` (`tap_date`, `session_id`),
  KEY `idx_event_id` (`event_id`),
  KEY `idx_session_id` (`session_id`),
  UNIQUE KEY `uniq_student_event_date_session` (`student_id`, COALESCE(`event_id`,0), `tap_date`, `session_id`),
  CONSTRAINT `fk_attendance_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `unknown_cards` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(50) NOT NULL COMMENT 'UID kartu belum terdaftar',
  `first_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tap_count` INT(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Akun bawaan: username 'admin', password 'admin123'
INSERT INTO `admins` (`username`, `password_hash`, `name`) VALUES
('admin', '$2y$12$YEdqoOuXXO53jWnLFTyLoOsFPcFrrc3Imxs.f8i0P979dLPqF7lJa', 'Administrator Presensi')
ON DUPLICATE KEY UPDATE `username` = `username`;
