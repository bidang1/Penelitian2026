// app.js: Frontend controller untuk sistem presensi RFID HIMA (Dual-sync Firebase dan MySQL)

// Global Fetch Interceptor untuk Otomatisasi X-CSRF-Token pada Mutasi Lokal (Same-Origin)
const _originalFetch = window.fetch;
window.fetch = function(input, init = {}) {
  const options = { ...init };
  let method = options.method;
  if (!method && typeof input === 'object' && input !== null && 'method' in input) {
    method = input.method;
  }
  method = (method || 'GET').toUpperCase();

  // Hanya sematkan X-CSRF-Token pada request ke internal/origin sendiri
  let isSameOrigin = true;
  try {
    let urlStr = '';
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input && typeof input.url === 'string') {
      urlStr = input.url;
    } else if (input && typeof input.href === 'string') {
      urlStr = input.href;
    }
    if (/^(https?:)?\/\//i.test(urlStr)) {
      const parsedUrl = new URL(urlStr, window.location.origin);
      isSameOrigin = parsedUrl.origin === window.location.origin;
    }
  } catch {
    isSameOrigin = false;
  }

  if (isSameOrigin && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (csrfToken) {
      if (options.headers instanceof Headers) {
        options.headers.set('X-CSRF-Token', csrfToken);
      } else if (Array.isArray(options.headers)) {
        options.headers.push(['X-CSRF-Token', csrfToken]);
      } else {
        options.headers = {
          ...(options.headers || {}),
          'X-CSRF-Token': csrfToken
        };
      }
    }
  }
  return _originalFetch.call(this, input, options);
};

// Helper format tanggal lokal YYYY-MM-DD
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// State aplikasi
const state = {
  currentPanel: 'dashboard',
  selectedDate: getLocalDateString(),
  students: [],
  attendance: [],
  unknownCards: [],
  events: [],
  activeEvent: null,
  activeSession: { id: 'sesi_1', name: 'Sesi 1 (Datang / Pagi)' },
  categoryFilter: '', // '' = semua, 'BPI', 'BPH', 'Anggota'
  currentCommitteeEvent: null, // { id, name }
  totalHadir: 0,
  totalMhs: 0,
  pollInterval: null,
  editingStudent: null,
};

// Helper warna/badge kategori struktur organisasi HIMA
function getCategoryBadgeClass(category) {
  if (category === 'BPI') return 'badge-bpi';
  if (category === 'BPH') return 'badge-bph';
  return 'badge-anggota';
}

// Konfigurasi Sesi Presensi HIMA
const SESSION_CONFIG = {
  sesi_1: 'Sesi 1 (Datang / Pagi)',
  sesi_2: 'Sesi 2 (Setelah Ishoma / Siang)',
  sesi_3: 'Sesi 3 (Pulang / Penutupan)',
};

function formatSessionLabel(sessionId, sessionName) {
  if (sessionName) return sessionName;
  return SESSION_CONFIG[sessionId] || sessionId || 'Sesi 1';
}

function getSessionBadgeClass(sessionId) {
  if (sessionId === 'sesi_2') return 'badge-warning';
  if (sessionId === 'sesi_3') return 'badge-danger';
  return 'badge-primary';
}

async function onSessionChange(sessionId) {
  const sessionName = SESSION_CONFIG[sessionId] || sessionId;
  state.activeSession = { id: sessionId, name: sessionName };

  // Sinkronisasi ke Firebase Cloud agar pembaca RFID (ESP8266) langsung sinkron
  if (typeof window.setActiveSessionInFirebase === 'function') {
    try {
      await window.setActiveSessionInFirebase({ id: sessionId, name: sessionName });
    } catch (e) {
      console.warn('Firebase session sync notice:', e);
    }
  }

  showToast(`Sesi presensi aktif diubah ke: ${sessionName}`, 'info');
  loadDashboard();
}

function updateActiveSessionDisplay(sessionData) {
  if (!sessionData) return;
  const id = typeof sessionData === 'object' ? (sessionData.id || 'sesi_1') : String(sessionData || 'sesi_1');
  const name = (typeof sessionData === 'object' && sessionData.name) ? sessionData.name : (SESSION_CONFIG[id] || id);
  const status = (typeof sessionData === 'object' && sessionData.status) ? sessionData.status : 'aktif';

  state.activeSession = { id, name, status };

  const select = document.getElementById('select-active-session');
  if (select && select.value !== id) {
    select.value = id;
  }

  // Update session status badge
  const statusBadge = document.getElementById('session-status-badge');
  if (statusBadge) {
    if (status === 'nonaktif') {
      statusBadge.className = 'badge badge-warning font-mono font-bold text-xs';
      statusBadge.textContent = 'TELAT (KUNCI)';
      statusBadge.title = 'Sesi dikunci: Mahasiswa yang tap saat ini akan ditandai TELAT';
    } else {
      statusBadge.className = 'badge badge-success font-mono font-bold text-xs';
      statusBadge.textContent = 'BUKA (AKTIF)';
      statusBadge.title = 'Sesi dibuka: Mahasiswa yang tap saat ini tercatat HADIR tepat waktu';
    }
  }
}

async function toggleSessionStatus() {
  const currentStatus = (state.activeSession && state.activeSession.status) || 'aktif';
  const newStatus = currentStatus === 'nonaktif' ? 'aktif' : 'nonaktif';

  if (typeof window.setSessionStatusInFirebase === 'function') {
    try {
      await window.setSessionStatusInFirebase(newStatus);
      if (state.activeSession) {
        state.activeSession.status = newStatus;
        updateActiveSessionDisplay(state.activeSession);
      }
      const label = newStatus === 'nonaktif' ? 'KUNCI (Mode Telat Aktif)' : 'BUKA (Mode Normal/Tepat Waktu)';
      showToast(`Status sesi diubah: ${label}`, newStatus === 'nonaktif' ? 'warning' : 'success');
    } catch (e) {
      console.error('Failed to toggle session status:', e);
      showToast('Gagal mengubah status sesi', 'danger');
    }
  }
}

// API Endpoint lokal
const API = {
  attendance:      'api/attendance.php',
  students:        'api/students.php',
  unknownCards:    'api/unknown_cards.php',
  events:          'api/events.php',
  eventCommittees: 'api/event_committees.php',
  admin:           'api/admin.php',
  export:          'api/export.php',
};

// Navigation and panel switching
function showPanel(name, updateHistory = true) {
  if (!name || typeof name !== 'string') {
    name = 'dashboard';
  }
  state.currentPanel = name;

  // Toggle active class di nav items
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.panel === name);
  });

  // Toggle active class di panel sections (kompatibel class panel dan panel-section)
  document.querySelectorAll('.panel, .panel-section').forEach(el => {
    el.classList.remove('active');
  });

  // Tampilkan panel yang dipilih (fallback aman ke panel-dashboard jika target tidak ditemukan)
  let targetPanel = document.getElementById(`panel-${name}`) || document.getElementById(name);
  if (!targetPanel) {
    targetPanel = document.getElementById('panel-dashboard');
    name = 'dashboard';
    state.currentPanel = 'dashboard';
  }
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // Update browser history untuk Clean / Pretty URL
  if (updateHistory && window.history && window.history.pushState) {
    const currentPath = window.location.pathname.replace(/\/+$/, '').split('/').pop();
    if (currentPath !== name) {
      window.history.pushState({ panel: name }, '', name);
    }
  }

  // Update header page title & subtitle
  const panelTitles = {
    dashboard: ['Dashboard', 'Rekap absensi kehadiran hari ini'],
    tambah:    ['Pendaftaran Kartu', 'Registrasi kartu RFID mahasiswa baru'],
    mahasiswa: ['Data Mahasiswa', 'Daftar mahasiswa terdaftar di sistem'],
    rekap:     ['Rekap Absensi', 'Laporan riwayat kehadiran mahasiswa'],
    events:    ['Program Kerja', 'Manajemen acara dan kegiatan organisasi'],
  };
  const [tTitle, tSub] = panelTitles[name] || ['Presensi HIMA', 'Sistem Presensi RFID'];
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = tTitle;
  if (subEl) subEl.textContent = tSub;

  // Load data sesuai panel yang aktif
  if (name === 'dashboard') loadDashboard();
  if (name === 'tambah')    loadUnknownCards();
  if (name === 'mahasiswa') loadStudents();
  if (name === 'rekap')     loadRekap();
  if (name === 'events')    loadEvents();
}

// Helper format waktu 24 jam konsisten (HH:mm atau HH:mm:ss)
function formatTime24Hour(val, withSeconds = false) {
  if (!val && val !== 0) return '-';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '-';
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    if (withSeconds) {
      const s = String(val.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
    return `${h}:${m}`;
  }
  if (typeof val === 'number') {
    const ms = val < 1e11 ? val * 1000 : val;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      if (withSeconds) {
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
      }
      return `${h}:${m}`;
    }
  }

  const str = String(val).trim();
  if (!str) return '-';

  // 1. Deteksi AM / PM (12-hour format) di mana saja dalam string
  // Contoh: "10:15:20 PM", "2026-09-11 10:15:00 PM", "08.15 am", "2:30:00 p.m. WIB"
  const ampmMatch = str.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = ampmMatch[2];
    const s = ampmMatch[3];
    const isPm = ampmMatch[4].toLowerCase().startsWith('p');
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    const hStr = String(h).padStart(2, '0');
    if (withSeconds) return `${hStr}:${m}:${s || '00'}`;
    return `${hStr}:${m}`;
  }

  // 2. Deteksi format waktu standar dengan titik dua (HH:mm:ss atau HH:mm)
  // Bisa berdiri sendiri atau di akhir tanggal (cth: "2026-09-11 14:30:00", "14:30")
  const colonTimeMatch = str.match(/(?:^|\s|T)([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\s|$|[A-Z])/i);
  if (colonTimeMatch) {
    const h = colonTimeMatch[1].padStart(2, '0');
    const m = colonTimeMatch[2];
    const s = colonTimeMatch[3];
    if (withSeconds) return `${h}:${m}:${s || '00'}`;
    return `${h}:${m}`;
  }

  // 3. Deteksi format waktu Indonesia dengan titik (cth: "14.30" atau "08.15.00")
  const dotTimeMatch = str.match(/(?:^|\s)([01]?\d|2[0-3])\.([0-5]\d)(?:\.([0-5]\d))?(?:\s|$|wib)/i);
  if (dotTimeMatch) {
    const h = dotTimeMatch[1].padStart(2, '0');
    const m = dotTimeMatch[2];
    const s = dotTimeMatch[3];
    if (withSeconds) return `${h}:${m}:${s || '00'}`;
    return `${h}:${m}`;
  }

  // 4. Coba parse sebagai Date jika ada ISO string
  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime()) && str.includes('T')) {
    const h = String(parsedDate.getHours()).padStart(2, '0');
    const m = String(parsedDate.getMinutes()).padStart(2, '0');
    if (withSeconds) {
      const s = String(parsedDate.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
    return `${h}:${m}`;
  }

  // Fallback pengaman: hilangkan teks am/pm jika tersisa
  return str.replace(/\s*[ap]\.?m\.?/gi, '');
}
window.formatTime24Hour = formatTime24Hour;

// Realtime clock display (format 24 jam)
function updateClock() {
  const now  = new Date();
  const opts = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
  const liveDate = document.getElementById('live-date');
  const liveTime = document.getElementById('live-time');
  
  if (liveDate) liveDate.textContent = now.toLocaleDateString('id-ID', opts).toUpperCase();
  if (liveTime) {
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    liveTime.textContent = `${h}:${m}:${s}`;
  }
}

// Dashboard logic and data loading
async function loadDashboard() {
  const today = state.selectedDate || getLocalDateString();

  // 1. Prioritaskan data dari Firebase Cloud
  if (window.isFirebaseConnected && window.cloudUsers) {
    const cloudUserKeys = Object.keys(window.cloudUsers || {});
    state.totalMhs = cloudUserKeys.length;
    
    // Sesuaikan total mahasiswa dengan total panitia jika ada acara aktif
    const activeEvId = state.activeEvent?.id || window.cloudActiveEvent?.id;
    if (activeEvId && window.cloudEventCommittees && window.cloudEventCommittees[activeEvId]) {
      const commCount = Object.keys(window.cloudEventCommittees[activeEvId]).length;
      if (commCount > 0) {
        state.totalMhs = commCount;
      }
    }
    
    // Ambil log kehadiran HARI INI dari cloudLogs (hanya panitia)
    const allLogs = window.cloudLogs || [];
    const logsToday = allLogs.filter(l => (l.date || l.tap_date) === today);
    const uniqueUids = new Set(logsToday.map(l => l.uid));
    
    state.totalHadir = uniqueUids.size;
    state.attendance = logsToday;

    updateDashboardUI();
    return;
  }

  // 2. Fallback API lokal MySQL
  try {
    const res = await fetch(`${API.attendance}?date=${today}`);
    const data = await res.json();

    state.totalHadir = data.total_hadir || 0;
    state.totalMhs   = data.total_mhs   || 0;
    state.attendance = data.data        || [];

    updateDashboardUI();
  } catch (e) {
    console.error('Dashboard load error:', e);
    updateDashboardUI();
  }
}

function updateDashboardUI() {
  const elHadir = document.getElementById('stat-hadir');
  const elTotal = document.getElementById('stat-total');
  const elAlpha = document.getElementById('stat-alpha');
  const elPersen = document.getElementById('stat-persen');
  const elPersen2 = document.getElementById('stat-persen2');
  const elBarFill = document.getElementById('bar-fill');

  // Hitung kehadiran unik pada sesi aktif hari ini
  const activeSessId = state.activeSession?.id || 'sesi_1';
  const sessLogs = (state.attendance || []).filter(r => (r.session_id || 'sesi_1') === activeSessId);
  const sessUids = new Set(sessLogs.map(r => r.uid));
  const activeHadirCount = sessUids.size;

  if (elHadir) elHadir.textContent = activeHadirCount;
  if (elTotal) elTotal.textContent = state.totalMhs;
  if (elAlpha) elAlpha.textContent = Math.max(0, state.totalMhs - activeHadirCount);

  // Persentase kehadiran sesi aktif
  const pct = state.totalMhs > 0 ? Math.round((activeHadirCount / state.totalMhs) * 100) : 0;
  if (elPersen) elPersen.textContent = pct + '%';
  if (elPersen2) elPersen2.textContent = pct + '%';
  if (elBarFill) elBarFill.style.width = pct + '%';

  // Render tabel absensi hari ini (6 kolom)
  renderDashboardTable(state.attendance);

  // Live feed (tap terakhir hari ini)
  if (state.attendance.length > 0) {
    const last = state.attendance[0]; // paling baru
    updateLiveFeed(last.name, last.waktu, false, last.telat);
  }

  // Unknown cards badge
  const unknownList = window.cloudUnknownCards || state.unknownCards || [];
  const badge = document.getElementById('unknown-badge');
  if (badge) {
    if (unknownList.length > 0) {
      badge.textContent = unknownList.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function renderDashboardTable(records) {
  const tbody = document.getElementById('dashboard-tbody');
  if (!tbody) return;

  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="empty-state">
          <div class="empty-text">BELUM ADA ABSENSI HARI INI</div>
          <div class="empty-sub">Data akan muncul secara real-time saat kartu RFID di-tap</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = records.map((r, i) => {
    const isLate = r.telat === true || r.telat === 1 || r.telat === 'true';
    const statusBadge = isLate
      ? `<button type="button" class="badge badge-warning font-mono font-bold" onclick="toggleLogLateStatus('${r.id}')" style="cursor: pointer; border: 2px solid #000;" title="Klik untuk ubah menjadi Tepat Waktu">TELAT</button>`
      : `<button type="button" class="badge badge-success font-mono font-bold" onclick="toggleLogLateStatus('${r.id}')" style="cursor: pointer; border: 2px solid #000;" title="Klik untuk ubah menjadi Telat">TEPAT WAKTU</button>`;

    // Deteksi Kategori & Kepanitiaan
    const studentInfo = (state.students || []).find(s => s.uid === r.uid) || (window.cloudUsers && window.cloudUsers[r.uid]) || {};
    const cat = r.category || studentInfo.category || 'Anggota';
    const div = r.division || studentInfo.division || '';
    const pos = r.position || studentInfo.position || '';

    const activeEvId = state.activeEvent?.id;
    let commInfo = null;
    if (activeEvId && window.cloudEventCommittees && window.cloudEventCommittees[activeEvId]) {
      commInfo = window.cloudEventCommittees[activeEvId][r.uid];
    }

    return `
      <tr>
        <td class="font-mono font-bold">${i + 1}</td>
        <td><span class="td-uid font-mono">${escapeHtml(r.uid)}</span></td>
        <td class="td-name font-bold">
          <div>
            ${escapeHtml(r.name)}
            <span class="badge ${getCategoryBadgeClass(cat)} text-xs ml-1" style="font-size: 10px; padding: 1px 6px;">${escapeHtml(cat)}</span>
            ${commInfo ? `<span class="badge badge-committee text-xs ml-1" style="font-size: 10px; padding: 1px 6px;">${escapeHtml(commInfo.role || 'Panitia')}</span>` : ''}
          </div>
          ${(pos || div) ? `<div class="text-xs text-muted font-mono mt-0.5">${escapeHtml([pos, div].filter(Boolean).join(' • '))}</div>` : ''}
        </td>
        <td class="font-mono">${escapeHtml(r.nim || '-')}</td>
        <td class="font-mono"><span class="badge ${getSessionBadgeClass(r.session_id)}">${escapeHtml(formatSessionLabel(r.session_id, r.session_name))}</span></td>
        <td class="font-mono font-bold">${escapeHtml(formatTime24Hour(r.waktu))}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

let lastRecordedTapKey = '';
let isInitialAppLoad = true;
setTimeout(() => {
  isInitialAppLoad = false;
}, 2000);

function updateLiveFeed(name, time, playSound = true, isLate = false) {
  const el = document.getElementById('latest-tap');
  if (!el) return;
  
  if (!name) {
    el.innerHTML = '<span class="text-muted">Menunggu tap kartu RFID...</span>';
    return;
  }

  const isLateBool = isLate === true || isLate === 1 || isLate === 'true';
  const statusBadge = isLateBool
    ? `<span class="badge badge-warning font-mono font-bold" style="margin-left: 8px; border: 2px solid #000;">TELAT</span>`
    : `<span class="badge badge-success font-mono font-bold" style="margin-left: 8px; border: 2px solid #000;">TEPAT WAKTU</span>`;

  el.innerHTML = `
    <span class="tap-name">${escapeHtml(name)}</span>
    <span class="tap-time font-mono font-bold">[${escapeHtml(formatTime24Hour(time))}]</span>
    ${statusBadge}
  `;

  const tapKey = `${name}_${time}_${isLateBool ? '1' : '0'}`;
  if (tapKey !== lastRecordedTapKey) {
    lastRecordedTapKey = tapKey;
    if (playSound && !isInitialAppLoad) {
      playTapChime();
    }
  }
}

// Panel tambah mahasiswa dan kartu belum terdaftar
async function loadUnknownCards() {
  // 1. Jika ada data cloud
  if (window.isFirebaseConnected && window.cloudUnknownCards) {
    state.unknownCards = window.cloudUnknownCards;
    renderUnknownCards(state.unknownCards);
    return;
  }

  // 2. Fallback API lokal MySQL
  try {
    const res = await fetch(API.unknownCards);
    const data = await res.json();
    state.unknownCards = data.data || [];
    renderUnknownCards(state.unknownCards);
  } catch (e) {
    console.error('Unknown cards load error:', e);
  }
}

function renderUnknownCards(cards) {
  const tbody = document.getElementById('unknown-tbody');
  const countBadge = document.getElementById('unknown-count-badge');
  if (countBadge) countBadge.textContent = `${(cards || []).length} KARTU`;
  if (!tbody) return;

  if (!cards || cards.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="empty-state">
          <div class="empty-text">TIDAK ADA KARTU BARU TERDETEKSI</div>
          <div class="empty-sub">Tempelkan kartu RFID baru ke alat untuk memunculkan UID otomatis di sini</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = cards.map((c, i) => `
    <tr>
      <td class="font-mono font-bold">${i + 1}</td>
      <td><span class="td-uid font-mono">${escapeHtml(c.uid)}</span></td>
      <td class="font-mono">${c.tap_count || 1}x</td>
      <td class="font-mono text-sm">${formatDate(c.last_seen)}</td>
      <td>
        <button class="btn btn-warning btn-sm" onclick="openRegisterModal('${escapeJsString(c.uid)}')">
          + Daftarkan
        </button>
      </td>
    </tr>
  `).join('');
}

// Modal Registrasi
function openRegisterModal(uid = '') {
  const modal = document.getElementById('modal-register');
  const input = document.getElementById('reg-uid');
  if (input) input.value = uid;
  document.getElementById('reg-name').value = '';
  document.getElementById('reg-nim').value  = '';
  const catEl = document.getElementById('reg-category');
  if (catEl) catEl.value = 'Anggota';
  const divEl = document.getElementById('reg-division');
  if (divEl) divEl.value = '';
  const posEl = document.getElementById('reg-position');
  if (posEl) posEl.value = '';

  if (modal) {
    modal.classList.add('active', 'open');
    setTimeout(() => {
      document.getElementById('reg-name')?.focus();
    }, 50);
  }
}

function openAddManualModal() {
  openRegisterModal('');
}

function closeRegisterModal() {
  const modal = document.getElementById('modal-register');
  if (modal) modal.classList.remove('active', 'open');
}

async function submitRegister() {
  const uid      = document.getElementById('reg-uid').value.trim().toUpperCase();
  const name     = document.getElementById('reg-name').value.trim();
  const nim      = document.getElementById('reg-nim').value.trim();
  const category = document.getElementById('reg-category')?.value || 'Anggota';
  const division = document.getElementById('reg-division')?.value.trim() || '';
  const position = document.getElementById('reg-position')?.value.trim() || '';

  if (!uid)  { showToast('UID kartu tidak boleh kosong', 'warning'); return; }
  if (!name) { showToast('Nama mahasiswa wajib diisi', 'warning'); return; }

  // 1. Simpan ke Firebase Cloud
  if (typeof window.registerUserToFirebase === 'function') {
    await window.registerUserToFirebase(uid, name, nim, category, division, position);
  }

  // 2. Simpan ke MySQL jika aktif
  try {
    const res = await fetch(API.students, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, name, nim, category, division, position }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal menyimpan data ke database');
    }
  } catch (e) {
    if (!window.isFirebaseConnected) {
      showToast(e.message || 'Gagal mendaftarkan mahasiswa', 'danger');
      return;
    }
  }

  showToast(`Mahasiswa "${name}" (${category}) berhasil didaftarkan!`, 'success');
  closeRegisterModal();
  loadUnknownCards();
  loadStudents();
  loadDashboard();
}

// Filter Tab Kategori Mahasiswa (BPI / BPH / Anggota)
function filterStudentsByCategory(category) {
  state.categoryFilter = category;

  const btnAll     = document.getElementById('filter-btn-all');
  const btnBpi     = document.getElementById('filter-btn-bpi');
  const btnBph     = document.getElementById('filter-btn-bph');
  const btnAnggota = document.getElementById('filter-btn-anggota');

  if (btnAll)     btnAll.classList.toggle('active', category === '');
  if (btnBpi)     btnBpi.classList.toggle('active', category === 'BPI');
  if (btnBph)     btnBph.classList.toggle('active', category === 'BPH');
  if (btnAnggota) btnAnggota.classList.toggle('active', category === 'Anggota');

  const q = document.getElementById('search-students')?.value || '';
  renderStudentsTable(state.students, q);
}

// Panel data mahasiswa
async function loadStudents(searchQuery = '') {
  // 1. Jika ada data di Firebase Cloud
  if (window.isFirebaseConnected && window.cloudUsers) {
    renderCloudStudents(searchQuery);
    return;
  }

  // 2. Fallback API lokal MySQL
  try {
    const res = await fetch(API.students);
    const data = await res.json();
    state.students = data.data || [];
    renderStudentsTable(state.students, searchQuery);
  } catch (e) {
    console.error('Students load error:', e);
  }
}

function renderCloudStudents(searchQuery = '') {
  const users = window.cloudUsers || {};
  const list = Object.keys(users).map(uid => ({
    id: '',
    uid: uid,
    name: users[uid].name || '-',
    nim: users[uid].nim || '-',
    category: users[uid].category || 'Anggota',
    division: users[uid].division || '',
    position: users[uid].position || '',
    created_at: users[uid].registered_at ? new Date(users[uid].registered_at).toISOString() : '-'
  }));

  state.students = list;
  renderStudentsTable(list, searchQuery);
}

function renderStudentsTable(students, searchQuery = '') {
  const tbody = document.getElementById('students-tbody');
  const countBadge = document.getElementById('mhs-count-badge');
  const allList = students || [];

  // Update tab filter counter badges
  const cAll     = allList.length;
  const cBpi     = allList.filter(s => s.category === 'BPI').length;
  const cBph     = allList.filter(s => s.category === 'BPH').length;
  const cAnggota = allList.filter(s => !s.category || s.category === 'Anggota').length;

  const elAll     = document.getElementById('count-all');
  const elBpi     = document.getElementById('count-bpi');
  const elBph     = document.getElementById('count-bph');
  const elAnggota = document.getElementById('count-anggota');

  if (elAll)     elAll.textContent     = cAll;
  if (elBpi)     elBpi.textContent     = cBpi;
  if (elBph)     elBph.textContent     = cBph;
  if (elAnggota) elAnggota.textContent = cAnggota;

  if (countBadge) countBadge.textContent = `${cAll} MAHASISWA`;
  if (!tbody) return;

  let displayList = allList;

  // 1. Terapkan Filter Kategori Struktur
  if (state.categoryFilter) {
    displayList = displayList.filter(s => (s.category || 'Anggota') === state.categoryFilter);
  }

  // 2. Terapkan Search Query
  if (searchQuery && typeof searchQuery === 'string') {
    const q = searchQuery.toLowerCase().trim();
    displayList = displayList.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.nim && s.nim.toLowerCase().includes(q)) ||
      (s.uid && s.uid.toLowerCase().includes(q)) ||
      (s.division && s.division.toLowerCase().includes(q)) ||
      (s.position && s.position.toLowerCase().includes(q))
    );
  }

  if (displayList.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-text">TIDAK ADA DATA MAHASISWA</div>
          <div class="empty-sub">Sesuaikan filter kategori atau daftarkan mahasiswa baru melalui tombol "+ Tambah Mahasiswa"</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map((s, i) => {
    let hadirCount = s.total_hadir;
    if (hadirCount === undefined && window.cloudLogs) {
      hadirCount = window.cloudLogs.filter(l => l.uid === s.uid).length;
    }
    hadirCount = hadirCount || 0;

    const cat = s.category || 'Anggota';
    const catBadgeClass = getCategoryBadgeClass(cat);

    return `
    <tr>
      <td class="font-mono font-bold">${i + 1}</td>
      <td><span class="td-uid font-mono">${escapeHtml(s.uid)}</span></td>
      <td class="td-name font-bold">${escapeHtml(s.name)}</td>
      <td class="font-mono">${escapeHtml(s.nim || '-')}</td>
      <td><span class="badge ${catBadgeClass} font-mono font-bold text-xs">${escapeHtml(cat)}</span></td>
      <td>
        <div class="font-bold text-xs">${escapeHtml(s.position || '-')}</div>
        ${s.division ? `<div class="text-xs text-muted font-mono">${escapeHtml(s.division)}</div>` : ''}
      </td>
      <td class="font-mono font-bold"><span class="badge badge-warning">${hadirCount}x</span></td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="openEditModal('${escapeJsString(s.uid)}', '${escapeJsString(s.name)}', '${escapeJsString(s.nim || '')}', '${escapeJsString(s.id || '')}', '${escapeJsString(cat)}', '${escapeJsString(s.division || '')}', '${escapeJsString(s.position || '')}')">
            Edit
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteStudent('${escapeJsString(s.uid)}', '${escapeJsString(s.name)}', '${escapeJsString(s.id || '')}')">
            Hapus
          </button>
        </div>
      </td>
    </tr>
  `}).join('');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

let searchStudentsTimer = null;
function searchStudents(query) {
  if (query === undefined) {
    query = document.getElementById('search-students')?.value || '';
  }
  clearTimeout(searchStudentsTimer);
  searchStudentsTimer = setTimeout(() => {
    loadStudents(query);
  }, 250);
}

// Modal Edit
function openEditModal(uid, name, nim, id, category = 'Anggota', division = '', position = '') {
  const modal = document.getElementById('modal-edit');
  document.getElementById('edit-uid').value  = uid;
  document.getElementById('edit-name').value = name;
  document.getElementById('edit-nim').value  = nim;
  document.getElementById('edit-id').value   = id;

  const catEl = document.getElementById('edit-category');
  if (catEl) catEl.value = category || 'Anggota';
  const divEl = document.getElementById('edit-division');
  if (divEl) {
    if (division && !Array.from(divEl.options).some(o => o.value.toLowerCase() === division.toLowerCase())) {
      const customOpt = document.createElement('option');
      customOpt.value = division;
      customOpt.textContent = division;
      divEl.appendChild(customOpt);
    }
    const matchingOpt = Array.from(divEl.options).find(o => o.value.toLowerCase() === (division || '').toLowerCase());
    divEl.value = matchingOpt ? matchingOpt.value : (division || '');
  }
  const posEl = document.getElementById('edit-position');
  if (posEl) posEl.value = position || '';

  if (modal) {
    modal.classList.add('active', 'open');
    setTimeout(() => {
      document.getElementById('edit-name')?.focus();
    }, 50);
  }
}

function closeEditModal() {
  const modal = document.getElementById('modal-edit');
  if (modal) modal.classList.remove('active', 'open');
}

async function submitEdit() {
  const uid      = document.getElementById('edit-uid').value.trim().toUpperCase();
  const name     = document.getElementById('edit-name').value.trim();
  const nim      = document.getElementById('edit-nim').value.trim();
  const category = document.getElementById('edit-category')?.value || 'Anggota';
  const division = document.getElementById('edit-division')?.value.trim() || '';
  const position = document.getElementById('edit-position')?.value.trim() || '';
  const rawId    = document.getElementById('edit-id')?.value || '';
  const id       = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : 0;

  if (!name) { showToast('Nama mahasiswa tidak boleh kosong', 'warning'); return; }

  // 1. Update ke Firebase Cloud
  if (typeof window.registerUserToFirebase === 'function') {
    await window.registerUserToFirebase(uid, name, nim, category, division, position);
  }

  // 2. Update ke MySQL jika aktif
  try {
    const res = await fetch(API.students, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, uid, name, nim, category, division, position }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal memperbarui database');
    }
  } catch (e) {
    if (!window.isFirebaseConnected) {
      showToast(e.message || 'Gagal memperbarui data', 'danger');
      return;
    }
  }

  showToast('Data mahasiswa berhasil diperbarui', 'success');
  closeEditModal();
  loadStudents();
  loadDashboard();
}

async function deleteStudent(uid, name, id = null) {
  if (!confirm(`Yakin hapus data mahasiswa "${name}"?\nData kartu akan dihapus dari sistem.`)) return;

  // 1. Hapus dari Firebase Cloud
  if (typeof window.deleteUserFromFirebase === 'function') {
    await window.deleteUserFromFirebase(uid);
  }

  // 2. Hapus dari MySQL jika aktif
  try {
    const rawId = String(id || '');
    const numId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : 0;
    const res = await fetch(API.students, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: numId, uid }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal menghapus data dari database');
    }
  } catch (e) {
    if (!window.isFirebaseConnected) {
      showToast(e.message || 'Gagal menghapus data', 'danger');
      return;
    }
  }

  showToast(`Mahasiswa "${name}" berhasil dihapus`, 'success');
  loadStudents();
  loadDashboard();
}

// Rekap absensi
async function loadRekap() {
  const dateInput = document.getElementById('rekap-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = state.selectedDate || getLocalDateString();
  }
  const date = dateInput ? dateInput.value : state.selectedDate;
  const sessionFilter = document.getElementById('rekap-session-filter')?.value || '';

  // 1. Jika ada data presensi di Firebase Cloud
  if (window.isFirebaseConnected && window.cloudLogs) {
    let filteredLogs = (window.cloudLogs || []).filter(l => (l.date || l.tap_date) === date);
    if (sessionFilter) {
      filteredLogs = filteredLogs.filter(l => (l.session_id || 'sesi_1') === sessionFilter);
    }
    state.attendance = filteredLogs;
    const summary = {
      total_hadir: new Set(filteredLogs.map(l => l.uid)).size,
      total_mhs: Object.keys(window.cloudUsers || {}).length
    };
    renderRekapTable(filteredLogs, summary);
    return;
  }

  // 2. Fallback ke MySQL
  try {
    const url = sessionFilter
      ? `${API.attendance}?date=${encodeURIComponent(date)}&session_id=${encodeURIComponent(sessionFilter)}`
      : `${API.attendance}?date=${encodeURIComponent(date)}`;
    const res  = await fetch(url);
    const data = await res.json();
    state.attendance = data.data || [];
    renderRekapTable(state.attendance, data);
  } catch (e) {
    console.error(e);
  }
}

function renderRekapTable(records, summary) {
  const tbody = document.getElementById('rekap-tbody');
  if (!tbody) return;

  // Update summary stats
  if (summary) {
    const elHadir = document.getElementById('rekap-total-hadir');
    const elMhs   = document.getElementById('rekap-total-mhs');
    const elPersen= document.getElementById('rekap-persen');
    const elTelat = document.getElementById('rekap-total-telat');
    
    if (elHadir) elHadir.textContent = summary.total_hadir || 0;
    if (elMhs)   elMhs.textContent   = summary.total_mhs   || 0;
    const pct = summary.total_mhs > 0 ? Math.round((summary.total_hadir / summary.total_mhs) * 100) : 0;
    if (elPersen) elPersen.textContent = pct + '%';

    const lateCount = (records || []).filter(r => r.telat === true || r.telat === 1 || r.telat === 'true').length;
    if (elTelat) elTelat.textContent = lateCount;
  }

  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-text">TIDAK ADA DATA PRESENSI PADA TANGGAL / SESI INI</div>
          <div class="empty-sub">Pilih tanggal atau filter sesi lain untuk melihat riwayat kehadiran</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = records.map((r, i) => {
    const isLate = r.telat === true || r.telat === 1 || r.telat === 'true';
    const statusBadge = isLate
      ? `<button type="button" class="badge badge-warning font-mono font-bold" onclick="toggleLogLateStatus('${r.id}')" style="cursor: pointer; border: 2px solid #000;" title="Klik untuk ubah menjadi Hadir Tepat Waktu">TELAT</button>`
      : `<button type="button" class="badge badge-success font-mono font-bold" onclick="toggleLogLateStatus('${r.id}')" style="cursor: pointer; border: 2px solid #000;" title="Klik untuk ubah menjadi Telat">HADIR</button>`;

    // Deteksi Kategori & Kepanitiaan
    const studentInfo = (state.students || []).find(s => s.uid === r.uid) || (window.cloudUsers && window.cloudUsers[r.uid]) || {};
    const cat = r.category || studentInfo.category || 'Anggota';
    const pos = r.position || studentInfo.position || '';
    const div = r.division || studentInfo.division || '';

    // Cek status kepanitiaan acara aktif
    const activeEvId = state.activeEvent?.id;
    let commInfo = null;
    if (activeEvId && window.cloudEventCommittees && window.cloudEventCommittees[activeEvId]) {
      commInfo = window.cloudEventCommittees[activeEvId][r.uid];
    }

    return `
      <tr>
        <td class="font-mono font-bold">${i + 1}</td>
        <td><span class="td-uid font-mono">${escapeHtml(r.uid)}</span></td>
        <td class="td-name font-bold">${escapeHtml(r.name)}</td>
        <td class="font-mono">${escapeHtml(r.nim || '-')}</td>
        <td>
          <span class="badge ${getCategoryBadgeClass(cat)} font-mono font-bold text-xs">${escapeHtml(cat)}</span>
          ${commInfo ? `<div class="mt-1"><span class="badge badge-committee font-mono text-xs">${escapeHtml(commInfo.role || 'Panitia')}</span></div>` : ((pos || div) ? `<div class="text-xs font-mono text-muted mt-1">${escapeHtml([pos, div].filter(Boolean).join(' • '))}</div>` : '')}
        </td>
        <td class="font-mono"><span class="badge ${getSessionBadgeClass(r.session_id)}">${escapeHtml(formatSessionLabel(r.session_id, r.session_name))}</span></td>
        <td class="font-mono font-bold">${escapeHtml(formatTime24Hour(r.waktu))}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

async function clearRekapByDate() {
  const dateInput = document.getElementById('rekap-date');
  const date = dateInput ? dateInput.value : state.selectedDate;
  if (!date) {
    showToast('Pilih tanggal terlebih dahulu', 'warning');
    return;
  }

  if (!confirm(`Hapus seluruh log rekap presensi pada tanggal ${date} (Lokal & Cloud)?`)) {
    return;
  }

  let mysqlSuccess = false;
  let cloudDeleted = 0;

  // 1. Hapus dari database MySQL lokal via API
  try {
    const res = await fetch(API.attendance, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date })
    });
    const data = await res.json();
    if (data.success) {
      mysqlSuccess = true;
    }
  } catch (e) {
    console.warn('MySQL clear attendance notice:', e);
  }

  // 2. Hapus dari database Firebase Cloud (jika terhubung)
  if (typeof window.clearRekapFromFirebase === 'function' && window.isFirebaseConnected) {
    try {
      cloudDeleted = await window.clearRekapFromFirebase(date);
    } catch (e) {
      console.warn('Firebase clear attendance notice:', e);
    }
  }

  if (mysqlSuccess || cloudDeleted > 0) {
    showToast(`Rekap kehadiran tanggal ${date} berhasil dibersihkan`, 'success');
    loadRekap();
    loadDashboard();
  } else {
    showToast('Tidak ada data yang dihapus atau gagal memproses permintaan', 'info');
  }
}

// Export CSV dan Excel

function sanitizeCellForCsv(val) {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

// 1. Download CSV Bersih & Standar (Kompatibel Excel, Google Sheets, dll.)
function downloadCSV(filename, headers, rows) {
  if (!rows || rows.length === 0) {
    showToast('Tidak ada data untuk di-download', 'warning');
    return;
  }

  // UTF-8 BOM (\uFEFF)
  let csvContent = '\uFEFF';
  csvContent += headers.map(h => `"${sanitizeCellForCsv(h).replace(/"/g, '""')}"`).join(',') + '\r\n';

  rows.forEach(row => {
    csvContent += row.map(col => `"${sanitizeCellForCsv(col).replace(/"/g, '""')}"`).join(',') + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`File CSV "${filename}.csv" berhasil di-download!`, 'success');
}

// 2. Download Excel (.xlsx Asli via SheetJS dengan Auto-Fit Kolom & Fallback XML Rapi)
function downloadExcel(filename, title, period, headers, rows) {
  if (!rows || rows.length === 0) {
    showToast('Tidak ada data untuk di-download', 'warning');
    return;
  }

  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const dateNow = now.toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' }) + ` ${h}:${m}:${s}`;

  // JIKA LIBRARY SheetJS (XLSX) TERSEDIA -> BUAT FILE ASLI .XLSX BERSIH & RAPI
  if (typeof XLSX !== 'undefined') {
    try {
      const wsData = [
        ['SISTEM PRESENSI MAHASISWA BERBASIS RFID (HIMA)'],
        [title],
        [`Periode: ${period || '-'} | Waktu Cetak: ${dateNow}`],
        [], // baris kosong pemisah
        headers,
        ...rows.map(r => r.map(c => String(c ?? '-')))
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Lebar kolom otomatis proporsional
      const colWidths = headers.map((h, i) => {
        let maxLen = h.length;
        rows.forEach(r => {
          const valStr = String(r[i] ?? '');
          if (valStr.length > maxLen) maxLen = valStr.length;
        });
        return { wch: Math.max(maxLen + 4, 10) };
      });

      // Override lebar khusus agar nyaman (10 kolom presensi)
      if (colWidths[0]) colWidths[0].wch = 6;  // No
      if (colWidths[1]) colWidths[1].wch = 28; // Nama
      if (colWidths[2]) colWidths[2].wch = 18; // NIM
      if (colWidths[3]) colWidths[3].wch = 18; // Kategori Struktur
      if (colWidths[4]) colWidths[4].wch = 18; // Bidang
      if (colWidths[5]) colWidths[5].wch = 20; // Jabatan Panitia
      if (colWidths[6]) colWidths[6].wch = 18; // Status Kehadiran
      if (colWidths[7]) colWidths[7].wch = 20; // Sesi Presensi
      if (colWidths[8]) colWidths[8].wch = 14; // Tanggal
      if (colWidths[9]) colWidths[9].wch = 12; // Jam Tap

      ws['!cols'] = colWidths;

      // Merge judul utama baris 1-3
      const lastColIndex = headers.length - 1;
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: lastColIndex } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: lastColIndex } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: lastColIndex } }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Presensi');
      XLSX.writeFile(wb, `${filename}.xlsx`);
      showToast(`File Excel "${filename}.xlsx" berhasil di-download!`, 'success');
      return;
    } catch (e) {
      console.warn('SheetJS export notice, fallback ke XML:', e);
    }
  }

  // FALLBACK KE FORMAT EXCEL XML BERSIH (TABEL TUNGGAL RAPI TANPA KARTU MERUSAK GRID)
  const numCols = headers.length;
  let html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <style>
        body { font-family: Arial, sans-serif; font-size: 10pt; }
        table { border-collapse: collapse; width: 100%; }
        .header-title { font-size: 14pt; font-weight: bold; text-align: center; height: 30px; }
        .header-sub { font-size: 10pt; color: #555555; text-align: center; height: 20px; }
        th { background-color: #2563eb; color: #ffffff; font-weight: bold; border: 1px solid #1e40af; padding: 8px; text-align: center; }
        td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: middle; }
        .text-center { text-align: center; }
        .txt { mso-number-format:"\\@"; text-align: center; }
        .badge { background-color: #dcfce7; color: #166534; font-weight: bold; text-align: center; }
        .badge-late { background-color: #fef3c7; color: #b45309; font-weight: bold; text-align: center; border: 1px solid #fde68a; }
      </style>
    </head>
    <body>
      <table>
        <col width="50">
        <col width="220">
        <col width="140">
        <col width="140">
        <col width="140">
        <col width="160">
        <col width="140">
        <col width="160">
        <col width="120">
        <col width="100">
        <tr>
          <td colspan="${numCols}" class="header-title">${title}</td>
        </tr>
        <tr>
          <td colspan="${numCols}" class="header-sub">Sistem Presensi Mahasiswa Berbasis RFID (HIMA)</td>
        </tr>
        <tr>
          <td colspan="${numCols}" class="header-sub">Periode / Tanggal: ${period || '-'} | Waktu Cetak: ${dateNow}</td>
        </tr>
        <tr style="height: 12px;"><td colspan="${numCols}" style="border: none;"></td></tr>
        <tr>
          ${headers.map(h => `<th>${h}</th>`).join('')}
        </tr>
        ${rows.map((r, i) => `
          <tr style="${i % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
            ${r.map((c, colIdx) => {
              let cls = '';
              if (colIdx === 0) cls = 'text-center';
              else if (colIdx === 2) cls = 'txt';
              else if (String(c).includes('HADIR') || String(c).includes('TELAT')) {
                cls = String(c).includes('TELAT') ? 'badge-late' : 'badge';
              }
              else if (colIdx >= 7) cls = 'text-center';
              return `<td class="${cls}">${c ?? '-'}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`File Excel "${filename}.xls" berhasil di-download!`, 'success');
}

// 1. Export Data Hari Ini (Dashboard)
function exportAttendanceToday(format = 'csv') {
  const today = state.selectedDate || getLocalDateString();
  const allLogs = (window.cloudLogs && window.cloudLogs.length > 0) ? window.cloudLogs : (state.attendance || []);
  const logsToday = allLogs.filter(l => (l.date || l.tap_date) === today);

  if (logsToday.length === 0) {
    showToast(`Belum ada data presensi hari ini (${today})`, 'warning');
    return;
  }

  const activeEvId = state.activeEvent?.id;
  const commMap = (activeEvId && window.cloudEventCommittees && window.cloudEventCommittees[activeEvId]) || {};

  const headers = ['No', 'Nama Mahasiswa', 'NIM', 'Kategori Struktur', 'Bidang', 'Jabatan Panitia', 'Status Kehadiran', 'Sesi Presensi', 'Tanggal', 'Jam Tap'];
  const rows = logsToday.map((r, i) => {
    const studentInfo = (state.students || []).find(s => s.uid === r.uid) || (window.cloudUsers && window.cloudUsers[r.uid]) || {};
    const panitia = commMap[r.uid] || {};
    return [
      i + 1,
      r.name,
      r.nim || '-',
      r.category || studentInfo.category || 'Anggota',
      r.division || studentInfo.division || '-',
      panitia.role || '-',
      (r.telat === true || r.telat === 1 || r.telat === 'true') ? 'HADIR (TELAT)' : 'HADIR',
      formatSessionLabel(r.session_id, r.session_name),
      r.date || r.tap_date || today,
      formatTime24Hour(r.waktu)
    ];
  });

  const filename = `Presensi_Hari_Ini_${today}`;
  if (format === 'excel' || format === 'xls') {
    downloadExcel(filename, 'REKAPITULASI PRESENSI MAHASISWA (HARI INI)', today, headers, rows);
  } else {
    downloadCSV(filename, headers, rows);
  }
}

// 2. Export Data Sesuai Tanggal Rekap
function exportAttendance(format = 'csv') {
  const date = document.getElementById('rekap-date')?.value || state.selectedDate || getLocalDateString();
  const sessionFilter = document.getElementById('rekap-session-filter')?.value || '';
  const allLogs = (window.cloudLogs && window.cloudLogs.length > 0) ? window.cloudLogs : (state.attendance || []);
  let logsFiltered = allLogs.filter(l => (l.date || l.tap_date) === date);
  if (sessionFilter) {
    logsFiltered = logsFiltered.filter(l => (l.session_id || 'sesi_1') === sessionFilter);
  }

  if (logsFiltered.length === 0) {
    showToast(`Tidak ada data presensi pada tanggal ${date}${sessionFilter ? ' untuk ' + formatSessionLabel(sessionFilter) : ''}`, 'warning');
    return;
  }

  const activeEvId = state.activeEvent?.id;
  const commMap = (activeEvId && window.cloudEventCommittees && window.cloudEventCommittees[activeEvId]) || {};

  const headers = ['No', 'Nama Mahasiswa', 'NIM', 'Kategori Struktur', 'Bidang', 'Jabatan Panitia', 'Status Kehadiran', 'Sesi Presensi', 'Tanggal', 'Jam Tap'];
  const rows = logsFiltered.map((r, i) => {
    const studentInfo = (state.students || []).find(s => s.uid === r.uid) || (window.cloudUsers && window.cloudUsers[r.uid]) || {};
    const panitia = commMap[r.uid] || {};
    return [
      i + 1,
      r.name,
      r.nim || '-',
      r.category || studentInfo.category || 'Anggota',
      r.division || studentInfo.division || '-',
      panitia.role || '-',
      (r.telat === true || r.telat === 1 || r.telat === 'true') ? 'HADIR (TELAT)' : 'HADIR',
      formatSessionLabel(r.session_id, r.session_name),
      r.date || r.tap_date || date,
      formatTime24Hour(r.waktu)
    ];
  });

  const sessSuffix = sessionFilter ? `_${sessionFilter}` : '';
  const filename = `Rekap_Presensi_${date}${sessSuffix}`;
  if (format === 'excel' || format === 'xls') {
    downloadExcel(filename, `REKAP PRESENSI MAHASISWA (${date}${sessionFilter ? ' - ' + formatSessionLabel(sessionFilter) : ''})`, date, headers, rows);
  } else {
    downloadCSV(filename, headers, rows);
  }
}

// 3. Export Semua Riwayat Absensi
async function exportAllAttendance(format = 'csv') {
  let allLogs = (window.cloudLogs && window.cloudLogs.length > 0) ? window.cloudLogs : [];

  if (allLogs.length === 0) {
    try {
      const res = await fetch(`${API.attendance}?all=1`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.data)) {
        allLogs = data.data;
      }
    } catch (e) {
      console.warn('Gagal memuat seluruh riwayat presensi dari MySQL:', e);
    }
  }

  if (allLogs.length === 0) {
    showToast('Tidak ada data riwayat presensi', 'warning');
    return;
  }

  const headers = ['No', 'Nama Mahasiswa', 'NIM', 'Kategori Struktur', 'Bidang', 'Status Kehadiran', 'Sesi Presensi', 'Tanggal', 'Jam Tap'];
  const rows = allLogs.map((r, i) => {
    const studentInfo = (state.students || []).find(s => s.uid === r.uid) || (window.cloudUsers && window.cloudUsers[r.uid]) || {};
    return [
      i + 1,
      r.name,
      r.nim || '-',
      r.category || studentInfo.category || 'Anggota',
      r.division || studentInfo.division || '-',
      (r.telat === true || r.telat === 1 || r.telat === 'true') ? 'HADIR (TELAT)' : 'HADIR',
      formatSessionLabel(r.session_id, r.session_name),
      r.date || r.tap_date || '-',
      formatTime24Hour(r.waktu)
    ];
  });

  const filename = `Rekap_Presensi_Keseluruhan_${getLocalDateString()}`;
  if (format === 'excel' || format === 'xls') {
    downloadExcel(filename, 'REKAP KESELURUHAN LOG PRESENSI MAHASISWA', 'Semua Riwayat', headers, rows);
  } else {
    downloadCSV(filename, headers, rows);
  }
}

// 4. Export Daftar Mahasiswa Terdaftar
function exportStudents(format = 'csv') {
  const students = state.students || [];

  if (students.length === 0) {
    showToast('Belum ada data mahasiswa terdaftar', 'warning');
    return;
  }

  const headers = ['No', 'UID Kartu', 'Nama Mahasiswa', 'NIM', 'Kategori Struktur', 'Bidang', 'Jabatan', 'Tanggal Terdaftar'];
  const rows = students.map((s, i) => [
    i + 1,
    s.uid,
    s.name,
    s.nim || '-',
    s.category || 'Anggota',
    s.division || '-',
    s.position || '-',
    formatDate(s.created_at)
  ]);

  const filename = `Daftar_Mahasiswa_${getLocalDateString()}`;
  if (format === 'excel' || format === 'xls') {
    downloadExcel(filename, 'DAFTAR MAHASISWA TERDAFTAR (STRUKTUR HIMA)', getLocalDateString(), headers, rows);
  } else {
    downloadCSV(filename, headers, rows);
  }
}

// Notifikasi toast
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const normalizedType = type === 'error' ? 'danger' : type;
  const labelText = (normalizedType === 'danger') ? 'ERROR' : (normalizedType === 'warning' ? 'PERINGATAN' : (normalizedType === 'success' ? 'SUKSES' : 'INFO'));

  const toast = document.createElement('div');
  toast.className = `toast toast-${normalizedType}`;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'toast-label';
  labelSpan.textContent = labelText;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-msg font-mono text-sm';
  msgSpan.textContent = String(msg || ''); // Aman dari DOM XSS

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-weight:bold;margin-left:auto;padding:0 4px;font-family:monospace;font-size:13px;';
  closeBtn.textContent = 'X';
  closeBtn.onclick = () => toast.remove();

  toast.appendChild(labelSpan);
  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Polling fallback lokal jika offline
function startPolling() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.pollInterval = setInterval(() => {
    if (!window.isFirebaseConnected) {
      if (state.currentPanel === 'dashboard') loadDashboard();
      if (state.currentPanel === 'tambah')    loadUnknownCards();
    }
  }, 5000);
}

// Format hanya tanggal (tanpa jam, menghindari pergeseran waktu UTC -> 07.00 WIB)
function formatDateOnly(str) {
  if (!str) return '-';
  if (typeof str === 'string' && /^\d{4}-\d{2}-\d{2}/.test(str.trim())) {
    const parts = str.trim().substring(0, 10).split('-').map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    return dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

// Format tanggal dan waktu (24 jam)
function formatDate(str) {
  if (!str) return '-';
  // Jika hanya string tanggal tanpa jam (YYYY-MM-DD), jangan munculkan jam palsu 07.00
  if (typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str.trim())) {
    return formatDateOnly(str);
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    const t = formatTime24Hour(str);
    return t !== '-' ? t : str;
  }
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }).toUpperCase()
       + ` ${h}:${m}`;
}

// Monitoring status perangkat ESP8266
async function checkEspStatus() {
  const dot  = document.getElementById('esp-dot');
  const text = document.getElementById('esp-status-text');
  if (!dot || !text) return;

  // Jika terhubung ke Firebase Realtime Database Cloud,
  // status dikelola secara realtime oleh listener /devices/esp8266 di firebase-service.js
  if (window.isFirebaseConnected) {
    return;
  }

  // Cek fallback ke API lokal jika tidak ada Firebase
  try {
    const res = await fetch('api/esp_status.php', {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    if (data.online) {
      dot.className  = 'esp-dot online';
      text.textContent = 'ONLINE (LOCAL)';
    } else {
      dot.className  = 'esp-dot offline';
      text.textContent = 'OFFLINE';
    }
  } catch {
    dot.className    = 'esp-dot offline';
    text.textContent = 'OFFLINE';
  }
}

// Audio notification (Web Audio API - Singleton AudioContext)
let audioChimeEnabled = localStorage.getItem('presensi_audio_chime') !== 'disabled';
let _sharedAudioCtx = null;
let hasUserInteracted = false;

function unlockAudioContext() {
  hasUserInteracted = true;
  if (!_sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        _sharedAudioCtx = new AudioCtx();
      } catch {}
    }
  }
  if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
    if (!navigator.userActivation || navigator.userActivation.isActive || navigator.userActivation.hasBeenActive) {
      _sharedAudioCtx.resume().catch(() => {});
    }
  }
}

// Buka kunci AudioContext secara otomatis begitu user berinteraksi dengan halaman
['click', 'touchstart', 'pointerdown'].forEach(evt => {
  document.addEventListener(evt, unlockAudioContext, { once: true, passive: true });
});

function getSharedAudioContext() {
  if (!hasUserInteracted && !_sharedAudioCtx) {
    return null;
  }
  if (!_sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        _sharedAudioCtx = new AudioCtx();
      } catch {}
    }
  }
  if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended' && hasUserInteracted) {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}

function playTapChime() {
  if (!audioChimeEnabled || !hasUserInteracted) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);        // D5 note
    osc.frequency.setValueAtTime(880.00, now + 0.09); // A5 note
    
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) {
    // Autoplay policy fallback
  }
}

function toggleAudioChime() {
  unlockAudioContext();
  audioChimeEnabled = !audioChimeEnabled;
  localStorage.setItem('presensi_audio_chime', audioChimeEnabled ? 'enabled' : 'disabled');
  updateAudioToggleUI();
  if (audioChimeEnabled) {
    if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
      _sharedAudioCtx.resume().then(() => playTapChime()).catch(() => {});
    } else {
      playTapChime();
    }
  }
}

function updateAudioToggleUI() {
  const label = document.getElementById('audio-status-label');
  if (label) {
    label.textContent = audioChimeEnabled ? 'Suara: Aktif' : 'Suara: Nonaktif';
  }
}

// Quick date filter shortcuts
function setQuickDate(preset) {
  const input = document.getElementById('rekap-date');
  if (!input) return;

  const d = new Date();
  if (preset === 'yesterday') {
    d.setDate(d.getDate() - 1);
  }
  const dateStr = getLocalDateString(d);
  input.value = dateStr;
  state.selectedDate = dateStr;
  loadRekap();
}

// Event and proker management
async function loadEvents(retry = 2) {
  try {
    const res = await fetch(API.events);
    if (!res.ok) {
      console.warn(`[Events API] HTTP ${res.status}: Gagal memuat data program kerja.`);
      return;
    }
    const data = await res.json();
    if (data && data.success) {
      state.events = data.data || [];
      state.activeEvent = data.active_event || null;
      renderEventsTable(state.events);
      updateActiveEventDisplay(state.activeEvent);
    }
  } catch (e) {
    if (retry > 0) {
      setTimeout(() => loadEvents(retry - 1), 1200);
    } else {
      console.error('Error loading events:', e);
    }
  }
}

function formatEventTime(startTime, endTime) {
  if (!startTime) return '';
  const start = formatTime24Hour(startTime);
  if (endTime) {
    const end = formatTime24Hour(endTime);
    return `${start} - ${end} WIB`;
  }
  return `${start} WIB`;
}

function updateActiveEventDisplay(eventData) {
  const ev = eventData || state.activeEvent;
  const badgeEl = document.getElementById('active-event-badge');
  const titleEl = document.getElementById('active-event-title');
  const dateEl  = document.getElementById('active-event-date');

  if (ev && ev.name && (ev.is_active == 1 || ev.is_active === undefined)) {
    if (badgeEl) {
      badgeEl.style.display = 'inline-flex';
      badgeEl.style.background = 'var(--color-yellow)';
      badgeEl.style.color = '#000000';
    }
    if (titleEl) titleEl.textContent = ev.name;
    if (dateEl) {
      const dateText = ev.event_date || ev.date ? formatDateOnly(ev.event_date || ev.date) : '';
      const timeText = formatEventTime(ev.start_time, ev.end_time);
      dateEl.textContent = [dateText, timeText].filter(Boolean).join(' • ');
    }
  } else {
    if (badgeEl) {
      badgeEl.style.display = 'inline-flex';
      badgeEl.style.background = '#f1f5f9';
      badgeEl.style.color = '#334155';
    }
    if (titleEl) titleEl.textContent = 'Presensi Umum (Tanpa Acara)';
    if (dateEl)  dateEl.textContent = 'Kegiatan Reguler';
  }
}

function calculateEventTotalHadir(ev) {
  let total = Number(ev.total_hadir) || 0;
  if (window.isFirebaseConnected && Array.isArray(window.cloudLogs)) {
    const evDate = (ev.event_date || '').substring(0, 10);
    const evNameClean = (ev.name || '').trim().toLowerCase();

    const matchedLogs = window.cloudLogs.filter(l => {
      const logEventName = (l.event_name || '').trim().toLowerCase();
      // 1. Cocokkan jika nama acara sama
      if (logEventName && evNameClean && logEventName === evNameClean) {
        return true;
      }
      // 2. Jika tanggal log sama dengan tanggal acara
      if (evDate && l.date === evDate) {
        if (!logEventName || logEventName === 'kegiatan hima umum' || logEventName === evNameClean) {
          return true;
        }
      }
      return false;
    });

    const uniqueUids = new Set(matchedLogs.map(l => l.uid));
    total = Math.max(total, uniqueUids.size);
  }
  return total;
}

function renderEventsTable(events) {
  const tbody = document.getElementById('events-tbody');
  const badge = document.getElementById('events-count-badge');
  if (badge) badge.textContent = `${(events || []).length} PROGRAM KERJA`;
  if (!tbody) return;

  if (!events || events.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-text">BELUM ADA PROGRAM KERJA / ACARA</div>
          <div class="empty-sub">Buat program kerja baru untuk memisahkan data presensi tiap kegiatan</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = events.map((ev, i) => {
    const isActive = ev.is_active == 1;
    const timeStr = formatEventTime(ev.start_time, ev.end_time);
    const totalHadir = calculateEventTotalHadir(ev);

    // Target Audience Badge
    const targetAud = ev.target_audience || 'all';
    let targetBadge = '<span class="badge badge-secondary font-mono text-xs">SEMUA ANGGOTA</span>';
    if (targetAud === 'committee_only') {
      targetBadge = '<span class="badge badge-committee font-mono text-xs font-bold">PANITIA SAJA</span>';
    } else if (targetAud === 'bpi_bph') {
      targetBadge = '<span class="badge badge-bpi font-mono text-xs font-bold">BPI &amp; BPH</span>';
    }

    // Hitung Panitia
    let panitiaCount = Number(ev.total_panitia) || 0;
    if (window.cloudEventCommittees && window.cloudEventCommittees[ev.id]) {
      panitiaCount = Math.max(panitiaCount, Object.keys(window.cloudEventCommittees[ev.id]).length);
    }

    return `
    <tr class="${isActive ? 'row-active-event' : ''}">
      <td class="font-mono font-bold">${i + 1}</td>
      <td class="font-bold">
        ${escapeHtml(ev.name)}
        ${isActive ? '<span class="badge badge-warning ml-2 font-mono">[SEDANG BERJALAN]</span>' : ''}
        ${ev.description ? `<div class="text-xs text-muted mt-1 font-mono">${escapeHtml(ev.description)}</div>` : ''}
      </td>
      <td class="font-mono text-sm">
        <div>${formatDateOnly(ev.event_date)}</div>
        ${timeStr ? `<div class="text-xs font-mono font-bold mt-1" style="color: var(--text-secondary);"><span class="badge badge-outline" style="font-size: 10px; padding: 1px 5px; margin-right: 4px;">WAKTU</span>${timeStr}</div>` : ''}
      </td>
      <td>${targetBadge}</td>
      <td>
        <button type="button" class="btn btn-xs btn-primary font-mono" onclick="openCommitteesModal(${ev.id}, '${escapeJsString(ev.name)}')" style="font-weight: 800; border: 2px solid #000; box-shadow: 2px 2px 0px #000;">
          <span class="badge badge-panitia-lead mr-1" style="font-size: 10px; padding: 1px 5px;">${panitiaCount}</span> Kelola
        </button>
      </td>
      <td class="font-mono font-bold"><span class="badge badge-outline">${totalHadir} Mahasiswa</span></td>
      <td>
        <span class="badge ${isActive ? 'badge-success' : 'badge-secondary'} font-mono">
          ${isActive ? 'AKTIF' : 'SELESAI / NONAKTIF'}
        </span>
      </td>
      <td>
        <div class="flex gap-2">
          ${!isActive ? `
            <button class="btn btn-warning btn-sm" onclick="toggleEventActive(${ev.id}, true)">
              Aktifkan
            </button>
          ` : `
            <button class="btn btn-secondary btn-sm" onclick="toggleEventActive(${ev.id}, false)">
              Nonaktifkan
            </button>
          `}
          <button class="btn btn-danger btn-sm" onclick="deleteEvent(${ev.id})">
            Hapus
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function openCreateEventModal() {
  const modal = document.getElementById('modal-create-event');
  const dateInput = document.getElementById('event-date');
  if (dateInput) dateInput.value = getLocalDateString();
  const startTimeInput = document.getElementById('event-start-time');
  if (startTimeInput) startTimeInput.value = '08:00';
  const endTimeInput = document.getElementById('event-end-time');
  if (endTimeInput) endTimeInput.value = '';
  const audSelect = document.getElementById('event-target-audience');
  if (audSelect) audSelect.value = 'committee_only';
  document.getElementById('event-name').value = '';
  document.getElementById('event-desc').value = '';
  if (modal) modal.classList.add('active', 'open');
}

function closeCreateEventModal() {
  const modal = document.getElementById('modal-create-event');
  if (modal) modal.classList.remove('active', 'open');
}

async function submitCreateEvent() {
  const name            = document.getElementById('event-name')?.value.trim();
  const description     = document.getElementById('event-desc')?.value.trim();
  const event_date      = document.getElementById('event-date')?.value || getLocalDateString();
  const rawStart        = document.getElementById('event-start-time')?.value || '08:00';
  const start_time      = formatTime24Hour(rawStart);
  const rawEnd          = document.getElementById('event-end-time')?.value?.trim();
  const end_time        = rawEnd ? formatTime24Hour(rawEnd) : null;
  const target_audience = document.getElementById('event-target-audience')?.value || 'committee_only';
  const is_active       = document.getElementById('event-active')?.checked ? 1 : 0;

  if (!name) {
    showToast('Nama program kerja wajib diisi', 'warning');
    return;
  }

  try {
    const res = await fetch(API.events, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, event_date, start_time, end_time, target_audience, is_active })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal membuat acara');
    }
    showToast('Program kerja berhasil dibuat!', 'success');
    closeCreateEventModal();

    // Jika diset aktif, sinkronkan ke Firebase Realtime Database
    if (is_active && typeof window.setActiveEventInFirebase === 'function') {
      window.setActiveEventInFirebase({
        id: data.id,
        name,
        event_date,
        date: event_date,
        start_time,
        end_time,
        target_audience,
        is_active: 1
      });
    }

    loadEvents();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Terjadi kesalahan saat membuat acara', 'danger');
  }
}

async function toggleEventActive(id, activate) {
  const action = activate ? 'set_active' : 'set_inactive';
  try {
    const res = await fetch(API.events, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal mengubah status acara');
    }
    showToast(activate ? 'Acara presensi berhasil diaktifkan!' : 'Acara presensi berhasil dinonaktifkan.', 'success');
    
    const targetEv = (state.events || []).find(e => e.id == id);
    if (typeof window.setActiveEventInFirebase === 'function') {
      if (activate && targetEv) {
        window.setActiveEventInFirebase({
          id: targetEv.id,
          name: targetEv.name,
          event_date: targetEv.event_date,
          date: targetEv.event_date,
          start_time: targetEv.start_time,
          end_time: targetEv.end_time,
          target_audience: targetEv.target_audience || 'all',
          is_active: 1
        });
      } else {
        window.setActiveEventInFirebase(null);
      }
    }

    loadEvents();
    loadDashboard();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Gagal mengubah status acara aktif', 'danger');
  }
}

function setActiveEvent(id) {
  return toggleEventActive(id, true);
}

async function deleteEvent(id) {
  const ev = (state.events || []).find(e => e.id == id);
  const name = ev ? ev.name : 'Acara';
  if (!confirm(`Yakin ingin menghapus program kerja "${name}"?\nData presensi lama tidak akan hilang tetapi status acara akan dilepas.`)) return;

  try {
    const res = await fetch(API.events, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal menghapus acara');
    }
    showToast(`Program kerja "${name}" berhasil dihapus`, 'success');

    if (state.activeEvent && state.activeEvent.id == id) {
      if (typeof window.setActiveEventInFirebase === 'function') {
        window.setActiveEventInFirebase(null);
      }
    }

    loadEvents();
    loadDashboard();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Terjadi kesalahan saat menghapus acara', 'danger');
  }
}

// ==============================================================
// Kelola Susunan Panitia Program Kerja (Modal & Dual-Sync)
// ==============================================================
function openCommitteesModal(eventId, eventName = '') {
  state.currentCommitteeEvent = { id: eventId, name: eventName };
  const modal = document.getElementById('modal-committees');
  const title = document.getElementById('committee-modal-title');
  const subtitle = document.getElementById('committee-modal-subtitle');
  if (title) title.textContent = 'Susunan Panitia Program Kerja';
  if (subtitle) subtitle.textContent = `Acara: ${eventName || ('Event #' + eventId)}`;

  populateCommitteeStudentSelect();

  const roleInput = document.getElementById('comm-role-input');
  if (roleInput) roleInput.value = '';
  const divInput = document.getElementById('comm-division-input');
  if (divInput) divInput.value = '';

  if (modal) modal.classList.add('active', 'open');

  loadCommittees(eventId);
}

function closeCommitteesModal() {
  const modal = document.getElementById('modal-committees');
  if (modal) modal.classList.remove('active', 'open');
  state.currentCommitteeEvent = null;
  loadEvents();
}

function populateCommitteeStudentSelect() {
  const select = document.getElementById('comm-student-select');
  if (!select) return;

  const students = state.students || [];
  select.innerHTML = '<option value="">-- Pilih Mahasiswa --</option>' +
    students.map(s => `
      <option value="${escapeHtml(s.uid)}" data-id="${escapeHtml(s.id || '')}" data-name="${escapeHtml(s.name)}" data-nim="${escapeHtml(s.nim || '')}" data-category="${escapeHtml(s.category || 'Anggota')}" data-division="${escapeHtml(s.division || '')}">
        ${escapeHtml(s.name)} (${escapeHtml(s.nim || s.uid)}) [${escapeHtml(s.category || 'Anggota')}]
      </option>
    `).join('');
}

async function loadCommittees(eventId) {
  const tbody = document.getElementById('committee-tbody');
  const countBadge = document.getElementById('committee-count-badge');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-text">Memuat susunan panitia...</div></div></td></tr>`;
  }

  // 1. Cek data di Firebase Realtime Database
  let cloudList = null;
  if (window.cloudEventCommittees && window.cloudEventCommittees[eventId]) {
    const raw = window.cloudEventCommittees[eventId];
    cloudList = Object.keys(raw).map((uid) => ({
      id: raw[uid].id || 0,
      uid,
      name: raw[uid].name || '-',
      nim: raw[uid].nim || '-',
      role: raw[uid].role || 'Panitia',
      committee_division: raw[uid].division || '',
      category: raw[uid].category || 'Anggota'
    }));
  }

  // 2. Fetch dari MySQL API lokal
  try {
    const res = await fetch(`${API.eventCommittees}?event_id=${eventId}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.data)) {
        renderCommitteesTable(data.data, eventId);
        return;
      }
    }
  } catch (e) {
    console.warn('MySQL committee fetch notice:', e);
  }

  if (cloudList) {
    renderCommitteesTable(cloudList, eventId);
  } else if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-text">Belum ada panitia yang ditambahkan</div></div></td></tr>`;
    if (countBadge) countBadge.textContent = '0 PANITIA';
  }
}

function renderCommitteesTable(list, eventId) {
  const tbody = document.getElementById('committee-tbody');
  const countBadge = document.getElementById('committee-count-badge');
  if (countBadge) countBadge.textContent = `${(list || []).length} PANITIA`;
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-text">Belum ada panitia yang ditambahkan</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, i) => {
    const isLead = (c.role || '').toLowerCase().includes('ketua');
    const roleBadgeClass = isLead ? 'badge-panitia-lead' : 'badge-committee';

    return `
      <tr>
        <td class="font-mono font-bold">${i + 1}</td>
        <td class="font-bold">${escapeHtml(c.name)}</td>
        <td class="font-mono">${escapeHtml(c.nim || '-')}</td>
        <td>
          <span class="badge ${roleBadgeClass} font-mono text-xs font-bold">${escapeHtml(c.role)}</span>
          ${c.committee_division ? `<div class="text-xs font-mono text-muted mt-1">${escapeHtml(c.committee_division)}</div>` : ''}
        </td>
        <td>
          <span class="badge ${getCategoryBadgeClass(c.category)} font-mono text-xs font-bold">${escapeHtml(c.category || 'Anggota')}</span>
        </td>
        <td>
          <button class="btn btn-danger btn-xs" onclick="deleteCommittee(${c.id || 0}, ${eventId}, '${escapeJsString(c.uid)}', '${escapeJsString(c.name)}')">
            Hapus
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function submitAddCommittee() {
  if (!state.currentCommitteeEvent) return;
  const eventId = state.currentCommitteeEvent.id;

  const select = document.getElementById('comm-student-select');
  const roleInput = document.getElementById('comm-role-input');
  const divInput = document.getElementById('comm-division-input');

  const uid = select?.value;
  const role = roleInput?.value.trim();
  const division = divInput?.value.trim() || '';

  if (!uid) {
    showToast('Pilih mahasiswa terlebih dahulu', 'warning');
    return;
  }
  if (!role) {
    showToast('Jabatan / Role panitia wajib diisi', 'warning');
    return;
  }

  const selectedOpt  = select.options[select.selectedIndex];
  const name         = selectedOpt.getAttribute('data-name') || '';
  const nim          = selectedOpt.getAttribute('data-nim') || '';
  const category     = selectedOpt.getAttribute('data-category') || 'Anggota';
  const rawStudentId = selectedOpt.getAttribute('data-id') || '';
  const studentId    = /^\d+$/.test(rawStudentId) ? parseInt(rawStudentId, 10) : 0;

  // 1. Simpan ke Firebase Realtime Database
  if (typeof window.saveCommitteeToFirebase === 'function') {
    await window.saveCommitteeToFirebase(eventId, uid, {
      name,
      nim,
      role,
      division,
      category
    });
  }

  // 2. Simpan ke MySQL
  try {
    const res = await fetch(API.eventCommittees, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        student_id: studentId,
        uid: uid,
        role: role,
        division: division
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal menyimpan ke database');
    }
  } catch (e) {
    if (!window.isFirebaseConnected) {
      showToast(e.message || 'Gagal menetapkan panitia', 'danger');
      return;
    }
  }

  showToast(`${name} berhasil ditetapkan sebagai ${role}!`, 'success');
  if (roleInput) roleInput.value = '';
  if (divInput) divInput.value = '';
  loadCommittees(eventId);
}

async function deleteCommittee(id, eventId, uid, name) {
  if (!confirm(`Hapus ${name} dari kepanitiaan acara ini?`)) return;

  // 1. Hapus dari Firebase
  if (typeof window.deleteCommitteeFromFirebase === 'function') {
    await window.deleteCommitteeFromFirebase(eventId, uid);
  }

  // 2. Hapus dari MySQL
  try {
    const res = await fetch(`${API.eventCommittees}?id=${id}&event_id=${eventId}&uid=${encodeURIComponent(uid)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal menghapus dari database');
    }
  } catch (e) {
    if (!window.isFirebaseConnected) {
      showToast(e.message || 'Gagal menghapus panitia', 'danger');
      return;
    }
  }

  showToast(`${name} berhasil dihapus dari kepanitiaan`, 'success');
  loadCommittees(eventId);
}

// Absent member roster modal
let currentAbsentStudents = [];

async function openAlphaModal() {
  const modal = document.getElementById('modal-alpha');
  const tbody = document.getElementById('alpha-tbody');
  const countBadge = document.getElementById('alpha-count-badge');
  const titleDate = document.getElementById('alpha-date-title');

  const todayStr = state.selectedDate || getLocalDateString();
  const sessName = state.activeSession?.name || 'Sesi 1 (Datang / Pagi)';
  const sessId   = state.activeSession?.id   || 'sesi_1';
  const activeEv = state.activeEvent;

  // Tentukan label target audience
  let targetDesc = 'Seluruh Anggota';
  if (activeEv && activeEv.target_audience === 'committee_only') {
    targetDesc = 'Khusus Panitia Proker';
  } else if (activeEv && activeEv.target_audience === 'bpi_bph') {
    targetDesc = 'Khusus BPI & BPH';
  }

  if (titleDate) {
    titleDate.textContent = `Tanggal: ${todayStr} • ${activeEv?.name || 'Kegiatan Umum'} [${targetDesc}] • ${sessName}`;
  }

  // Jika state.students belum dimuat, muat dari Cloud atau MySQL
  if (!state.students || state.students.length === 0) {
    if (window.cloudUsers && Object.keys(window.cloudUsers).length > 0) {
      state.students = Object.keys(window.cloudUsers).map(uid => ({
        id: uid,
        uid: uid,
        name: window.cloudUsers[uid].name || '-',
        nim: window.cloudUsers[uid].nim || '-',
        category: window.cloudUsers[uid].category || 'Anggota',
        division: window.cloudUsers[uid].division || '',
        position: window.cloudUsers[uid].position || ''
      }));
    } else {
      try {
        const res = await fetch(API.students);
        const data = await res.json();
        state.students = data.data || [];
      } catch (e) {
        console.warn('Students fetch notice for alpha:', e);
      }
    }
  }

  const allStudents = state.students || [];

  // Tentukan Target Pool berdasarkan Target Audience dari Acara Aktif
  let targetPool = allStudents.filter(s => s.is_active === undefined || s.is_active == 1);

  const isCommitteeRestricted = !activeEv || activeEv.target_audience === 'committee_only' || activeEv.target_audience === undefined;

  if (isCommitteeRestricted) {
    // Hanya panitia acara ini (atau panitia terdaftar)
    let commUids = new Set();
    if (activeEv && window.cloudEventCommittees && window.cloudEventCommittees[activeEv.id]) {
      Object.keys(window.cloudEventCommittees[activeEv.id]).forEach(u => commUids.add(u));
    }
    if (commUids.size === 0 && window.cloudEventCommittees) {
      for (const evKey in window.cloudEventCommittees) {
        Object.keys(window.cloudEventCommittees[evKey] || {}).forEach(u => commUids.add(u));
      }
    }
    if (commUids.size > 0) {
      targetPool = targetPool.filter(s => commUids.has(s.uid));
    }
  } else if (activeEv && activeEv.target_audience === 'bpi_bph') {
    // Hanya BPI & BPH
    targetPool = targetPool.filter(s => s.category === 'BPI' || s.category === 'BPH');
  }

  // Kumpulkan UID yang sudah hadir hari ini pada SESI AKTIF
  const presentUids = new Set();
  (state.attendance || []).forEach(r => {
    const sId = r.session_id || 'sesi_1';
    if (sId === sessId && r.uid) {
      presentUids.add(r.uid);
    }
  });

  // Cari yang belum hadir pada target pool
  currentAbsentStudents = targetPool.filter(s => !presentUids.has(s.uid));

  if (countBadge) countBadge.textContent = `${currentAbsentStudents.length} ANGGOTA`;

  if (!tbody) return;

  if (currentAbsentStudents.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="4">
        <div class="empty-state">
          <div class="empty-text" style="color: var(--color-green);">SEMUA ANGGOTA TARGET TELAH HADIR PADA SESI INI!</div>
          <div class="empty-sub">Tingkat kehadiran mencapai 100% untuk ${escapeHtml(sessName)} (${escapeHtml(targetDesc)}).</div>
        </div>
      </td></tr>`;
  } else {
    tbody.innerHTML = currentAbsentStudents.map((s, i) => {
      const cat = s.category || 'Anggota';
      return `
      <tr>
        <td class="font-mono font-bold">${i + 1}</td>
        <td>
          <div class="font-bold">${escapeHtml(s.name)}</div>
          <div class="flex items-center gap-1 mt-1">
            <span class="badge ${getCategoryBadgeClass(cat)} text-xs" style="font-size: 10px; padding: 1px 5px;">${escapeHtml(cat)}</span>
            ${s.division ? `<span class="text-xs text-muted font-mono">${escapeHtml(s.division)}</span>` : ''}
          </div>
        </td>
        <td class="font-mono">${escapeHtml(s.nim || '-')}</td>
        <td class="font-mono"><span class="td-uid">${escapeHtml(s.uid)}</span></td>
      </tr>
    `}).join('');
  }

  if (modal) modal.classList.add('active', 'open');
}

function closeAlphaModal() {
  const modal = document.getElementById('modal-alpha');
  if (modal) modal.classList.remove('active', 'open');
}

function copyAlphaListToWhatsApp() {
  if (currentAbsentStudents.length === 0) {
    showToast('Tidak ada anggota yang belum hadir', 'info');
    return;
  }

  const activeEv  = state.activeEvent;
  const eventName = activeEv?.name || 'Kegiatan HIMA Umum';
  const sessName  = state.activeSession?.name || 'Sesi 1';
  const dateStr   = state.selectedDate || getLocalDateString();

  let targetDesc = 'Seluruh Anggota';
  if (activeEv?.target_audience === 'committee_only') targetDesc = 'Khusus Panitia Proker';
  else if (activeEv?.target_audience === 'bpi_bph') targetDesc = 'Khusus BPI & BPH';

  let text = `*DAFTAR ANGGOTA BELUM PRESENSI (ALPHA)*\n`;
  text += `Acara: ${eventName}\n`;
  text += `Target: ${targetDesc}\n`;
  text += `Sesi: ${sessName}\n`;
  text += `Tanggal: ${dateStr}\n`;
  text += `Total Belum Hadir: ${currentAbsentStudents.length} Orang\n\n`;
  text += `----------------------------------------\n`;

  // Kelompokkan berdasarkan Kategori Struktur (BPI / BPH / Anggota)
  const grouped = {
    'BPI': [],
    'BPH': [],
    'Anggota': []
  };

  currentAbsentStudents.forEach(s => {
    const cat = s.category || 'Anggota';
    if (grouped[cat]) grouped[cat].push(s);
    else grouped['Anggota'].push(s);
  });

  let counter = 1;
  ['BPI', 'BPH', 'Anggota'].forEach(cat => {
    if (grouped[cat].length > 0) {
      text += `\n*== ${cat.toUpperCase()} (${grouped[cat].length} Orang) ==*\n`;
      grouped[cat].forEach(s => {
        const extra = [s.position, s.division].filter(Boolean).join(', ');
        text += `${counter++}. ${s.name} (${s.nim || '-'})${extra ? ' - ' + extra : ''}\n`;
      });
    }
  });

  text += `\n----------------------------------------\n`;
  text += `Mohon yang namanya tercantum segera melakukan presensi kehadiran di meja registrasi. Terima kasih.`;

  const fallbackCopy = (val) => {
    const ta = document.createElement('textarea');
    ta.value = val;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Daftar belum hadir disalin ke clipboard.', 'success');
    } catch {
      showToast('Gagal menyalin ke clipboard', 'danger');
    }
    document.body.removeChild(ta);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Daftar belum hadir disalin ke clipboard.', 'success');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

// Batch student registration import
let importedRowsCache = [];

function openImportModal() {
  const modal = document.getElementById('modal-import');
  importedRowsCache = [];
  const tbody = document.getElementById('import-preview-tbody');
  const countBadge = document.getElementById('import-count-badge');
  const btnSubmit = document.getElementById('btn-submit-import');
  const fileInput = document.getElementById('import-file-input');

  if (fileInput) fileInput.value = '';
  if (countBadge) countBadge.textContent = '0 DATA';
  if (btnSubmit) btnSubmit.disabled = true;
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="4">
        <div class="empty-state">
          <div class="empty-text">PILIH FILE CSV / EXCEL (.XLSX)</div>
          <div class="empty-sub">File harus memiliki kolom: UID (atau RFID), Nama (atau Name), dan NIM</div>
        </div>
      </td></tr>`;
  }

  if (modal) modal.classList.add('active', 'open');
}

function closeImportModal() {
  const modal = document.getElementById('modal-import');
  if (modal) modal.classList.remove('active', 'open');
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!json || json.length === 0) {
        showToast('File tidak memiliki baris data', 'warning');
        return;
      }

      // Normalisasi kolom
      importedRowsCache = json.map(row => {
        let uid = '', name = '', nim = '', category = 'Anggota', division = '', position = '';
        for (const k of Object.keys(row)) {
          const lk = k.toLowerCase().trim();
          if (lk.includes('uid') || lk.includes('rfid') || lk.includes('kartu')) {
            uid = String(row[k]).trim().toUpperCase();
          } else if (lk.includes('nama') || lk.includes('name')) {
            name = String(row[k]).trim();
          } else if (lk.includes('nim') || lk.includes('npm') || lk.includes('nrp')) {
            nim = String(row[k]).trim();
          } else if (lk.includes('kategori') || lk.includes('category') || lk.includes('struktur')) {
            const val = String(row[k]).trim();
            if (/bpi/i.test(val)) category = 'BPI';
            else if (/bph/i.test(val)) category = 'BPH';
            else category = 'Anggota';
          } else if (lk.includes('divisi') || lk.includes('bidang') || lk.includes('departemen')) {
            division = String(row[k]).trim();
          } else if (lk.includes('jabatan') || lk.includes('posisi') || lk.includes('position')) {
            position = String(row[k]).trim();
          }
        }
        return { uid, name, nim, category, division, position };
      }).filter(r => r.name && r.uid);

      renderImportPreview(importedRowsCache);
    } catch (err) {
      console.error(err);
      showToast('Gagal membaca berkas. Pastikan format Excel/CSV valid.', 'danger');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderImportPreview(rows) {
  const tbody = document.getElementById('import-preview-tbody');
  const countBadge = document.getElementById('import-count-badge');
  const btnSubmit = document.getElementById('btn-submit-import');

  if (countBadge) countBadge.textContent = `${rows.length} DATA SIAP`;
  if (btnSubmit) btnSubmit.disabled = rows.length === 0;

  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="4">
        <div class="empty-state">
          <div class="empty-text text-danger">TIDAK ADA DATA VALID TERDETEKSI</div>
          <div class="empty-sub">Pastikan file memiliki header kolom UID dan Nama</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.slice(0, 50).map((r, i) => `
    <tr>
      <td class="font-mono font-bold">${i + 1}</td>
      <td class="font-mono"><span class="td-uid">${escapeHtml(r.uid)}</span></td>
      <td class="font-bold">
        ${escapeHtml(r.name)}
        <span class="badge ${getCategoryBadgeClass(r.category)} text-xs ml-1" style="font-size: 10px; padding: 1px 5px;">${escapeHtml(r.category)}</span>
      </td>
      <td class="font-mono">${escapeHtml(r.nim || '-')}</td>
    </tr>
  `).join('');

  if (rows.length > 50) {
    tbody.innerHTML += `<tr><td colspan="4" class="text-center font-mono text-muted py-2">... dan ${rows.length - 50} data lainnya</td></tr>`;
  }
}

async function submitBatchImport() {
  if (importedRowsCache.length === 0) return;

  const btnSubmit = document.getElementById('btn-submit-import');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Mengimport...';
  }

  let mysqlOk = false;
  let firebaseOk = false;
  let errorMsg = '';

  // 1. Simpan massal ke MySQL via batch API
  try {
    const res = await fetch(API.students, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: true, students: importedRowsCache })
    });
    const data = await res.json();
    if (res.ok && data && data.success) {
      mysqlOk = true;
    } else {
      errorMsg = data?.message || 'Gagal menyimpan ke database';
    }
  } catch (e) {
    console.warn('MySQL batch import notice:', e);
    errorMsg = e.message;
  }

  // 2. Sinkronkan ke Firebase Realtime Database
  if (window.isFirebaseConnected) {
    try {
      if (typeof window.batchRegisterUsersToFirebase === 'function') {
        await window.batchRegisterUsersToFirebase(importedRowsCache);
        firebaseOk = true;
      } else if (typeof window.registerUserToFirebase === 'function') {
        for (const item of importedRowsCache) {
          try {
            await window.registerUserToFirebase(item.uid, item.name, item.nim, item.category, item.division, item.position);
          } catch (e) {}
        }
        firebaseOk = true;
      }
    } catch (e) {
      console.warn('Firebase batch import notice:', e);
    }
  }

  if (mysqlOk || firebaseOk) {
    showToast(`Berhasil mengimport ${importedRowsCache.length} mahasiswa!`, 'success');
  } else {
    showToast(errorMsg || 'Gagal mengimport data', 'danger');
  }

  closeImportModal();
  loadStudents();
  loadDashboard();
}

// Administrator password management
function openChangePasswordModal() {
  const modal = document.getElementById('modal-password');
  document.getElementById('pwd-old').value = '';
  document.getElementById('pwd-new').value = '';
  document.getElementById('pwd-confirm').value = '';
  if (modal) modal.classList.add('active', 'open');
}

function closeChangePasswordModal() {
  const modal = document.getElementById('modal-password');
  if (modal && modal.getAttribute('data-force') === '1') {
    showToast('Anda wajib mengganti password default terlebih dahulu', 'warning');
    return;
  }
  if (modal) modal.classList.remove('active', 'open');
}

async function submitChangePassword() {
  const old_password     = document.getElementById('pwd-old')?.value || '';
  const new_password     = document.getElementById('pwd-new')?.value || '';
  const confirm_password = document.getElementById('pwd-confirm')?.value || '';

  if (!old_password || !new_password || !confirm_password) {
    showToast('Semua field password wajib diisi', 'warning');
    return;
  }

  if (new_password.length < 6) {
    showToast('Password baru minimal 6 karakter', 'warning');
    return;
  }

  if (new_password !== confirm_password) {
    showToast('Konfirmasi password tidak cocok', 'warning');
    return;
  }

  try {
    const res = await fetch(API.admin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password, new_password, confirm_password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Gagal mengubah password');
    }
    showToast(data.message || 'Password admin berhasil diubah!', 'success');
    const modal = document.getElementById('modal-password');
    if (modal && modal.getAttribute('data-force') === '1') {
      modal.removeAttribute('data-force');
      setTimeout(() => {
        window.location.href = 'dashboard';
      }, 1200);
    } else {
      closeChangePasswordModal();
    }
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Terjadi kesalahan saat mengubah password', 'danger');
  }
}

// Application bootstrap and event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Jalankan jam
  updateClock();
  setInterval(updateClock, 1000);

  // Auto-format dan validasi input jam 24 jam (HH:mm)
  document.querySelectorAll('.time-24h-input').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.replace(/[^\d:]/g, '');
      if (val.length === 2 && !val.includes(':') && e.inputType !== 'deleteContentBackward') {
        val = val + ':';
      }
      e.target.value = val.substring(0, 5);
    });
    input.addEventListener('blur', (e) => {
      if (e.target.value.trim()) {
        e.target.value = formatTime24Hour(e.target.value);
      }
    });
  });

  // Inisialisasi status audio toggle
  updateAudioToggleUI();

  // Set default tanggal hari ini pada input rekap
  const rekapDate = document.getElementById('rekap-date');
  if (rekapDate) rekapDate.value = state.selectedDate;

  // Load acara aktif & initial panel
  loadEvents();
  const initialPanel = document.body.dataset.initialPanel || 'dashboard';
  showPanel(initialPanel, false);

  // Listener popstate browser (tombol back / forward untuk Clean URL)
  window.addEventListener('popstate', (e) => {
    const p = (e.state && e.state.panel)
      ? e.state.panel
      : (window.location.pathname.replace(/\/+$/, '').split('/').pop() || 'dashboard');
    const validPanels = ['dashboard', 'tambah', 'mahasiswa', 'rekap', 'events'];
    showPanel(validPanels.includes(p) ? p : 'dashboard', false);
  });

  // Polling auto-refresh
  startPolling();

  // ESP Status check setiap 10 detik
  setInterval(checkEspStatus, 10000);

  // ESC untuk tutup modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeRegisterModal();
      closeEditModal();
      closeCreateEventModal();
      closeCommitteesModal();
      closeAlphaModal();
      closeImportModal();
      closeChangePasswordModal();
    }
  });

  // Close modal saat klik overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeRegisterModal();
        closeEditModal();
        closeCreateEventModal();
        closeCommitteesModal();
        closeAlphaModal();
        closeImportModal();
        closeChangePasswordModal();
      }
    });
  });

  // Expose methods to global window
  window.showToast = showToast;
  window.showPanel = showPanel;
  window.loadDashboard = loadDashboard;
  window.loadUnknownCards = loadUnknownCards;
  window.loadStudents = loadStudents;
  window.loadRekap = loadRekap;
  window.loadEvents = loadEvents;
  window.renderEventsTable = renderEventsTable;
  window.state = state;
  window.onSessionChange = onSessionChange;
  window.updateActiveSessionDisplay = updateActiveSessionDisplay;
  window.toggleSessionStatus = toggleSessionStatus;
  window.formatSessionLabel = formatSessionLabel;
  window.updateLiveFeed = updateLiveFeed;
  window.updateActiveEventDisplay = updateActiveEventDisplay;
  window.renderUnknownCards = renderUnknownCards;
  window.renderDashboardTable = renderDashboardTable;
  window.renderStudentsTable = renderStudentsTable;
  window.renderCloudStudents = renderCloudStudents;
  window.filterStudentsByCategory = filterStudentsByCategory;
  window.getCategoryBadgeClass = getCategoryBadgeClass;
  window.openRegisterModal = openRegisterModal;
  window.closeRegisterModal = closeRegisterModal;
  window.submitRegister = submitRegister;
  window.openAddManualModal = openAddManualModal;
  window.openEditModal = openEditModal;
  window.closeEditModal = closeEditModal;
  window.submitEdit = submitEdit;
  window.deleteStudent = deleteStudent;
  window.searchStudents = searchStudents;
  window.clearRekapByDate = clearRekapByDate;
  window.openCreateEventModal = openCreateEventModal;
  window.closeCreateEventModal = closeCreateEventModal;
  window.submitCreateEvent = submitCreateEvent;
  window.setActiveEvent = setActiveEvent;
  window.toggleEventActive = toggleEventActive;
  window.deleteEvent = deleteEvent;
  window.openCommitteesModal = openCommitteesModal;
  window.closeCommitteesModal = closeCommitteesModal;
  window.populateCommitteeStudentSelect = populateCommitteeStudentSelect;
  window.loadCommittees = loadCommittees;
  window.renderCommitteesTable = renderCommitteesTable;
  window.submitAddCommittee = submitAddCommittee;
  window.deleteCommittee = deleteCommittee;
  window.openAlphaModal = openAlphaModal;
  window.closeAlphaModal = closeAlphaModal;
  window.copyAlphaListToWhatsApp = copyAlphaListToWhatsApp;
  window.openImportModal = openImportModal;
  window.closeImportModal = closeImportModal;
  window.handleImportFile = handleImportFile;
  window.submitBatchImport = submitBatchImport;
  window.openChangePasswordModal = openChangePasswordModal;
  window.closeChangePasswordModal = closeChangePasswordModal;
  window.submitChangePassword = submitChangePassword;
  window.downloadCSV = downloadCSV;
  window.downloadExcel = downloadExcel;
  window.exportAttendanceToday = exportAttendanceToday;
  window.exportAttendance = exportAttendance;
  window.exportAllAttendance = exportAllAttendance;
  window.exportStudents = exportStudents;
  window.toggleAudioChime = toggleAudioChime;
  window.setQuickDate = setQuickDate;
  window.playTapChime = playTapChime;

  // Antislop R-32: Keyboard accessibility (Escape key closes open modals)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active, .modal-overlay.open').forEach(m => {
        if (m.getAttribute('data-force') !== '1') {
          m.classList.remove('active', 'open');
        }
      });
    }
  });
});
