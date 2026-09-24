# Modul tampilan dashboard utama presensi

import tkinter as tk
from tkinter import ttk
import requests
import threading
from datetime import datetime
from config import *


class HalamanDashboard(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK)
        self._build_ui()
        self._refresh()

    # ─────────────────────────────────────────────────────────
    # BUILD UI
    # ─────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Header ──────────────────────────────────────────
        header = tk.Frame(self, bg=BG_DARK)
        header.pack(fill="x", padx=24, pady=(20, 8))

        tk.Label(header, text="📊 Dashboard", font=FONT_XXL,
                 bg=BG_DARK, fg=TEXT).pack(side="left")

        self.lbl_waktu = tk.Label(header, text="", font=FONT_MD,
                                  bg=BG_DARK, fg=TEXT_DIM)
        self.lbl_waktu.pack(side="right")
        self._tick_clock()

        # ── Kartu Statistik ─────────────────────────────────
        card_frame = tk.Frame(self, bg=BG_DARK)
        card_frame.pack(fill="x", padx=24, pady=8)

        self.stat_cards = {}
        stats_def = [
            ("total_mhs",   "👥 Total\nMahasiswa", ACCENT,   "0"),
            ("total_acara", "📅 Total\nAcara",     ACCENT2,  "0"),
            ("acara_aktif", "🟢 Acara\nAktif",     SUCCESS,  "-"),
            ("hadir_hari",  "✅ Hadir\nHari Ini",  WARNING,  "0"),
        ]
        for key, label, color, default in stats_def:
            card = self._make_stat_card(card_frame, label, default, color)
            card.pack(side="left", expand=True, fill="both", padx=6)
            self.stat_cards[key] = card

        # ── Acara Aktif Sekarang ─────────────────────────────
        self.frame_acara_info = tk.Frame(self, bg=BG_CARD,
                                         relief="flat", bd=0)
        self.frame_acara_info.pack(fill="x", padx=24, pady=8)

        self.lbl_acara_aktif = tk.Label(
            self.frame_acara_info,
            text="⏳ Memuat info acara...",
            font=FONT_LG, bg=BG_CARD, fg=TEXT,
            padx=16, pady=12, anchor="w"
        )
        self.lbl_acara_aktif.pack(fill="x")

        # ── Live Feed Tabel ──────────────────────────────────
        tk.Label(self, text="🕐 Presensi Terbaru",
                 font=FONT_LG, bg=BG_DARK, fg=TEXT,
                 padx=24).pack(anchor="w", pady=(8, 4))

        tbl_frame = tk.Frame(self, bg=BG_CARD)
        tbl_frame.pack(fill="both", expand=True, padx=24, pady=(0, 16))

        cols = ("Waktu", "NIM", "Nama", "Prodi", "Acara", "Status")
        self.tree = ttk.Treeview(tbl_frame, columns=cols,
                                 show="headings", height=12)

        col_widths = [90, 110, 180, 180, 200, 90]
        for c, w in zip(cols, col_widths):
            self.tree.heading(c, text=c)
            self.tree.column(c, width=w, anchor="center")

        self._style_tree()

        sb = ttk.Scrollbar(tbl_frame, orient="vertical",
                           command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)

        # ── Tombol Refresh ───────────────────────────────────
        btn_frame = tk.Frame(self, bg=BG_DARK)
        btn_frame.pack(fill="x", padx=24, pady=(0, 16))

        tk.Button(
            btn_frame, text="🔄 Refresh",
            font=FONT_MD, bg=ACCENT, fg="white",
            relief="flat", padx=16, pady=6, cursor="hand2",
            command=self._refresh
        ).pack(side="left")

    def _make_stat_card(self, parent, label, value, color):
        frame = tk.Frame(parent, bg=BG_CARD, relief="flat", bd=0)

        # Top color strip
        strip = tk.Frame(frame, bg=color, height=4)
        strip.pack(fill="x")

        tk.Label(frame, text=label, font=FONT_SM,
                 bg=BG_CARD, fg=TEXT_DIM).pack(pady=(10, 2))

        val_label = tk.Label(frame, text=value, font=FONT_TITLE,
                              bg=BG_CARD, fg=color)
        val_label.pack(pady=(0, 12))

        # Simpan referensi value label
        frame.val_label = val_label
        return frame

    def _style_tree(self):
        style = ttk.Style()
        style.theme_use("default")
        style.configure("Treeview",
                        background=BG_CARD,
                        foreground=TEXT,
                        rowheight=28,
                        fieldbackground=BG_CARD,
                        font=FONT_SM)
        style.configure("Treeview.Heading",
                        background=ACCENT,
                        foreground="white",
                        font=(FONT_FAMILY, 10, "bold"))
        style.map("Treeview",
                  background=[("selected", ACCENT)])

        self.tree.tag_configure("hadir",     background="#1A2E1F", foreground=SUCCESS)
        self.tree.tag_configure("terlambat", background="#2E2A1A", foreground=WARNING)

    def _tick_clock(self):
        now = datetime.now().strftime("%A, %d %B %Y  |  %H:%M:%S")
        self.lbl_waktu.config(text=now)
        self.after(1000, self._tick_clock)

    # ─────────────────────────────────────────────────────────
    # REFRESH DATA
    # ─────────────────────────────────────────────────────────
    def _refresh(self):
        threading.Thread(target=self._fetch_data, daemon=True).start()
        # Auto-refresh setiap 15 detik
        self.after(15000, self._refresh)

    def _fetch_data(self):
        try:
            resp = requests.get(
                f"{SERVER}/presensi.php?action=dashboard",
                headers=get_headers(),
                timeout=8
            )
            data = resp.json()
            if data.get("status") == "ok":
                self.after(0, lambda: self._update_ui(data))
        except Exception as e:
            print(f"[Dashboard] Error: {e}")

    def _update_ui(self, data):
        # Update kartu
        self.stat_cards["total_mhs"].val_label.config(
            text=str(data.get("total_mhs", 0))
        )
        self.stat_cards["total_acara"].val_label.config(
            text=str(data.get("total_acara", 0))
        )

        acara = data.get("acara_aktif")
        if acara:
            self.stat_cards["acara_aktif"].val_label.config(text="AKTIF")
            self.lbl_acara_aktif.config(
                text=f"🟢 Acara Aktif: {acara['nama_acara']}  |  "
                     f"📍 {acara.get('lokasi', '-')}  |  "
                     f"🕐 {acara.get('waktu_mulai','')[:5]} - {acara.get('waktu_selesai','')[:5]}",
                fg=SUCCESS
            )
        else:
            self.stat_cards["acara_aktif"].val_label.config(text="-")
            self.lbl_acara_aktif.config(
                text="⚪ Tidak ada acara aktif saat ini",
                fg=TEXT_DIM
            )

        # Hitung hadir hari ini dari recent
        recent = data.get("recent", [])
        today  = datetime.now().strftime("%Y-%m-%d")
        hadir_hari = sum(1 for p in recent if p.get("waktu_tap", "").startswith(today))
        self.stat_cards["hadir_hari"].val_label.config(text=str(hadir_hari))

        # Update tabel
        for row in self.tree.get_children():
            self.tree.delete(row)

        for p in recent:
            waktu_raw = p.get("waktu_tap", "")
            try:
                waktu_fmt = datetime.strptime(waktu_raw, "%Y-%m-%d %H:%M:%S").strftime("%H:%M:%S")
            except Exception:
                waktu_fmt = waktu_raw

            status = p.get("status_hadir", "hadir")
            tag    = status

            self.tree.insert("", "end", values=(
                waktu_fmt,
                p.get("nim", ""),
                p.get("nama", ""),
                p.get("prodi", ""),
                p.get("nama_acara", ""),
                status.upper()
            ), tags=(tag,))
