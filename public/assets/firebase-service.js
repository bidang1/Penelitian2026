// ============================================================
// firebase-service.js - Realtime Database Sync for Dashboard
// Fully compatible with ESP8266 + Firebase Realtime Database
//   - /log_presensi (Live tap stream from ESP8266)
//   - /unknown_cards (Unknown RFID cards from ESP8266)
//   - /users (Registered student database)
// ============================================================

import { 
  ref, 
  onValue, 
  set, 
  remove, 
  update, 
  query, 
  limitToLast 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { db } from "./firebase-config.js?v=2.2";

// Status koneksi Firebase
let isFirebaseConnected = false;
let isInitialLoad = true;
let debounceDashboardTimer = null;

function triggerDebouncedDashboard() {
  if (debounceDashboardTimer) clearTimeout(debounceDashboardTimer);
  debounceDashboardTimer = setTimeout(() => {
    if (typeof window.loadDashboard === 'function') {
      window.loadDashboard();
    }
  }, 250);
}

// Cache data cloud
export let cloudUnknownCards = [];
export let cloudUsers = {};
export let cloudLogs = [];
export let cloudEventCommittees = {};

// Helper untuk decode timestamp dari Firebase Push Key (cth: -O...)
function getTimestampFromFirebasePushId(id) {
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  if (!id || typeof id !== 'string' || id.length < 8) return null;
  let time = 0;
  for (let i = 0; i < 8; i++) {
    const c = id.charAt(i);
    const index = PUSH_CHARS.indexOf(c);
    if (index === -1) return null;
    time = time * 64 + index;
  }
  return time;
}

// Helper format tanggal lokal YYYY-MM-DD
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper format waktu 24 jam konsisten (HH:mm atau HH:mm:ss)
export function formatTime24Hour(val, withSeconds = false) {
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

  return str.replace(/\s*[ap]\.?m\.?/gi, '');
}

// Helper ekstrak waktu & tanggal akurat dari log
function parseLogDateTime(item, key) {
  let waktuStr = item.waktu || null;
  let dateStr = item.date || null;
  let timestamp = null;

  // 1. Cek jika item memiliki timestamp epoch valid
  if (item.timestamp && typeof item.timestamp === 'number') {
    if (item.timestamp > 1000000000000) {
      timestamp = item.timestamp;
    } else if (item.timestamp > 1000000000) {
      timestamp = item.timestamp * 1000;
    }
  }

  // 2. Jika tidak ada timestamp valid, decode dari Firebase Push Key
  if (!timestamp && key) {
    const decoded = getTimestampFromFirebasePushId(key);
    if (decoded && decoded > 1577836800000 && decoded < 2524608000000) {
      timestamp = decoded;
    }
  }

  // 3. Konversi timestamp ke format waktu 24 jam (HH:mm) & tanggal (YYYY-MM-DD)
  if (timestamp) {
    const dateObj = new Date(timestamp);
    if (!waktuStr) {
      const h = String(dateObj.getHours()).padStart(2, '0');
      const m = String(dateObj.getMinutes()).padStart(2, '0');
      waktuStr = `${h}:${m}`;
    }
    if (!dateStr) {
      dateStr = getLocalDateString(dateObj);
    }
  }

  // 4. Fallback jika sama sekali tidak ada data waktu
  if (!waktuStr) {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    waktuStr = `${h}:${m}`;
  }

  // Selalu normalisasi waktuStr ke format 24 jam ketat (HH:mm)
  waktuStr = formatTime24Hour(waktuStr);

  if (!dateStr) {
    dateStr = getLocalDateString(new Date());
  }

  return { waktu: waktuStr, date: dateStr, timestamp: timestamp || Date.now() };
}

// Helper untuk memeriksa apakah mahasiswa terdaftar sebagai panitia
export function isStudentCommittee(uid, eventId = null) {
  if (!uid || uid === '-') return false;

  // 1. Cek pada event aktif atau event tertentu di cloudEventCommittees
  const activeEvId = eventId || (window.cloudActiveEvent && window.cloudActiveEvent.id) || (window.state && window.state.activeEvent && window.state.activeEvent.id);
  if (activeEvId && window.cloudEventCommittees && window.cloudEventCommittees[activeEvId] && window.cloudEventCommittees[activeEvId][uid]) {
    return true;
  }

  // 2. Cek apakah terdaftar di kepanitiaan event manapun di cloudEventCommittees
  if (window.cloudEventCommittees) {
    for (const evKey in window.cloudEventCommittees) {
      if (window.cloudEventCommittees[evKey] && window.cloudEventCommittees[evKey][uid]) {
        return true;
      }
    }
  }

  // 3. Cek pada data mahasiswa di cloudUsers (position/role)
  const committeeKeywords = ['panitia', 'ketua', 'sie', 'koor', 'sekretaris', 'bendahara', 'pengurus', 'divisi', 'bidang'];
  if (window.cloudUsers && window.cloudUsers[uid]) {
    const pos = (window.cloudUsers[uid].position || '').toLowerCase();
    const role = (window.cloudUsers[uid].role || '').toLowerCase();
    if (committeeKeywords.some(kw => pos.includes(kw) || role.includes(kw))) {
      return true;
    }
  }

  // 4. Cek pada state.students jika ada
  if (window.state && Array.isArray(window.state.students)) {
    const s = window.state.students.find(st => st.uid === uid);
    if (s && (s.position || s.role)) {
      const pos = (s.position || '').toLowerCase();
      const role = (s.role || '').toLowerCase();
      if (committeeKeywords.some(kw => pos.includes(kw) || role.includes(kw))) {
        return true;
      }
    }
  }

  return false;
}
window.isStudentCommittee = isStudentCommittee;

function isStudentAllowedForEvent(uid, studentInfo) {
  const activeEv = (window.state && window.state.activeEvent) || window.cloudActiveEvent || {};
  const targetAud = activeEv.target_audience || 'all';
  const isComm = isStudentCommittee(uid);

  if (targetAud === 'all') {
    return { allowed: true, isComm };
  }
  if (targetAud === 'bpi_bph') {
    const cat = ((studentInfo && studentInfo.category) || '').toUpperCase();
    const isBpiBph = cat.includes('BPI') || cat.includes('BPH');
    return { allowed: isBpiBph || isComm, isComm, reason: 'Khusus BPI & BPH' };
  }
  return { allowed: isComm, isComm, reason: 'Khusus Panitia' };
}

export function initFirebaseListeners() {
  console.log("[Firebase] Menginisialisasi Realtime Listener...");

  // 1. Monitor Status Koneksi Cloud Browser
  const connectedRef = ref(db, ".info/connected");
  onValue(connectedRef, (snap) => {
    isFirebaseConnected = snap.val() === true;
    window.isFirebaseConnected = isFirebaseConnected;
    if (!isFirebaseConnected) {
      const espText = document.getElementById("esp-status-text");
      const espDot = document.getElementById("esp-dot");
      if (espText) espText.textContent = "OFFLINE";
      if (espDot) espDot.className = "esp-dot offline";
    }
  });

  // 1b. Real IoT Hardware Heartbeat Telemetry: /devices/esp8266
  const deviceRef = ref(db, "devices/esp8266");
  onValue(deviceRef, (snapshot) => {
    const data = snapshot.val();
    const espText = document.getElementById("esp-status-text");
    const espDot = document.getElementById("esp-dot");
    if (!espText || !espDot) return;

    if (!data) {
      espText.textContent = "OFFLINE";
      espDot.className = "esp-dot offline";
      return;
    }

    const lastSeen = Number(data.last_seen);
    // Konversi detik (10 digit) ke milidetik jika perlu
    const lastSeenMs = lastSeen < 1e11 ? lastSeen * 1000 : lastSeen;
    const isOnline = lastSeenMs > 0 && Math.abs(Date.now() - lastSeenMs) < 60000;

    if (isOnline) {
      espText.textContent = "ONLINE (CLOUD)";
      espDot.className = "esp-dot online";
    } else {
      espText.textContent = "OFFLINE";
      espDot.className = "esp-dot offline";
    }
  });

  // 2. Realtime Listener: /users (Sinkronisasi Daftar Mahasiswa di Cloud)
  const usersRef = ref(db, "users");
  onValue(usersRef, (snapshot) => {
    const data = snapshot.val() || {};
    cloudUsers = data;
    window.cloudUsers = data;
    console.log(`[Firebase] ${Object.keys(data).length} data mahasiswa terdaftar di Cloud.`);

    // Refresh view data mahasiswa & dashboard jika fungsi sudah tersedia
    if (typeof window.renderCloudStudents === 'function') {
      window.renderCloudStudents();
    }
    triggerDebouncedDashboard();
  });

  // 3. Realtime Listener: /unknown_cards (Pushed by ESP8266 when unknown RFID is tapped)
  const unknownCardsRef = ref(db, "unknown_cards");
  onValue(unknownCardsRef, (snapshot) => {
    const data = snapshot.val();
    const badge = document.getElementById("unknown-badge");
    const countBadge = document.getElementById("unknown-count-badge");
    
    if (data && typeof data === 'object') {
      const uids = Object.keys(data);
      const count = uids.length;

      if (badge) {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = "inline-block";
        } else {
          badge.style.display = "none";
        }
      }

      if (countBadge) {
        countBadge.textContent = `${count} KARTU`;
      }

      // Format data untuk tabel web
      cloudUnknownCards = uids.map(uid => {
        const item = data[uid];
        return {
          uid: uid,
          tap_count: typeof item === 'object' && item.tap_count ? item.tap_count : 1,
          first_seen: typeof item === 'object' && item.first_seen ? item.first_seen : new Date().toISOString(),
          last_seen: typeof item === 'object' && item.last_seen ? item.last_seen : new Date().toISOString()
        };
      });

      window.cloudUnknownCards = cloudUnknownCards;

      // Render tabel secara langsung!
      if (typeof window.renderUnknownCards === 'function') {
        window.renderUnknownCards(cloudUnknownCards);
      }

      // Tampilkan toast notifikasi jika ada kartu baru masuk
      if (!isInitialLoad && count > 0 && typeof window.showToast === 'function') {
        const lastUid = uids[uids.length - 1];
        window.showToast(`Kartu Baru Terdeteksi: ${lastUid}`, 'warning');
      }
    } else {
      cloudUnknownCards = [];
      window.cloudUnknownCards = [];
      if (badge) badge.style.display = "none";
      if (countBadge) countBadge.textContent = "0 KARTU";
      if (typeof window.renderUnknownCards === 'function') {
        window.renderUnknownCards([]);
      }
    }
  });

  // 4. Realtime Listener: /log_presensi (Pushed by ESP8266 on every tap, limited to last 100 for high performance)
  const logPresensiRef = query(ref(db, "log_presensi"), limitToLast(100));
  onValue(logPresensiRef, (snapshot) => {
    const data = snapshot.val();
    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length > 0) {
        const validLogs = [];
        let latestRejectedName = null;
        let latestRejectReason = 'Bukan Panitia';

        keys.forEach((k) => {
          const item        = data[k] || {};
          const studentInfo = (cloudUsers && cloudUsers[item.uid]) || {};
          const parsed      = parseLogDateTime(item, k);
          const { allowed, isComm, reason } = isStudentAllowedForEvent(item.uid, studentInfo);

          if (allowed) {
            validLogs.push({
              id: k,
              uid: item.uid || '-',
              name: item.name || studentInfo.name || `Mahasiswa (${item.uid})`,
              nim: studentInfo.nim || item.nim || '-',
              category: studentInfo.category || item.category || 'Anggota',
              division: studentInfo.division || item.division || '-',
              session_id: item.session_id || 'sesi_1',
              session_name: item.session_name || 'Sesi 1 (Datang)',
              event_name: item.event_name || 'Kegiatan HIMA Umum',
              telat: item.telat === true || item.telat === 1 || item.telat === 'true',
              waktu: parsed.waktu,
              date: parsed.date,
              timestamp: parsed.timestamp,
              is_committee: isComm
            });
          } else {
            latestRejectedName = item.name || studentInfo.name || `UID: ${item.uid}`;
            latestRejectReason = reason || 'Akses Ditolak';
            if (item.date && item.session_id && item.uid) {
              set(ref(db, `attendance_today/${item.date}_${item.session_id}/${item.uid}`), null);
            }
          }
        });

        validLogs.sort((a, b) => b.timestamp - a.timestamp);
        cloudLogs = validLogs;
        window.cloudLogs = cloudLogs;

        const latestKey       = keys[keys.length - 1];
        const latestRawItem   = data[latestKey] || {};
        const latestInfo      = (cloudUsers && cloudUsers[latestRawItem.uid]) || {};
        const latestCheck     = isStudentAllowedForEvent(latestRawItem.uid, latestInfo);

        if (!isInitialLoad && !latestCheck.allowed && latestRejectedName && typeof window.showToast === 'function') {
          window.showToast(`Presensi Ditolak: ${latestRejectedName} (${latestRejectReason})`, 'danger');
        }

        const latestLog = cloudLogs[0];
        console.log("[Firebase] Log Presensi Terkini:", latestLog);

        if (latestLog && typeof window.updateLiveFeed === 'function') {
          window.updateLiveFeed(latestLog.name, formatTime24Hour(latestLog.waktu), !isInitialLoad, latestLog.telat);
        }

        if (!isInitialLoad && latestLog && typeof window.showToast === 'function' && latestCheck.allowed) {
          const sessLabel   = latestLog.session_name ? ` [${latestLog.session_name}]` : '';
          const displayTime = formatTime24Hour(latestLog.waktu);
          const tag = latestLog.is_committee ? 'Panitia' : 'Mahasiswa';
          if (latestLog.telat) {
            window.showToast(`Presensi ${tag} (TELAT): ${latestLog.name}${sessLabel} (${displayTime})`, 'warning');
          } else {
            window.showToast(`Presensi ${tag}: ${latestLog.name}${sessLabel} (${displayTime})`, 'success');
          }
        }

        // Refresh data dashboard, rekap, & program kerja dengan debounce
        triggerDebouncedDashboard();
        if (typeof window.loadRekap === 'function') {
          window.loadRekap();
        }
        if (typeof window.renderEventsTable === 'function' && window.state && Array.isArray(window.state.events) && window.state.events.length > 0) {
          window.renderEventsTable(window.state.events);
        }
      }
    } else {
      cloudLogs = [];
      window.cloudLogs = [];
      triggerDebouncedDashboard();
      if (typeof window.loadRekap === 'function') window.loadRekap();
    }
  });

  // 5. Realtime Listener: /active_event (Acara/Program Kerja Aktif)
  const activeEventRef = ref(db, "active_event");
  onValue(activeEventRef, (snapshot) => {
    const data = snapshot.val();
    window.cloudActiveEvent = data;
    if (typeof window.updateActiveEventDisplay === 'function') {
      window.updateActiveEventDisplay(data);
    }
  });

  // 6. Realtime Listener: /active_session (Sesi Presensi Aktif)
  const activeSessionRef = ref(db, "active_session");
  onValue(activeSessionRef, (snapshot) => {
    const data = snapshot.val();
    window.cloudActiveSession = data;
    if (typeof window.updateActiveSessionDisplay === 'function') {
      window.updateActiveSessionDisplay(data);
    }
  });

  // 7. Realtime Listener: /event_committees (Susunan Panitia Program Kerja)
  const committeesRef = ref(db, "event_committees");
  onValue(committeesRef, (snapshot) => {
    const data = snapshot.val() || {};
    cloudEventCommittees = data;
    window.cloudEventCommittees = data;
    const currentEvId = (window.state && window.state.currentCommitteeEvent) || window.activeCommitteeEventId;
    if (currentEvId && typeof window.loadCommittees === 'function') {
      window.loadCommittees(currentEvId);
    }
    if (typeof window.renderEventsTable === 'function' && window.state && Array.isArray(window.state.events)) {
      window.renderEventsTable(window.state.events);
    }
  });

  // Tandai initial load selesai setelah 1.5 detik
  setTimeout(() => {
    isInitialLoad = false;
  }, 1500);
}

// Helper untuk mendaftarkan user langsung ke Firebase /users/{uid}
export async function registerUserToFirebase(uid, name, nim, category = 'Anggota', division = '', position = '') {
  try {
    const userRef = ref(db, `users/${uid}`);
    await set(userRef, {
      name: name,
      nim: nim || "",
      category: category || "Anggota",
      division: division || "",
      position: position || "",
      registered_at: Date.now()
    });

    // Hapus dari unknown_cards di cloud
    const unknownRef = ref(db, `unknown_cards/${uid}`);
    await set(unknownRef, null);

    console.log(`[Firebase] User ${name} (${uid}) [${category}] berhasil disimpan ke cloud.`);
    return true;
  } catch (error) {
    console.error("[Firebase] Gagal menyimpan user ke cloud:", error);
    return false;
  }
}

// Helper untuk sinkronisasi acara aktif ke Firebase
export async function setActiveEventInFirebase(eventData) {
  try {
    const eventRef = ref(db, "active_event");
    await set(eventRef, eventData);
    console.log("[Firebase] Acara aktif berhasil disinkronkan ke cloud:", eventData);
    return true;
  } catch (error) {
    console.error("[Firebase] Gagal update acara aktif di cloud:", error);
    return false;
  }
}

// Helper untuk sinkronisasi sesi presensi aktif ke Firebase
export async function setActiveSessionInFirebase(sessionData, optionalName, optionalStatus) {
  try {
    let payload;
    const currentStatus = (window.cloudActiveSession && window.cloudActiveSession.status) || 'aktif';
    if (typeof sessionData === 'object' && sessionData !== null) {
      payload = {
        id: sessionData.id || 'sesi_1',
        name: sessionData.name || 'Sesi 1 (Datang)',
        status: sessionData.status || currentStatus || 'aktif'
      };
    } else {
      payload = {
        id: String(sessionData || 'sesi_1'),
        name: String(optionalName || sessionData || 'Sesi 1 (Datang)'),
        status: optionalStatus || currentStatus || 'aktif'
      };
    }

    const sessionRef = ref(db, "active_session");
    await set(sessionRef, payload);
    console.log("[Firebase] Sesi presensi aktif berhasil disinkronkan ke cloud:", payload);
    return true;
  } catch (error) {
    console.error("[Firebase] Gagal update sesi aktif di cloud:", error);
    return false;
  }
}

// Helper untuk mengubah status sesi aktif ("aktif" = normal, "nonaktif" = telat)
export async function setSessionStatusInFirebase(status) {
  try {
    const current = window.cloudActiveSession || {};
    const payload = {
      id: current.id || 'sesi_1',
      name: current.name || 'Sesi 1 (Datang)',
      status: status === 'nonaktif' ? 'nonaktif' : 'aktif'
    };
    const sessionRef = ref(db, "active_session");
    await set(sessionRef, payload);
    console.log("[Firebase] Status sesi aktif diubah ke:", payload.status);
    return true;
  } catch (error) {
    console.error("[Firebase] Gagal update status sesi aktif di cloud:", error);
    return false;
  }
}

// Helper untuk menghapus user dari cloud Firebase
export async function deleteUserFromFirebase(uid) {
  try {
    const userRef = ref(db, `users/${uid}`);
    await remove(userRef);
    console.log(`[Firebase] User (${uid}) berhasil dihapus dari cloud.`);
    return true;
  } catch (error) {
    console.error("[Firebase] Gagal menghapus user dari cloud:", error);
    return false;
  }
}

// Helper untuk menghapus log kehadiran dari Firebase berdasarkan tanggal
export async function clearRekapFromFirebase(date) {
  if (!window.isFirebaseConnected) return 0;
  try {
    const logs = window.cloudLogs || [];
    const logsToDelete = logs.filter(l => l.date === date);

    if (logsToDelete.length > 0) {
      for (const item of logsToDelete) {
        if (item.id) {
          await remove(ref(db, `log_presensi/${item.id}`));
        }
      }
    }

    // Bersihkan juga node attendance_today agar kartu bisa tap ulang jika dibutuhkan
    await clearAttendanceTodayNode(date);

    console.log(`[Firebase] Berhasil membersihkan ${logsToDelete.length} data presensi (${date})`);
    return logsToDelete.length;
  } catch (err) {
    console.error("[Firebase] Gagal menghapus rekap cloud:", err);
    throw err;
  }
}

// Helper untuk membersihkan node /attendance_today pada tanggal tertentu
export async function clearAttendanceTodayNode(date) {
  if (!window.isFirebaseConnected || !date) return;
  try {
    const sessionIds = new Set(['sesi_1', 'sesi_2', 'sesi_3']);
    if (window.cloudLogs && Array.isArray(window.cloudLogs)) {
      window.cloudLogs.forEach(l => {
        if (l.session_id) sessionIds.add(l.session_id);
      });
    }
    for (const s of sessionIds) {
      const nodeRef = ref(db, `attendance_today/${date}_${s}`);
      await remove(nodeRef);
    }
  } catch (err) {
    console.warn("[Firebase] Gagal membersihkan node attendance_today:", err);
  }
}

// Helper batch mendaftarkan user secara atomik multi-path (1 network request)
export async function batchRegisterUsersToFirebase(studentsList) {
  if (!window.isFirebaseConnected || !studentsList || studentsList.length === 0) return true;
  try {
    const updates = {};
    const now = Date.now();
    for (const s of studentsList) {
      if (s.uid && s.name) {
        updates[`users/${s.uid}`] = {
          name: s.name,
          nim: s.nim || "",
          category: s.category || "Anggota",
          division: s.division || "",
          position: s.position || "",
          registered_at: now
        };
        updates[`unknown_cards/${s.uid}`] = null;
      }
    }
    await update(ref(db), updates);
    console.log(`[Firebase] Batch ${studentsList.length} users updated atomically.`);
    return true;
  } catch (error) {
    console.error("[Firebase] Batch register error:", error);
    return false;
  }
}

// Helper untuk menambah/mengupdate susunan panitia proker di Firebase
export async function saveCommitteeToFirebase(eventId, uid, committeeData) {
  if (!eventId || !uid) return false;
  try {
    const commRef = ref(db, `event_committees/${eventId}/${uid}`);
    await set(commRef, {
      name: committeeData.name || '',
      nim: committeeData.nim || '',
      role: committeeData.role || 'Anggota Panitia',
      division: committeeData.division || '',
      category: committeeData.category || 'Anggota',
      assigned_at: Date.now()
    });
    console.log(`[Firebase] Panitia ${uid} (${committeeData.role}) berhasil disimpan untuk acara ${eventId}`);
    return true;
  } catch (e) {
    console.error("[Firebase] Gagal simpan panitia di cloud:", e);
    return false;
  }
}

// Helper untuk menghapus panitia proker dari Firebase
export async function deleteCommitteeFromFirebase(eventId, uid) {
  if (!eventId || !uid) return false;
  try {
    const commRef = ref(db, `event_committees/${eventId}/${uid}`);
    await remove(commRef);
    console.log(`[Firebase] Panitia ${uid} berhasil dihapus dari acara ${eventId}`);
    return true;
  } catch (e) {
    console.error("[Firebase] Gagal hapus panitia di cloud:", e);
    return false;
  }
}

// Helper untuk mengubah status telat per log presensi secara manual dari web
export async function toggleLogLateStatus(logId) {
  if (!logId) return false;
  let newTelat = null;
  let studentName = 'Mahasiswa';

  // 1. Update ke Firebase Realtime Database jika aktif
  try {
    const log = (window.cloudLogs || []).find(l => l.id === logId);
    if (log) {
      studentName = log.name || 'Mahasiswa';
      newTelat = !log.telat;
      const logRef = ref(db, `log_presensi/${logId}/telat`);
      await set(logRef, newTelat);
      log.telat = newTelat;
    }
  } catch (err) {
    console.warn("[Firebase] Gagal mengubah status telat di cloud:", err);
  }

  // 2. Sinkronkan ke database MySQL via API
  try {
    const res = await fetch('api/attendance.php', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: logId,
        action: 'toggle_late',
        telat: newTelat !== null ? (newTelat ? 1 : 0) : null
      })
    });
    const data = await res.json();
    if (data && data.success && newTelat === null) {
      newTelat = data.telat === 1;
      if (data.name) studentName = data.name;
    }
  } catch (e) {
    console.warn("[MySQL] Gagal mengubah status telat di database:", e);
  }

  if (typeof window.showToast === 'function' && newTelat !== null) {
    window.showToast(`Status ${studentName} diubah ke: ${newTelat ? 'TELAT' : 'TEPAT WAKTU'}`, newTelat ? 'warning' : 'success');
  }
  if (typeof window.loadDashboard === 'function') window.loadDashboard();
  if (typeof window.loadRekap === 'function') window.loadRekap();
  return true;
}

// Expose helper ke window
window.registerUserToFirebase = registerUserToFirebase;
window.batchRegisterUsersToFirebase = batchRegisterUsersToFirebase;
window.deleteUserFromFirebase = deleteUserFromFirebase;
window.saveCommitteeToFirebase = saveCommitteeToFirebase;
window.deleteCommitteeFromFirebase = deleteCommitteeFromFirebase;
window.setActiveEventInFirebase = setActiveEventInFirebase;
window.setActiveSessionInFirebase = setActiveSessionInFirebase;
window.setSessionStatusInFirebase = setSessionStatusInFirebase;
window.toggleLogLateStatus = toggleLogLateStatus;
window.clearRekapFromFirebase = clearRekapFromFirebase;
window.clearAttendanceTodayNode = clearAttendanceTodayNode;

// Jalankan otomatis saat script dimuat
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebaseListeners);
} else {
  initFirebaseListeners();
}
