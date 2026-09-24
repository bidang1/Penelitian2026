# Modul rekapitulasi presensi dan export data Excel

import tkinter as tk
from tkinter import ttk, messagebox
import requests
import threading
import subprocess
import sys
import os
from datetime import datetime
from config import *
from excel_export import export_presensi, OPENPYXL_OK


class HalamanPresensi(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK)
        self._acara_list     = []
        self._selected_acara = None
        self._build_ui()
        self._load_acara()

    # ─────────────────────────────────────────────────────────
    # BUILD UI
    # ─────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Header ──────────────────────────────────────────
        header = tk.Frame(self, bg=BG_DARK)
        header.pack(fill="x", padx=24, pady=(20, 8))
        tk.Label(header, text="✅ Rekap Presensi", font=FONT_XXL,
                 bg=BG_DARK, fg=TEXT).pack(side="left")

        # ── Panel Pilih Acara ───────────────────────────────
        pick_frame = tk.Frame(self, bg=BG_CARD)
        pick_frame.pack(fill="x", padx=24, pady=8)

        tk.Label(pick_frame, text="Pilih Acara:", font=FONT_MD,
                 bg=BG_CARD, fg=TEXT, padx=12, pady=10).pack(side="left")

        self.combo_acara = ttk.Combobox(
            pick_frame, state="readonly", width=50,
            font=FONT_MD
        )
        self.combo_acara.pack(side="left", padx=8, ipady=4)
        self.combo_acara.bind("<<ComboboxSelected>>", self._on_acara_changed)

        tk.Button(
            pick_frame, text="🔄 Refresh Daftar Acara",
            font=FONT_SM, bg=BG_DARK, fg=TEXT_DIM,
            relief="flat", padx=10, pady=6, cursor="hand2",
            command=self._load_acara
        ).pack(side="left", padx=4)

        # ── Info Acara Terpilih ─────────────────────────────
        self.lbl_info_acara = tk.Label(
            self, text="← Pilih acara terlebih dahulu",
            font=FONT_MD, bg=BG_DARK, fg=TEXT_DIM,
            padx=24, anchor="w"
        )
        self.lbl_info_acara.pack(fill="x", pady=4)

        # ── Statistik Singkat ───────────────────────────────
        stat_row = tk.Frame(self, bg=BG_DARK)
        stat_row.pack(fill="x", padx=24, pady=4)

        self.stat_labels = {}
        stats = [
            ("total_mhs",   "Total Mahasiswa", TEXT_DIM),
            ("total_hadir", "Hadir",           SUCCESS),
            ("terlambat",   "Terlambat",       WARNING),
            ("tidak_hadir", "Tidak Hadir",     DANGER),
        ]
        for key, label, color in stats:
            f = tk.Frame(stat_row, bg=BG_CARD, padx=16, pady=8)
            f.pack(side="left", padx=6, fill="y")
            tk.Label(f, text=label, font=FONT_SM, bg=BG_CARD, fg=TEXT_DIM).pack()
            lbl = tk.Label(f, text="-", font=FONT_LG, bg=BG_CARD, fg=color)
            lbl.pack()
            self.stat_labels[key] = lbl

        # ── Tabel Presensi ──────────────────────────────────
        tk.Label(self, text="Daftar Kehadiran", font=FONT_LG,
                 bg=BG_DARK, fg=TEXT, padx=24).pack(anchor="w", pady=(8, 4))

        tbl_frame = tk.Frame(self, bg=BG_CARD)
        tbl_frame.pack(fill="both", expand=True, padx=24)

        cols = ("No", "NIM", "Nama", "Prodi", "Angkatan", "Waktu Tap", "Status")
        self.tree = ttk.Treeview(tbl_frame, columns=cols,
                                 show="headings", height=14)

        col_w = [40, 110, 200, 180, 80, 100, 100]
        for c, w in zip(cols, col_w):
            self.tree.heading(c, text=c)
            self.tree.column(c, width=w, anchor="center")

        self._style_tree()

        sb = ttk.Scrollbar(tbl_frame, orient="vertical",
                           command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)

        # ── Tombol Export ────────────────────────────────────
        btn_frame = tk.Frame(self, bg=BG_DARK)
        btn_frame.pack(fill="x", padx=24, pady=12)

        self.btn_export = tk.Button(
            btn_frame,
            text="📊 Export ke Excel (.xlsx)",
            font=FONT_LG, bg=SUCCESS, fg="white",
            relief="flat", padx=20, pady=10, cursor="hand2",
            command=self._export_excel,
            state="disabled"
        )
        self.btn_export.pack(side="left")

        self.btn_buka_folder = tk.Button(
            btn_frame,
            text="📁 Buka Folder Export",
            font=FONT_SM, bg=BG_CARD, fg=TEXT,
            relief="flat", padx=12, pady=10, cursor="hand2",
            command=self._buka_folder
        )
        self.btn_buka_folder.pack(side="left", padx=8)

        tk.Button(
            btn_frame, text="🔄 Refresh Presensi",
            font=FONT_SM, bg=BG_DARK, fg=TEXT_DIM,
            relief="flat", padx=12, pady=10, cursor="hand2",
            command=self._load_presensi
        ).pack(side="left", padx=0)

        self.lbl_export_status = tk.Label(
            btn_frame, text="", font=FONT_SM,
            bg=BG_DARK, fg=TEXT_DIM
        )
        self.lbl_export_status.pack(side="left", padx=12)

        # ── Warning jika openpyxl tidak ada ─────────────────
        if not OPENPYXL_OK:
            warn = tk.Label(
                self,
                text="⚠️  openpyxl belum terinstall. Jalankan: pip install openpyxl",
                font=FONT_SM, bg=DANGER, fg="white",
                padx=12, pady=6
            )
            warn.pack(fill="x", padx=24, pady=(0, 8))

    def _style_tree(self):
        style = ttk.Style()
        style.theme_use("default")
        style.configure("Treeview",
                        background=BG_CARD, foreground=TEXT,
                        rowheight=26, fieldbackground=BG_CARD,
                        font=FONT_SM)
        style.configure("Treeview.Heading",
                        background=ACCENT, foreground="white",
                        font=(FONT_FAMILY, 10, "bold"))
        style.map("Treeview", background=[("selected", ACCENT)])
        self.tree.tag_configure("hadir",       foreground=SUCCESS, background="#1A2E1F")
        self.tree.tag_configure("terlambat",   foreground=WARNING, background="#2E2A1A")
        self.tree.tag_configure("tidak_hadir", foreground=DANGER,  background="#2E1A1A")

    # ─────────────────────────────────────────────────────────
    # LOAD ACARA
    # ─────────────────────────────────────────────────────────
    def _load_acara(self):
        def fetch():
            try:
                resp = requests.get(f"{SERVER}/acara.php?action=list",
                                    headers=get_headers(),
                                    timeout=8)
                data = resp.json().get("data", [])
                self.after(0, lambda: self._populate_combo(data))
            except Exception as e:
                print(f"[Presensi] Load acara error: {e}")

        threading.Thread(target=fetch, daemon=True).start()

    def _populate_combo(self, data):
        self._acara_list = data
        labels = [
            f"{a['nama_acara']}  ({a['tanggal']})  [{a['status'].upper()}]"
            for a in data
        ]
        self.combo_acara["values"] = labels

    def _on_acara_changed(self, _=None):
        idx = self.combo_acara.current()
        if idx < 0:
            return
        self._selected_acara = self._acara_list[idx]
        acara = self._selected_acara

        self.lbl_info_acara.config(
            text=f"📅 {acara['nama_acara']}  |  📍 {acara.get('lokasi','-')}  |  "
                 f"🕐 {acara.get('waktu_mulai','')[:5]}–{acara.get('waktu_selesai','')[:5]}",
            fg=TEXT
        )
        self.btn_export.config(state="normal")
        self._load_presensi()
        self._load_statistik()

    # ─────────────────────────────────────────────────────────
    # LOAD DATA
    # ─────────────────────────────────────────────────────────
    def _load_presensi(self):
        if not self._selected_acara:
            return

        acara_id = self._selected_acara["id"]

        def fetch():
            try:
                resp = requests.get(
                    f"{SERVER}/presensi.php?action=list&acara_id={acara_id}",
                    headers=get_headers(),
                    timeout=8
                )
                data = resp.json().get("data", [])

                # Ambil semua mahasiswa untuk tampilkan tidak hadir
                resp_mhs = requests.get(f"{SERVER}/mahasiswa.php?action=list",
                                        headers=get_headers(),
                                        timeout=8)
                semua_mhs = resp_mhs.json().get("data", [])

                self.after(0, lambda: self._populate_table(data, semua_mhs))
            except Exception as e:
                print(f"[Presensi] Load presensi error: {e}")

        threading.Thread(target=fetch, daemon=True).start()

    def _populate_table(self, hadir_data, semua_mhs):
        for row in self.tree.get_children():
            self.tree.delete(row)

        hadir_nims = {str(p.get("nim", "")) for p in hadir_data}

        no = 1
        # ── Yang hadir ──────────────────────────────────────
        for p in hadir_data:
            status = p.get("status_hadir", "hadir")
            waktu_raw = p.get("waktu_tap", "")
            try:
                waktu_fmt = datetime.strptime(waktu_raw, "%Y-%m-%d %H:%M:%S").strftime("%H:%M:%S")
            except Exception:
                waktu_fmt = waktu_raw

            self.tree.insert("", "end", tags=(status,), values=(
                no, p.get("nim",""), p.get("nama",""),
                p.get("prodi",""), p.get("angkatan",""),
                waktu_fmt, status.upper()
            ))
            no += 1

        # ── Yang tidak hadir ────────────────────────────────
        for m in semua_mhs:
            if str(m.get("nim", "")) not in hadir_nims:
                self.tree.insert("", "end", tags=("tidak_hadir",), values=(
                    no, m.get("nim",""), m.get("nama",""),
                    m.get("prodi",""), m.get("angkatan",""),
                    "-", "TIDAK HADIR"
                ))
                no += 1

    def _load_statistik(self):
        if not self._selected_acara:
            return
        acara_id = self._selected_acara["id"]

        def fetch():
            try:
                resp = requests.get(
                    f"{SERVER}/presensi.php?action=statistik&acara_id={acara_id}",
                    headers=get_headers(),
                    timeout=8
                )
                data = resp.json()
                if data.get("status") == "ok":
                    self.after(0, lambda: self._update_stat(data))
            except Exception as e:
                print(f"[Presensi] Statistik error: {e}")

        threading.Thread(target=fetch, daemon=True).start()

    def _update_stat(self, data):
        self.stat_labels["total_mhs"].config(text=str(data.get("total_mhs", "-")))
        self.stat_labels["total_hadir"].config(text=str(data.get("total_hadir", "-")))
        self.stat_labels["terlambat"].config(text=str(data.get("terlambat", "-")))
        self.stat_labels["tidak_hadir"].config(text=str(data.get("tidak_hadir", "-")))

    # ─────────────────────────────────────────────────────────
    # EXPORT EXCEL
    # ─────────────────────────────────────────────────────────
    def _export_excel(self):
        if not self._selected_acara:
            return
        if not OPENPYXL_OK:
            messagebox.showerror("Error",
                                 "openpyxl belum terinstall!\nJalankan: pip install openpyxl")
            return

        acara = self._selected_acara
        self.btn_export.config(state="disabled", text="⏳ Mengekspor...")
        self.lbl_export_status.config(text="Sedang membuat file...", fg=WARNING)

        def do_export():
            try:
                filepath = export_presensi(
                    acara_id   = acara["id"],
                    nama_acara = acara["nama_acara"],
                    tanggal    = acara["tanggal"]
                )
                self.after(0, lambda: self._export_success(filepath))
            except Exception as e:
                self.after(0, lambda: self._export_error(str(e)))

        threading.Thread(target=do_export, daemon=True).start()

    def _export_success(self, filepath):
        self.btn_export.config(state="normal",
                               text="📊 Export ke Excel (.xlsx)")
        self.lbl_export_status.config(
            text=f"✅ Tersimpan: {os.path.basename(filepath)}",
            fg=SUCCESS
        )
        if messagebox.askyesno("Export Berhasil",
                               f"File berhasil dibuat!\n{filepath}\n\nBuka file sekarang?"):
            self._open_file(filepath)

    def _export_error(self, err):
        self.btn_export.config(state="normal",
                               text="📊 Export ke Excel (.xlsx)")
        self.lbl_export_status.config(text=f"❌ Gagal: {err}", fg=DANGER)
        messagebox.showerror("Export Gagal", err)

    def _buka_folder(self):
        folder = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "exports")
        )
        if sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        elif sys.platform.startswith("win"):
            subprocess.Popen(["explorer", folder])
        else:
            subprocess.Popen(["xdg-open", folder])

    def _open_file(self, filepath):
        if sys.platform == "darwin":
            subprocess.Popen(["open", filepath])
        elif sys.platform.startswith("win"):
            os.startfile(filepath)
        else:
            subprocess.Popen(["xdg-open", filepath])
