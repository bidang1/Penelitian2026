# Konfigurasi aplikasi GUI desktop presensi mahasiswa

TITLE   = "Sistem Presensi Mahasiswa RFID"
SERVER  = "http://localhost/PRESENSI/php"   # Ganti IP/folder sesuai server Anda
API_KEY = ""                                # Samakan dengan DEVICE_API_KEY di .env jika aktif

def get_headers():
    headers = {
        "User-Agent": "Python-PresensiDesktop/2.0"
    }
    if API_KEY:
        headers["X-Device-Key"] = API_KEY
        headers["X-API-Key"] = API_KEY
    return headers

WIDTH  = 1280
HEIGHT = 760

# ── Warna Tema ──────────────────────────────────────────────
BG_DARK     = "#0F1117"    # background utama
BG_CARD     = "#1A1D2E"    # kartu/panel
BG_SIDEBAR  = "#13151F"    # sidebar
ACCENT      = "#6C63FF"    # ungu utama
ACCENT2     = "#00D4AA"    # teal aksen
DANGER      = "#FF4B5C"    # merah
WARNING     = "#FFB347"    # oranye
SUCCESS     = "#00C896"    # hijau
TEXT        = "#E8E8F0"    # teks utama
TEXT_DIM    = "#7A7A9D"    # teks sekunder
BORDER      = "#2A2D3E"    # border panel

# ── Font ─────────────────────────────────────────────────────
FONT_FAMILY = "Arial"
FONT_SM     = (FONT_FAMILY, 10)
FONT_MD     = (FONT_FAMILY, 12)
FONT_LG     = (FONT_FAMILY, 14, "bold")
FONT_XL     = (FONT_FAMILY, 18, "bold")
FONT_XXL    = (FONT_FAMILY, 24, "bold")
FONT_TITLE  = (FONT_FAMILY, 32, "bold")

# ── Folder Export Excel ──────────────────────────────────────
import os
EXPORT_FOLDER = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "exports"
)
os.makedirs(EXPORT_FOLDER, exist_ok=True)
