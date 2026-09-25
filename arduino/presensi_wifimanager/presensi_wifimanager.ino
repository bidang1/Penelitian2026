/*
 * ============================================================
 * SISTEM PRESENSI MAHASISWA - WIFI MANAGER & FIREBASE CLOUD
 * Hardware : ESP8266 Lolin (NodeMCU v3)
 * NFC      : PN532 (Mode SPI)
 * Display  : LCD 16x2 I2C
 * Buzzer   : Aktif/Pasif kecil (D8 / GPIO15)
 * Server   : Firebase Realtime Database (smartgen-db-26)
 * Fitur    : WiFiManager Captive Portal (Setup Wi-Fi via HP)
 * ============================================================
 *
 * FITUR UTAMA WIFI MANAGER:
 *   1. Jika alat pertama kali dinyalakan atau pindah tempat (Wi-Fi tidak ada):
 *      - ESP8266 otomatis memancarkan Wi-Fi Hotspot: "HIMATIF-Presensi"
 *      - Password Hotspot: "himatif123"
 *      - Layar LCD menampilkan instruksi: "Setup WiFi di HP / HIMATIF-Presensi"
 *      - Panitia tinggal sambungkan HP ke Wi-Fi tersebut, otomatis muncul
 *        halaman web setup (Captive Portal) untuk memilih Wi-Fi dan password.
 *   2. Data Wi-Fi tersimpan permanen di memori internal ESP8266.
 *   3. Reset Wi-Fi Paksa: Tahan tombol "FLASH" (GPIO0) pada board NodeMCU
 *      selama 3 detik saat alat baru dinyalakan.
 *
 * WIRING AMAN (ANTI GAGAL BOOT):
 *   PN532 VCC  → 3.3V (pin 3V3 di NodeMCU - BUKAN 5V!)
 *   PN532 GND  → GND
 *   PN532 SCK  → D5 (GPIO14)
 *   PN532 MISO → D6 (GPIO12)
 *   PN532 MOSI → D7 (GPIO13)
 *   PN532 SS   → D0 (GPIO16)  <-- Agar ESP bisa booting normal
 *   PN532 RSTO → Kosongkan
 *
 *   LCD VCC    → VIN (5V dari adaptor)
 *   LCD GND    → GND
 *   LCD SDA    → D2 (GPIO4)
 *   LCD SCL    → D1 (GPIO5)
 *
 *   Buzzer +   → D8 (GPIO15)
 *   Buzzer -   → GND
 *
 *   Tombol Reset Wi-Fi Manual: Tombol "FLASH" bawaan di board NodeMCU (GPIO0)
 * ============================================================
 */

#include <Arduino.h>
#include <time.h>
#include <ESP8266WiFi.h>
#include <DNSServer.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>          // Library: "WiFiManager" oleh tzapu / tablatronix
#include <SPI.h>
#include <Adafruit_PN532.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Firebase_ESP_Client.h>

// Helper untuk token dan RTDB dari library Firebase Mobizt
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// Kredensial Firebase & AP — simpan di config.h (jangan di-commit ke Git!)
#include "config.h"

// ============================================================
// KONFIGURASI PIN
// ============================================================
#define PN532_SS     16   // D0 (GPIO16)
#define BUZZER_PIN   15   // D8 (GPIO15)
#define TRIGGER_PIN  0    // D3 (GPIO0) - Tombol FLASH di board NodeMCU

// LCD I2C
#define LCD_ADDR  0x27
#define LCD_COLS  16
#define LCD_ROWS   2

// ============================================================
// INISIALISASI OBJEK
// ============================================================
Adafruit_PN532    nfc(PN532_SS); 
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig config;

// ============================================================
// VARIABEL GLOBAL
// ============================================================
unsigned long lastDebounce   = 0;
const long    DEBOUNCE_DELAY = 1500;
String        lastUID        = "";

// CACHE DATA SESI & EVENT
char cachedSessionId[24]       = "sesi_1";
char cachedSessionName[24]     = "Sesi 1";
char cachedEventName[48]       = "";
char cachedEventId[16]         = "";
char cachedTargetAudience[24]  = "committee_only";
char cachedSessionStatus[12]   = "aktif"; // "aktif" atau "nonaktif"
unsigned long lastCacheUpdate  = 0;
const long CACHE_INTERVAL      = 4000; // 4 detik

// HEARTBEAT TELEMETRY
unsigned long lastHeartbeat    = 0;
const long HEARTBEAT_INTERVAL  = 20000; // 20 detik

// ASYNC LOG & UNKNOWN CARD
bool hasPendingLog             = false;
unsigned long pendingLogTime   = 0;
const long PENDING_LOG_TIMEOUT = 10000; // 10 detik max sebelum discard
FirebaseJson pendingLogData;

bool hasPendingUnknownCard        = false;
char pendingUnknownUID[33]        = "";
unsigned long pendingUnknownTime  = 0;
FirebaseJson pendingUnknownData;

// STATE MACHINE LCD (NON-BLOCKING & ANTI-FLICKER)
unsigned long lcdResetTime     = 0;
bool isLcdStandby              = true;
uint8_t lcdPhase               = 0; // 0=Standby, 1=Screen1, 2=Screen2
char pendingLcdLine1[17]       = "";
char pendingLcdLine2[17]       = "";
unsigned long lastStandbyTick  = 0;
uint8_t standbySubPhase        = 0;

// Flag: buzzer terakhir aktif → perlu reset LOW sekali
bool buzzerNeedsReset          = false;

// ============================================================
// KARAKTER KUSTOM LCD (CGRAM 5x8)
// ============================================================
byte iconCheck[8] = {
  B00000, B00001, B00011, B10110,
  B11100, B01000, B00000, B00000
};
byte iconCard[8] = {
  B11111, B10001, B11111, B10101,
  B10001, B11111, B00000, B00000
};
byte iconWifi[8] = {
  B00000, B01110, B10001, B00100,
  B01010, B00000, B00100, B00000
};
byte iconClock[8] = {
  B00000, B01110, B10101, B10111,
  B10001, B01110, B00000, B00000
};

// ============================================================
// HELPER: Safe string copy ke fixed-size char buffer
// ============================================================
static void safeCopy(char* dest, const String& src, size_t maxLen) {
  size_t len = src.length();
  if (len >= maxLen) len = maxLen - 1;
  src.toCharArray(dest, maxLen);
  dest[len] = '\0';
}

// Helper: Salin value Firebase string ke char buffer (skip jika "null" atau kosong)
static bool fbStringTo(FirebaseJsonData& d, char* dest, size_t maxLen) {
  if (d.stringValue.length() > 0 && d.stringValue != "null") {
    safeCopy(dest, d.stringValue, maxLen);
    return true;
  }
  return false;
}

// ============================================================
// BUZZER - MANUAL PWM (Anti-Interference)
// ============================================================
void playTone(int freq, int durationMs) {
  if (freq <= 0) { delay(durationMs); return; }
  long halfPeriod    = 500000L / freq;       
  int  cyclesChunk   = max(1, (int)(2000L / max(1L, 2 * halfPeriod)));   
  int  totalCycles   = (long)freq * durationMs / 1000;
  int  done          = 0;

  while (done < totalCycles) {
    int batch = min(cyclesChunk, totalCycles - done);
    noInterrupts();                          
    for (int i = 0; i < batch; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delayMicroseconds(halfPeriod);
      digitalWrite(BUZZER_PIN, LOW);
      delayMicroseconds(halfPeriod);
    }
    interrupts();                            
    done += batch;
    yield();
  }
  digitalWrite(BUZZER_PIN, LOW);
  buzzerNeedsReset = false;
}

void buzzSuccess()   { buzzerNeedsReset = true; playTone(2700, 150); }
void buzzConnected() { buzzerNeedsReset = true; playTone(3200, 100); delay(50); playTone(2500, 100); delay(50); playTone(2700, 80); delay(30); playTone(3500, 300); }
void buzzNotice()    { buzzerNeedsReset = true; playTone(2500, 100); delay(60); playTone(3100, 140); }
void buzzUnknown()   { buzzerNeedsReset = true; playTone(1800, 120); delay(60); playTone(1800, 120); }
void buzzAlready()   { buzzerNeedsReset = true; playTone(2700, 70); delay(60); playTone(2700, 70); delay(60); playTone(2700, 70); }
void buzzError()     { buzzerNeedsReset = true; playTone(400, 120); delay(60); playTone(400, 120); delay(60); playTone(250, 500); }

// Buzzer TELAT: sirine nada ganda peringatan keras (3 siklus ~1.5 detik, dikurangi dari 5)
void buzzLate() {
  buzzerNeedsReset = true;
  for (int i = 0; i < 3; i++) {
    playTone(2200, 180);
    delay(60);
    playTone(3200, 180);
    delay(60);
    yield();
  }
}

// ============================================================
// LCD HELPER (ANTI-FLICKER & BUFFER 16 KARAKTER)
// ============================================================
char lastLcdBuf1[17] = "";
char lastLcdBuf2[17] = "";

void lcdForceClear() {
  lcd.clear();
  lastLcdBuf1[0] = '\0';
  lastLcdBuf2[0] = '\0';
}

void lcdPrint(const char* baris1, const char* baris2 = "") {
  char buf1[17], buf2[17];
  int len1 = baris1 ? strlen(baris1) : 0;
  for (int i = 0; i < 16; i++) buf1[i] = (i < len1) ? baris1[i] : ' ';
  buf1[16] = '\0';
  int len2 = baris2 ? strlen(baris2) : 0;
  for (int i = 0; i < 16; i++) buf2[i] = (i < len2) ? baris2[i] : ' ';
  buf2[16] = '\0';

  if (strcmp(lastLcdBuf1, buf1) != 0) {
    lcd.setCursor(0, 0); lcd.print(buf1);
    strcpy(lastLcdBuf1, buf1);
  }
  if (strcmp(lastLcdBuf2, buf2) != 0) {
    lcd.setCursor(0, 1); lcd.print(buf2);
    strcpy(lastLcdBuf2, buf2);
  }
}

// Helper teks rata tengah (Center text) langsung ke buffer char[17]
void centerTextBuf(char* dest, const char* src, int width = 16) {
  int srcLen = src ? strlen(src) : 0;
  if (srcLen >= width) {
    memcpy(dest, src, width);
    dest[width] = '\0';
    return;
  }
  int pad = (width - srcLen) / 2;
  memset(dest, ' ', width);
  memcpy(dest + pad, src, srcLen);
  dest[width] = '\0';
}

// Format nama mahasiswa agar rapi di layar LCD 14 kolom (sisakan ruang icon)
void formatNamaLCD(char* dest, const char* fullNameIn, size_t maxLen = 15) {
  char work[32];
  strncpy(work, fullNameIn, sizeof(work) - 1);
  work[sizeof(work) - 1] = '\0';
  
  // Trim leading/trailing spaces
  char* start = work;
  while (*start == ' ') start++;
  int len = strlen(start);
  while (len > 0 && start[len - 1] == ' ') start[--len] = '\0';

  if ((size_t)len <= maxLen) {
    strncpy(dest, start, maxLen);
    dest[maxLen] = '\0';
    return;
  }

  // Singkatan nama panjang Indonesia
  char lower[32];
  strncpy(lower, start, sizeof(lower) - 1);
  lower[sizeof(lower) - 1] = '\0';
  for (int i = 0; lower[i]; i++) lower[i] = tolower(lower[i]);

  char shortened[32];
  bool didShorten = false;

  if (strncmp(lower, "muhammad ", 9) == 0) {
    snprintf(shortened, sizeof(shortened), "M. %s", start + 9);
    didShorten = true;
  } else if (strncmp(lower, "muh. ", 5) == 0) {
    snprintf(shortened, sizeof(shortened), "M. %s", start + 5);
    didShorten = true;
  } else if (strncmp(lower, "mochamad ", 9) == 0) {
    snprintf(shortened, sizeof(shortened), "M. %s", start + 9);
    didShorten = true;
  } else if (strncmp(lower, "ahmad ", 6) == 0) {
    snprintf(shortened, sizeof(shortened), "Ah. %s", start + 6);
    didShorten = true;
  }

  const char* src = didShorten ? shortened : start;
  size_t srcLen = strlen(src);

  if (srcLen <= maxLen) {
    strncpy(dest, src, maxLen);
    dest[min(srcLen, maxLen)] = '\0';
    return;
  }

  // Potong di spasi terakhir sebelum batas
  char temp[32];
  strncpy(temp, src, min((size_t)31, maxLen + 1));
  temp[min((size_t)31, maxLen + 1)] = '\0';
  
  char* lastSpace = strrchr(temp, ' ');
  if (lastSpace && (lastSpace - temp) > 4) {
    *lastSpace = '\0';
    strncpy(dest, temp, maxLen);
    dest[maxLen] = '\0';
  } else {
    strncpy(dest, src, maxLen);
    dest[maxLen] = '\0';
  }
}

// Format nama sesi ramah LCD 16 kolom
void formatSesiLCD(char* dest, const char* id, const char* rawName) {
  if (strcmp(id, "sesi_1") == 0) { strcpy(dest, "Sesi 1"); return; }
  if (strcmp(id, "sesi_2") == 0) { strcpy(dest, "Sesi 2"); return; }
  if (strcmp(id, "sesi_3") == 0) { strcpy(dest, "Sesi 3"); return; }
  strncpy(dest, rawName, 16);
  dest[16] = '\0';
}

// Update layar standby dinamis (Jam NTP live + info sesi bergantian)
void updateStandbyScreen() {
  if (!isLcdStandby) return;

  time_t now = time(nullptr);
  struct tm* ptm = localtime(&now);
  bool ntpReady = (ptm && ptm->tm_year > 100);

  char line1[17];
  if (ntpReady) {
    snprintf(line1, sizeof(line1), "HIMATIF    %02d:%02d", ptm->tm_hour, ptm->tm_min);
  } else {
    snprintf(line1, sizeof(line1), "PRESENSI HIMATIF");
  }

  char line2[17];
  if (standbySubPhase == 0) {
    if (strcmp(cachedSessionStatus, "nonaktif") == 0) {
      snprintf(line2, sizeof(line2), "! MODE TELAT !  ");
    } else {
      snprintf(line2, sizeof(line2), "\x02 TAP PANITIA >>");
    }
  } else {
    char sesiFmt[17];
    formatSesiLCD(sesiFmt, cachedSessionId, cachedSessionName);
    if (strcmp(cachedSessionStatus, "nonaktif") == 0) {
      char tmp[24];
      snprintf(tmp, sizeof(tmp), "%s (TLT)", sesiFmt);
      tmp[14] = '\0';
      snprintf(line2, sizeof(line2), "\x02 %s", tmp);
    } else {
      sesiFmt[14] = '\0';
      snprintf(line2, sizeof(line2), "\x02 %s", sesiFmt);
    }
  }
  lcdPrint(line1, line2);
}

// Tampilan layar siap / standby
void tampilkanStandby() {
  isLcdStandby = true;
  lcdPhase = 0;
  standbySubPhase = 0;
  updateStandbyScreen();
}

// Callback dipanggil jika ESP masuk mode Access Point (menunggu panitia setting Wi-Fi)
void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println(F("\n[WiFiManager] Gagal konek ke Wi-Fi tersimpan."));
  Serial.println(F("[WiFiManager] Masuk Mode Access Point (AP)!"));
  Serial.print(F("[WiFiManager] Hubungkan HP ke Wi-Fi: "));
  Serial.println(myWiFiManager->getConfigPortalSSID());
  Serial.print(F("[WiFiManager] IP Portal: "));
  Serial.println(WiFi.softAPIP());

  char centered[17];
  centerTextBuf(centered, AP_SSID);
  lcdPrint("Setup WiFi di HP", centered);
  buzzNotice();
}

// ============================================================
// KONEKSI WIFI MANAGER (Auto-Connect & Captive Portal)
// ============================================================
void setupWiFi() {
  lcdPrint("\x03 Cari Wi-Fi...", "Menghubungkan...");
  Serial.println(F("\n[WiFiManager] Mencoba menyambung ke Wi-Fi..."));

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  WiFiManager wm;

  wm.setAPCallback(configModeCallback);
  wm.setConfigPortalTimeout(180);
  wm.setConnectTimeout(10);
  wm.setTitle("HIMATIF UMS - Setup Presensi");

  std::vector<const char *> menu = {"wifi", "info", "sep", "restart"};
  wm.setMenu(menu);

  bool res = wm.autoConnect(AP_SSID, AP_PASS);

  if (!res) {
    Serial.println(F("[WiFiManager] Timeout atau Gagal Konek. Restarting..."));
    lcdPrint("\x03 WiFi Gagal!  ", "Restarting...   ");
    buzzError(); 
    delay(2000); 
    ESP.restart(); 
  }

  String ipESP = WiFi.localIP().toString();
  Serial.print(F("\n[WiFi] Terhubung! IP: "));
  Serial.println(ipESP);

  char centered[17];
  centerTextBuf(centered, ipESP.c_str());
  lcdPrint("\x03 WiFi Terhubung", centered);

  // Sinkronisasi Waktu NTP (WIB: UTC+7 = 7 * 3600)
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");
  Serial.println(F("[NTP] Memulai sinkronisasi waktu Internet (WIB)..."));

  delay(600);
}

// ============================================================
// REFRESH CACHE
// ============================================================
void refreshCache() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

  // Ambil data sesi lengkap sekaligus (id, name, status) dalam 1 request JSON
  if (Firebase.RTDB.getJSON(&fbdo, "/active_session")) {
    if (fbdo.dataType() == "json") {
      FirebaseJson& json = fbdo.jsonObject();
      FirebaseJsonData d;
      if (json.get(d, "id"))     fbStringTo(d, cachedSessionId, sizeof(cachedSessionId));
      if (json.get(d, "name"))   fbStringTo(d, cachedSessionName, sizeof(cachedSessionName));
      if (json.get(d, "status")) fbStringTo(d, cachedSessionStatus, sizeof(cachedSessionStatus));
    }
  }
  yield();

  // Ambil data event aktif jika ada (id, name, target_audience)
  if (Firebase.RTDB.getJSON(&fbdo, "/active_event")) {
    if (fbdo.dataType() == "json") {
      FirebaseJson& jsonEv = fbdo.jsonObject();
      FirebaseJsonData d;
      if (jsonEv.get(d, "id"))              fbStringTo(d, cachedEventId, sizeof(cachedEventId));
      if (jsonEv.get(d, "name"))            fbStringTo(d, cachedEventName, sizeof(cachedEventName));
      if (jsonEv.get(d, "target_audience")) fbStringTo(d, cachedTargetAudience, sizeof(cachedTargetAudience));
    }
  }

  lastCacheUpdate = millis();
  Serial.print(F("[CACHE] Diperbarui: "));
  Serial.print(cachedSessionName);
  Serial.print(F(" | Status: "));
  Serial.print(cachedSessionStatus);
  Serial.print(F(" | Event: "));
  Serial.println(cachedEventName[0] ? cachedEventName : "(Tidak ada)");
}

// ============================================================
// TELEMETRY HEARTBEAT KE FIREBASE CLOUD
// ============================================================
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

  FirebaseJson devJson;
  time_t now = time(nullptr);
  struct tm* ptm = localtime(&now);
  bool ntpReady = (ptm && ptm->tm_year > 100);
  if (ntpReady) {
    devJson.set("last_seen", (double)now * 1000);
  } else {
    devJson.set("last_seen/.sv", "timestamp");
  }
  devJson.set("ip", WiFi.localIP().toString());
  devJson.set("rssi", WiFi.RSSI());
  devJson.set("status", "online");
  devJson.set("active_session", cachedSessionId);
  devJson.set("session_status", cachedSessionStatus);
  if (cachedEventName[0]) {
    devJson.set("active_event", cachedEventName);
  }
  if (cachedEventId[0]) {
    devJson.set("active_event_id", cachedEventId);
  }
  devJson.set("uptime_sec", millis() / 1000);
  devJson.set("free_heap", ESP.getFreeHeap());
  Firebase.RTDB.updateNode(&fbdo, "/devices/esp8266", &devJson);
  lastHeartbeat = millis();
  Serial.println(F("[HEARTBEAT] Telemetry ESP8266 dikirim ke Cloud"));
}

// ============================================================
// BACA UID KARTU PN532
// ============================================================
String bacaKartu() {
  static uint8_t uid[16];
  uint8_t panjangUID = 0;

  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &panjangUID, 150)) {
    return ""; 
  }

  if (panjangUID == 0 || panjangUID > sizeof(uid)) {
    return "";
  }

  char uidStr[33]; // max 16 bytes × 2 hex chars + null
  int pos = 0;
  for (uint8_t i = 0; i < panjangUID; i++) {
    pos += snprintf(uidStr + pos, sizeof(uidStr) - pos, "%02X", uid[i]);
  }
  return String(uidStr);
}

// ============================================================
// HANDLE KARTU BELUM TERDAFTAR (Pendaftaran Baru / e-KTP)
// ============================================================
void handleUnknownCard(const String& uid) {
  Serial.print(F("[NEW] Kartu baru terdeteksi. UID: "));
  Serial.println(uid);

  char centered[17];
  String uidDisplay = "UID: " + uid;
  centerTextBuf(centered, uidDisplay.c_str());
  lcdPrint("BELUM TERDAFTAR!", centered);

  buzzUnknown();

  // Simpan data kartu baru untuk dikirim asinkron di loop() — mencegah Soft WDT crash
  safeCopy(pendingUnknownUID, uid.c_str(), sizeof(pendingUnknownUID));

  time_t now = time(nullptr);
  struct tm* ptm = localtime(&now);
  bool ntpReady = (ptm && ptm->tm_year > 100);

  pendingUnknownData.clear();
  pendingUnknownData.set("uid", pendingUnknownUID);

  if (ntpReady) {
    char timeStr[24];
    snprintf(timeStr, sizeof(timeStr), "%04d-%02d-%02dT%02d:%02d:%02d",
             ptm->tm_year + 1900, ptm->tm_mon + 1, ptm->tm_mday,
             ptm->tm_hour, ptm->tm_min, ptm->tm_sec);
    pendingUnknownData.set("last_seen", timeStr);
    pendingUnknownData.set("timestamp", (double)now * 1000);
  } else {
    pendingUnknownData.set("last_seen/.sv", "timestamp");
  }

  hasPendingUnknownCard = true;
  pendingUnknownTime    = millis();

  // NON-BLOCKING LCD STATE
  strncpy(pendingLcdLine1, "KARTU BARU/ASING", 16); pendingLcdLine1[16] = '\0';
  strncpy(pendingLcdLine2, "Daftar ke Admin ", 16); pendingLcdLine2[16] = '\0';
  
  isLcdStandby = false;
  lcdPhase = 2; 
  lcdResetTime = millis() + 1800;
}

// ============================================================
// PROSES TAP KARTU LANGSUNG KE FIREBASE
// ============================================================
void prosesTapKartu(const String& uid) {
  if (WiFi.status() != WL_CONNECTED) {
    lcdPrint("\x03 WIFI PUTUS!  ", "Menghubungkan...");
    setupWiFi();
    tampilkanStandby();
    return;
  }

  Serial.print(F("[Firebase] Mengecek UID di Cloud: "));
  Serial.println(uid);

  char centered[17];
  String uidDisplay = "UID: " + uid;
  centerTextBuf(centered, uidDisplay.c_str());
  lcdPrint("\x02 MEMBACA KARTU", centered);

  if (!Firebase.ready()) {
    lcdPrint("  SERVER CLOUD  ", " Belum Siap...  ");
    buzzError();
    delay(800);
    tampilkanStandby();
    return;
  }

  // Cek data user di Cloud
  String pathUser = "/users/" + uid;
  bool userFound = false;
  char nama[48] = "";
  char nim[24] = "";
  char position[32] = "";
  char role[32] = "";
  char division[24] = "";
  char category[16] = "";

  if (Firebase.RTDB.getJSON(&fbdo, pathUser)) {
    if (fbdo.dataType() == "json") {
      FirebaseJson& jsonUser = fbdo.jsonObject();
      FirebaseJsonData d;
      
      if (jsonUser.get(d, "name"))     fbStringTo(d, nama, sizeof(nama));
      if (jsonUser.get(d, "nim"))      fbStringTo(d, nim, sizeof(nim));
      if (jsonUser.get(d, "position")) fbStringTo(d, position, sizeof(position));
      if (jsonUser.get(d, "role"))     fbStringTo(d, role, sizeof(role));
      if (jsonUser.get(d, "division")) fbStringTo(d, division, sizeof(division));
      if (jsonUser.get(d, "category")) fbStringTo(d, category, sizeof(category));

      if (nama[0]) {
        userFound = true;
      }
    }
  }

  yield();

  // Jika kartu belum terdaftar, tangani sebagai unknown card
  if (!userFound) {
    fbdo.clear();
    yield();
    ESP.wdtFeed();
    handleUnknownCard(uid);
    return;
  }
  
  // Ambil waktu dari NTP (Format 24 Jam konsisten HH:mm)
  time_t now = time(nullptr);
  struct tm* ptm = localtime(&now);

  char waktuBuf[16] = "00:00";
  char dateBuf[16] = "today";
  bool ntpReady = (ptm && ptm->tm_year > 100);

  if (ntpReady) {
    snprintf(waktuBuf, sizeof(waktuBuf), "%02d:%02d", ptm->tm_hour, ptm->tm_min);
    snprintf(dateBuf, sizeof(dateBuf), "%04d-%02d-%02d", ptm->tm_year + 1900, ptm->tm_mon + 1, ptm->tm_mday);
  }

  // Format nama mahasiswa untuk tampilan LCD
  char namaDisplay[17];
  formatNamaLCD(namaDisplay, nama, 14);

  // Gunakan data cache (sinkronisasi setiap 4 detik di loop) — tanpa re-fetch saat tap
  // Cache sudah cukup akurat dan menghemat ~200ms latensi per tap

  // Sinkronisasi event aktif jika cache masih kosong (hanya saat pertama kali)
  if (!cachedEventId[0]) {
    if (Firebase.RTDB.getString(&fbdo, "/active_event/id")) {
      String idStr = fbdo.stringData();
      if (idStr.length() > 0 && idStr != "null") {
        safeCopy(cachedEventId, idStr, sizeof(cachedEventId));
      }
    } else if (Firebase.RTDB.getInt(&fbdo, "/active_event/id")) {
      snprintf(cachedEventId, sizeof(cachedEventId), "%d", fbdo.intData());
    }
  }
  if (!cachedEventName[0]) {
    if (Firebase.RTDB.getString(&fbdo, "/active_event/name")) {
      String s = fbdo.stringData();
      if (s.length() > 0 && s != "null") safeCopy(cachedEventName, s, sizeof(cachedEventName));
    }
  }
  if (strlen(cachedTargetAudience) == 0) {
    if (Firebase.RTDB.getString(&fbdo, "/active_event/target_audience")) {
      String s = fbdo.stringData();
      if (s.length() > 0 && s != "null") safeCopy(cachedTargetAudience, s, sizeof(cachedTargetAudience));
      else strcpy(cachedTargetAudience, "all");
    }
  }

  yield();

  // ============================================================
  // VALIDASI KEPANITIAAN: Batasi hanya mahasiswa panitia yang bisa absen
  // ============================================================
  bool isPanitia = false;
  char panitiaRole[32] = "";

  // 1. Cek kepanitiaan pada event aktif di /event_committees/{eventId}/{uid}
  if (cachedEventId[0] && strcmp(cachedEventId, "null") != 0) {
    String commPath = "/event_committees/" + String(cachedEventId) + "/" + uid;
    if (Firebase.RTDB.getJSON(&fbdo, commPath)) {
      if (fbdo.dataType() == "json") {
        isPanitia = true;
        FirebaseJson& jsonComm = fbdo.jsonObject();
        FirebaseJsonData dRole;
        if (jsonComm.get(dRole, "role") && dRole.stringValue.length() > 0 && dRole.stringValue != "null") {
          safeCopy(panitiaRole, dRole.stringValue, sizeof(panitiaRole));
        } else {
          strcpy(panitiaRole, "Panitia");
        }
      }
    }
  }

  // 2. Cek node umum /committees/{uid} (skip jika sudah ditemukan)
  if (!isPanitia) {
    String commPath2 = "/committees/" + uid;
    if (Firebase.RTDB.getJSON(&fbdo, commPath2)) {
      if (fbdo.dataType() == "json") {
        isPanitia = true;
        FirebaseJson& jsonComm = fbdo.jsonObject();
        FirebaseJsonData dRole;
        if (jsonComm.get(dRole, "role") && dRole.stringValue.length() > 0 && dRole.stringValue != "null") {
          safeCopy(panitiaRole, dRole.stringValue, sizeof(panitiaRole));
        } else {
          strcpy(panitiaRole, "Panitia");
        }
      }
    }
  }

  // 3. Cek posisi atau jabatan di profil user (/users/{uid}) — tanpa request tambahan
  if (!isPanitia) {
    char posCheck[32], roleCheck[32];
    strncpy(posCheck, position, sizeof(posCheck) - 1); posCheck[sizeof(posCheck) - 1] = '\0';
    strncpy(roleCheck, role, sizeof(roleCheck) - 1); roleCheck[sizeof(roleCheck) - 1] = '\0';
    for (int i = 0; posCheck[i]; i++) posCheck[i] = tolower(posCheck[i]);
    for (int i = 0; roleCheck[i]; i++) roleCheck[i] = tolower(roleCheck[i]);

    if (strstr(posCheck, "panitia") || strstr(posCheck, "ketua") || 
        strstr(posCheck, "sie") || strstr(posCheck, "koor") ||
        strstr(posCheck, "sekretaris") || strstr(posCheck, "bendahara") ||
        strstr(posCheck, "pengurus") || strstr(posCheck, "divisi") ||
        strstr(posCheck, "bidang") ||
        strstr(roleCheck, "panitia") || strstr(roleCheck, "ketua") || 
        strstr(roleCheck, "sie") || strstr(roleCheck, "koor") ||
        strstr(roleCheck, "sekretaris") || strstr(roleCheck, "bendahara")) {
      isPanitia = true;
      if (position[0]) strncpy(panitiaRole, position, sizeof(panitiaRole) - 1);
      else if (role[0]) strncpy(panitiaRole, role, sizeof(panitiaRole) - 1);
      else strcpy(panitiaRole, "Panitia");
      panitiaRole[sizeof(panitiaRole) - 1] = '\0';
    }
  }

  yield();

  // Validasi hak akses sesuai target audience acara
  bool isAllowed = false;
  const char* rejectMsg = "BUKAN PANITIA!";
  const char* rejectSub = "Khusus Panitia!";

  if (strcmp(cachedTargetAudience, "all") == 0 || cachedTargetAudience[0] == '\0') {
    isAllowed = true;
  } else if (strcmp(cachedTargetAudience, "bpi_bph") == 0) {
    char catCheck[16];
    strncpy(catCheck, category, sizeof(catCheck) - 1); catCheck[sizeof(catCheck) - 1] = '\0';
    for (int i = 0; catCheck[i]; i++) catCheck[i] = toupper(catCheck[i]);
    if (strstr(catCheck, "BPI") || strstr(catCheck, "BPH") || isPanitia) {
      isAllowed = true;
    } else {
      rejectMsg = "KHUSUS BPI & BPH";
      rejectSub = "Bukan BPI/BPH!";
    }
  } else {
    if (isPanitia) {
      isAllowed = true;
    }
  }

  if (!isAllowed) {
    Serial.print(F("[DITOLAK] "));
    Serial.print(rejectMsg);
    Serial.print(F(": "));
    Serial.print(nama);
    Serial.print(F(" ("));
    Serial.print(uid);
    Serial.println(F(")"));
    buzzError();

    char centeredMsg[17], centeredDenied[17];
    centerTextBuf(centeredMsg, rejectMsg);
    centerTextBuf(centeredDenied, "AKSES DITOLAK!");
    lcdPrint(centeredMsg, centeredDenied);

    // State machine untuk layar penjelasan (Non-blocking)
    centerTextBuf(pendingLcdLine1, namaDisplay);
    centerTextBuf(pendingLcdLine2, rejectSub);
    isLcdStandby = false;
    lcdPhase = 2;
    lcdResetTime = millis() + 1800;
    return;
  }

  // Cek apakah mahasiswa sudah tap pada SESI aktif hari ini
  String pathToday = "/attendance_today/" + String(dateBuf) + "_" + String(cachedSessionId) + "/" + uid;
  if (Firebase.RTDB.getBool(&fbdo, pathToday) && fbdo.dataType() == "boolean" && fbdo.boolData() == true) {
    Serial.print(F("[INFO] Kartu sudah absen di sesi "));
    Serial.print(cachedSessionName);
    Serial.print(F(": "));
    Serial.println(nama);
    buzzAlready();
    
    // Layar 1: Nama + Status Peringatan (dengan icon)
    char centeredNama[17];
    centerTextBuf(centeredNama, namaDisplay);
    lcdPrint(centeredNama, " ! SUDAH ABSEN !");
    
    // Setting State Machine untuk layar 2 (NON-BLOCKING)
    char sesiFmt[17];
    formatSesiLCD(sesiFmt, cachedSessionId, cachedSessionName);
    centerTextBuf(pendingLcdLine1, sesiFmt);
    centerTextBuf(pendingLcdLine2, "\x01 Data Tercatat");
    
    isLcdStandby = false;
    lcdPhase = 2; 
    lcdResetTime = millis() + 1200;
    return;
  }

  yield();

  // ============================================================
  // CEK STATUS SESI: Jika "nonaktif" → mahasiswa TELAT
  // ============================================================
  bool isTelat = (strcmp(cachedSessionStatus, "nonaktif") == 0);

  if (isTelat) {
    Serial.print(F("[TELAT] Sesi nonaktif! Mahasiswa telat: "));
    Serial.println(nama);
    char centeredNama[17];
    centerTextBuf(centeredNama, namaDisplay);
    lcdPrint(centeredNama, "!! ANDA TELAT !!");
    buzzLate();
  }

  // Tandai sudah tap pada sesi ini di cloud
  Firebase.RTDB.setBool(&fbdo, pathToday, true);

  if (!isTelat) {
    Serial.print(F("[OK] Absen Berhasil ("));
    Serial.print(cachedSessionName);
    Serial.print(F("): "));
    Serial.println(nama);
    buzzSuccess();
  }

  // Layar 1: Icon Centang + Nama + Status Hadir & Waktu
  char line1Hadir[17];
  snprintf(line1Hadir, sizeof(line1Hadir), "\x01 %s", namaDisplay);

  char statusHadir[17];
  if (isTelat) {
    if (ntpReady) snprintf(statusHadir, sizeof(statusHadir), "TELAT \x04 %s", waktuBuf);
    else snprintf(statusHadir, sizeof(statusHadir), "TELAT TERCATAT! ");
  } else {
    if (ntpReady) snprintf(statusHadir, sizeof(statusHadir), "HADIR \x04 %s", waktuBuf);
    else snprintf(statusHadir, sizeof(statusHadir), "ABSEN BERHASIL!");
  }

  char centeredLine1[17], centeredStatus[17];
  centerTextBuf(centeredLine1, line1Hadir);
  centerTextBuf(centeredStatus, statusHadir);
  lcdPrint(centeredLine1, centeredStatus);

  // Setting State Machine untuk layar 2 (NON-BLOCKING)
  char sesiFmt[17];
  formatSesiLCD(sesiFmt, cachedSessionId, cachedSessionName);
  centerTextBuf(pendingLcdLine1, sesiFmt);

  char barisDua[17];
  if (panitiaRole[0]) {
    strncpy(barisDua, panitiaRole, 16);
  } else if (nim[0]) {
    snprintf(barisDua, sizeof(barisDua), "NIM: %s", nim);
  } else {
    strcpy(barisDua, " TERIMA KASIH! ");
  }
  barisDua[16] = '\0';
  centerTextBuf(pendingLcdLine2, barisDua);

  isLcdStandby = false;
  lcdPhase = 2; 
  lcdResetTime = millis() + 1300;

  // Siapkan log absen untuk dikirim asinkron
  pendingLogData.clear();
  pendingLogData.set("uid", uid);
  pendingLogData.set("name", nama);
  if (nim[0]) {
    pendingLogData.set("nim", nim);
  }
  pendingLogData.set("session_id", cachedSessionId);
  pendingLogData.set("session_name", cachedSessionName);

  if (cachedEventName[0] && strcmp(cachedEventName, "null") != 0) {
    pendingLogData.set("event_name", cachedEventName);
  }

  pendingLogData.set("is_committee", true);
  if (panitiaRole[0]) {
    pendingLogData.set("committee_role", panitiaRole);
  }

  if (ntpReady) {
    pendingLogData.set("waktu", waktuBuf);
    pendingLogData.set("date", dateBuf);
    pendingLogData.set("timestamp", (double)now * 1000);
  } else {
    pendingLogData.set("timestamp/.sv", "timestamp");
  }

  if (isTelat) {
    pendingLogData.set("telat", true);
  }
  
  hasPendingLog = true;
  pendingLogTime = millis();
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);

  // Matikan buzzer secara paksa saat boot
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW); 

  // Inisialisasi LCD
  Wire.begin(4, 5); // SDA = D2, SCL = D1
  lcd.init();
  lcd.backlight();

  // Daftarkan karakter kustom ke CGRAM LCD
  lcd.createChar(1, iconCheck);
  lcd.createChar(2, iconCard);
  lcd.createChar(3, iconWifi);
  lcd.createChar(4, iconClock);

  lcdForceClear();
  lcdPrint("PRESENSI HIMATIF", "Memulai Sistem..");

  // Inisialisasi Pin Tombol FLASH NodeMCU (GPIO0)
  pinMode(TRIGGER_PIN, INPUT_PULLUP);

  // Deteksi jika tombol FLASH ditekan saat alat baru menyala -> Paksa Reset Wi-Fi
  if (digitalRead(TRIGGER_PIN) == LOW) {
    lcdPrint("Reset Wi-Fi?", "Tahan 3 Detik...");
    delay(3000);
    if (digitalRead(TRIGGER_PIN) == LOW) {
      lcdPrint("Wi-Fi Direset!", "Masuk Setup HP..");
      buzzNotice();
      WiFiManager wm;
      wm.resetSettings();
      delay(1500);
    }
  }

  // Inisialisasi RFID PN532
  SPI.begin();
  nfc.begin();

  uint32_t firmwareVersion = nfc.getFirmwareVersion();
  if (!firmwareVersion) {
    lcdPrint("PN532 ERROR!", "Cek Kabel SPI!");
    buzzError(); 
    delay(5000); 
    ESP.restart(); 
  }

  nfc.SAMConfig();
  
  // Koneksi Wi-Fi via WiFiManager (Auto-connect atau Captive Portal)
  setupWiFi();

  // Inisialisasi Firebase
  config.api_key = FIREBASE_API_KEY;
  config.database_url = FIREBASE_DATABASE_URL;

  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println(F("[Firebase] Koneksi Sukses"));
  } else {
    Serial.print(F("[Firebase] Error: "));
    Serial.println(config.signer.signupError.message.c_str());
  }

  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Set buffer SSL BearSSL agar stabil & tidak out of memory
  fbdo.setBSSLBufferSize(4096, 1024);
  fbdo.setResponseSize(1024);

  // Ambil data cache pertama kali
  refreshCache();

  // Kirim heartbeat perdana ke cloud
  sendHeartbeat();

  tampilkanStandby();
  buzzConnected(); 
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  ESP.wdtFeed();

  // Reset buzzer hanya sekali setelah terakhir aktif
  if (buzzerNeedsReset) {
    digitalWrite(BUZZER_PIN, LOW);
    buzzerNeedsReset = false;
  }

  unsigned long sekarang = millis();

  // ============================================================
  // 1. PASTIKAN KONEKSI WI-FI TETAP AKTIF (di awal loop, sebelum card read)
  // ============================================================
  if (WiFi.status() != WL_CONNECTED) {
    lcdPrint("\x03 WIFI PUTUS!  ", "Menghubungkan...");
    setupWiFi();
    tampilkanStandby();
    return;
  }

  // ============================================================
  // 2. SINKRONISASI STATUS SESI BERKALA SAAT STANDBY (4 Detik)
  // ============================================================
  if (isLcdStandby && (unsigned long)(sekarang - lastCacheUpdate) > CACHE_INTERVAL) {
    refreshCache();
  }

  // Kirim heartbeat telemetry ke Firebase (setiap 20 detik)
  // Jangan kirim jika sedang ada antrean log/kartu baru agar koneksi SSL tidak bertabrakan
  if (!hasPendingLog && !hasPendingUnknownCard && (unsigned long)(sekarang - lastHeartbeat) > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
  }

  // Update live clock & info sesi di LCD saat standby (setiap 1 detik)
  if (isLcdStandby && (unsigned long)(sekarang - lastStandbyTick) >= 1000) {
    lastStandbyTick = sekarang;
    standbySubPhase = (sekarang % 6000 < 3000) ? 0 : 1;
    updateStandbyScreen();
  }

  // Proses pending log secara asinkron (dengan timeout 10 detik)
  if (hasPendingLog) {
    if ((unsigned long)(sekarang - pendingLogTime) > PENDING_LOG_TIMEOUT) {
      hasPendingLog = false;
      Serial.println(F("[LOG] Timeout — pending log di-discard"));
    } else if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
      fbdo.clear();
      delay(50);
      yield();
      ESP.wdtFeed();
      if (Firebase.RTDB.pushJSON(&fbdo, "/log_presensi", &pendingLogData)) {
        Serial.println(F("[LOG] Log presensi berhasil dikirim (Async)"));
      } else {
        Serial.print(F("[LOG] Gagal kirim log: "));
        Serial.println(fbdo.errorReason());
      }
      hasPendingLog = false;
    }
  }

  // Proses pending unknown card secara asinkron (dengan timeout 10 detik)
  if (hasPendingUnknownCard) {
    if ((unsigned long)(sekarang - pendingUnknownTime) > PENDING_LOG_TIMEOUT) {
      hasPendingUnknownCard = false;
      Serial.println(F("[UNKNOWN] Timeout — unknown card di-discard"));
    } else if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
      char path[64];
      snprintf(path, sizeof(path), "/unknown_cards/%s", pendingUnknownUID);
      fbdo.clear();
      delay(50);
      yield();
      ESP.wdtFeed();
      Serial.print(F("[Firebase] Mencatat unknown card ke cloud: "));
      Serial.println(pendingUnknownUID);
      if (Firebase.RTDB.setJSON(&fbdo, path, &pendingUnknownData)) {
        Serial.println(F("[Firebase] Unknown card berhasil dicatat di cloud (Async)!"));
      } else {
        Serial.print(F("[Firebase] Gagal simpan unknown card: "));
        Serial.println(fbdo.errorReason());
      }
      hasPendingUnknownCard = false;
    }
  }

  // Proses State Machine LCD (NON-BLOCKING)
  if (!isLcdStandby && sekarang > lcdResetTime) {
    if (lcdPhase == 2) {
      lcdPrint(pendingLcdLine1, pendingLcdLine2);
      lcdPhase = 1;
      lcdResetTime = sekarang + 1100;
    } else if (lcdPhase == 1) {
      tampilkanStandby();
    }
  }

  // ============================================================
  // 3. BACA KARTU RFID
  // ============================================================
  String uid = bacaKartu();
  if (uid.length() == 0) {
    yield(); 
    return;
  }

  // Debounce kartu yang sama (millis wrap-around safe)
  if (uid == lastUID && (unsigned long)(sekarang - lastDebounce) < DEBOUNCE_DELAY) {
    return;
  }

  lastUID      = uid;
  lastDebounce = sekarang;

  Serial.print(F("[KARTU] UID Terdeteksi: "));
  Serial.println(uid);
  prosesTapKartu(uid);
}