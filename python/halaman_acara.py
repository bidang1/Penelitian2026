# Modul manajemen acara dan kegiatan organisasi

import tkinter as tk
from tkinter import ttk, messagebox
import requests
import threading
from datetime import date
from config import *

STATUS_COLORS = {
    "aktif":   SUCCESS,
    "draft":   TEXT_DIM,
    "selesai": WARNING,
}

STATUS_ICONS = {
    "aktif":   "🟢",
    "draft":   "⚪",
    "selesai": "🏁",
}


class HalamanAcara(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK)
        self._selected_id = None
        self._build_ui()
        self._load_data()

    def _build_ui(self):
        # ── Header ──────────────────────────────────────────
        header = tk.Frame(self, bg=BG_DARK)
        header.pack(fill="x", padx=24, pady=(20, 8))
        tk.Label(header, text="📅 Kelola Acara", font=FONT_XXL,
                 bg=BG_DARK, fg=TEXT).pack(side="left")

        # ── Filter tab ───────────────────────────────────────
        filter_frame = tk.Frame(self, bg=BG_DARK)
        filter_frame.pack(fill="x", padx=24, pady=4)

        self.filter_var = tk.StringVar(value="")
        filter_btns = [
            ("Semua",   ""),
            ("Draft",   "draft"),
            ("Aktif",   "aktif"),
            ("Selesai", "selesai"),
        ]
        for label, val in filter_btns:
            rb = tk.Radiobutton(
                filter_frame, text=label,
                variable=self.filter_var, value=val,
                command=self._load_data,
                bg=BG_DARK, fg=TEXT, selectcolor=BG_CARD,
                activebackground=BG_DARK, font=FONT_SM,
                indicatoron=0, relief="flat",
                padx=12, pady=4
            )
            rb.pack(side="left", padx=4)

        # ── Layout Utama ────────────────────────────────────
        main = tk.Frame(self, bg=BG_DARK)
        main.pack(fill="both", expand=True, padx=24, pady=8)

        # ── Tabel ───────────────────────────────────────────
        tbl_frame = tk.Frame(main, bg=BG_CARD)
        tbl_frame.pack(side="left", fill="both", expand=True)

        cols = ("ID", "Nama Acara", "Tanggal", "Waktu", "Lokasi",
                "Status", "Hadir")
        self.tree = ttk.Treeview(tbl_frame, columns=cols,
                                 show="headings", height=18)
        col_w = [40, 220, 90, 110, 140, 80, 50]
        for c, w in zip(cols, col_w):
            self.tree.heading(c, text=c)
            self.tree.column(c, width=w, anchor="center")

        self._style_tree()
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        sb = ttk.Scrollbar(tbl_frame, orient="vertical",
                           command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)

        # ── Form Panel (kanan) ─────────────────────────────
        form_frame = tk.Frame(main, bg=BG_CARD, width=320)
        form_frame.pack(side="right", fill="y")
        form_frame.pack_propagate(False)

        tk.Label(form_frame, text="Form Acara", font=FONT_LG,
                 bg=BG_CARD, fg=TEXT, pady=12).pack()
        tk.Frame(form_frame, bg=ACCENT, height=2).pack(fill="x", padx=16)

        inner = tk.Frame(form_frame, bg=BG_CARD)
        inner.pack(fill="both", expand=True, padx=16, pady=12)

        self.entries = {}

        def add_field(key, label, default=""):
            tk.Label(inner, text=label, font=FONT_SM,
                     bg=BG_CARD, fg=TEXT_DIM, anchor="w").pack(fill="x", pady=(6, 2))
            var = tk.StringVar(value=default)
            e = tk.Entry(inner, textvariable=var,
                         font=FONT_MD, bg=BG_DARK, fg=TEXT,
                         insertbackground=TEXT, relief="flat",
                         highlightthickness=1, highlightbackground=BORDER,
                         highlightcolor=ACCENT)
            e.pack(fill="x", ipady=5)
            self.entries[key] = var

        add_field("nama_acara",    "Nama Acara *")
        add_field("tanggal",       "Tanggal (YYYY-MM-DD) *",
                  default=date.today().isoformat())
        add_field("waktu_mulai",   "Waktu Mulai (HH:MM)", "08:00")
        add_field("waktu_selesai", "Waktu Selesai (HH:MM)", "10:00")
        add_field("lokasi",        "Lokasi")

        # Deskripsi (text area)
        tk.Label(inner, text="Deskripsi", font=FONT_SM,
                 bg=BG_CARD, fg=TEXT_DIM, anchor="w").pack(fill="x", pady=(6, 2))
        self.txt_deskripsi = tk.Text(
            inner, height=3, font=FONT_SM,
            bg=BG_DARK, fg=TEXT,
            insertbackground=TEXT, relief="flat",
            highlightthickness=1, highlightbackground=BORDER
        )
        self.txt_deskripsi.pack(fill="x")

        # ── Tombol ──────────────────────────────────────────
        tk.Frame(inner, bg=BORDER, height=1).pack(fill="x", pady=10)

        btn_row = tk.Frame(inner, bg=BG_CARD)
        btn_row.pack(fill="x")

        tk.Button(btn_row, text="➕ Tambah",
                  font=FONT_SM, bg=SUCCESS, fg="white",
                  relief="flat", pady=6, cursor="hand2",
                  command=self._tambah).pack(side="left", expand=True, fill="x", padx=(0, 4))

        self.btn_edit = tk.Button(
            btn_row, text="✏️ Simpan Edit",
            font=FONT_SM, bg=ACCENT, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._edit, state="disabled"
        )
        self.btn_edit.pack(side="left", expand=True, fill="x", padx=(4, 0))

        # ── Tombol status ───────────────────────────────────
        self.btn_aktifkan = tk.Button(
            inner, text="🟢 Aktifkan Acara Ini",
            font=FONT_SM, bg=SUCCESS, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._aktifkan, state="disabled"
        )
        self.btn_aktifkan.pack(fill="x", pady=(6, 0))

        self.btn_selesai = tk.Button(
            inner, text="🏁 Tandai Selesai",
            font=FONT_SM, bg=WARNING, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._selesaikan, state="disabled"
        )
        self.btn_selesai.pack(fill="x", pady=(4, 0))

        tk.Button(
            inner, text="🗑️ Hapus Acara",
            font=FONT_SM, bg=DANGER, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._hapus
        ).pack(fill="x", pady=(4, 0))

        tk.Button(
            inner, text="🔄 Reset Form",
            font=FONT_SM, bg=BG_DARK, fg=TEXT_DIM,
            relief="flat", pady=4, cursor="hand2",
            command=self._reset_form
        ).pack(fill="x", pady=4)

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

        self.tree.tag_configure("aktif",   foreground=SUCCESS)
        self.tree.tag_configure("draft",   foreground=TEXT_DIM)
        self.tree.tag_configure("selesai", foreground=WARNING)

    # ─────────────────────────────────────────────────────────
    # DATA
    # ─────────────────────────────────────────────────────────
    def _load_data(self, *_):
        def fetch():
            try:
                f = self.filter_var.get()
                params = {"action": "list"}
                if f:
                    params["filter"] = f
                resp = requests.get(f"{SERVER}/acara.php",
                                    params=params, headers=get_headers(), timeout=8)
                data = resp.json().get("data", [])
                self.after(0, lambda: self._populate(data))
            except Exception as e:
                print(f"[Acara] Load error: {e}")

        threading.Thread(target=fetch, daemon=True).start()

    def _populate(self, data):
        for row in self.tree.get_children():
            self.tree.delete(row)
        for a in data:
            icon = STATUS_ICONS.get(a["status"], "")
            waktu = f"{a.get('waktu_mulai','')[:5]} – {a.get('waktu_selesai','')[:5]}"
            self.tree.insert("", "end", iid=str(a["id"]), tags=(a["status"],),
                             values=(
                                 a["id"],
                                 a["nama_acara"],
                                 a["tanggal"],
                                 waktu,
                                 a.get("lokasi", ""),
                                 f"{icon} {a['status'].upper()}",
                                 a.get("jumlah_hadir", 0)
                             ))

    def _on_select(self, _=None):
        sel = self.tree.selection()
        if not sel:
            return
        item  = self.tree.item(sel[0])
        vals  = item["values"]
        tags  = item["tags"]
        self._selected_id = vals[0]

        self.entries["nama_acara"].set(vals[1])
        self.entries["tanggal"].set(vals[2])
        waktu_parts = str(vals[3]).split(" – ")
        self.entries["waktu_mulai"].set(waktu_parts[0] if waktu_parts else "")
        self.entries["waktu_selesai"].set(waktu_parts[1] if len(waktu_parts) > 1 else "")
        self.entries["lokasi"].set(vals[4])

        self.btn_edit.config(state="normal")
        status = tags[0] if tags else ""
        self.btn_aktifkan.config(
            state="normal" if status in ("draft", "selesai") else "disabled"
        )
        self.btn_selesai.config(
            state="normal" if status == "aktif" else "disabled"
        )

    def _reset_form(self):
        for key, var in self.entries.items():
            var.set("")
        self.entries["tanggal"].set(date.today().isoformat())
        self.entries["waktu_mulai"].set("08:00")
        self.entries["waktu_selesai"].set("10:00")
        self.txt_deskripsi.delete("1.0", "end")
        self._selected_id = None
        self.btn_edit.config(state="disabled")
        self.btn_aktifkan.config(state="disabled")
        self.btn_selesai.config(state="disabled")

    def _get_data(self):
        return {
            "nama_acara":    self.entries["nama_acara"].get().strip(),
            "tanggal":       self.entries["tanggal"].get().strip(),
            "waktu_mulai":   self.entries["waktu_mulai"].get().strip() or "08:00",
            "waktu_selesai": self.entries["waktu_selesai"].get().strip() or "10:00",
            "lokasi":        self.entries["lokasi"].get().strip(),
            "deskripsi":     self.txt_deskripsi.get("1.0", "end").strip(),
        }

    def _tambah(self):
        data = self._get_data()
        if not data["nama_acara"] or not data["tanggal"]:
            messagebox.showwarning("Kurang Lengkap",
                                   "Nama Acara dan Tanggal wajib diisi!")
            return
        data["action"] = "tambah"

        def post():
            try:
                resp = requests.post(f"{SERVER}/acara.php",
                                     data=data, headers=get_headers(), timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Acara berhasil ditambahkan!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _edit(self):
        if not self._selected_id:
            return
        data = self._get_data()
        data["action"] = "edit"
        data["id"]     = self._selected_id

        def post():
            try:
                resp = requests.post(f"{SERVER}/acara.php",
                                     data=data, headers=get_headers(), timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Acara berhasil diubah!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _aktifkan(self):
        if not self._selected_id:
            return
        nama = self.entries["nama_acara"].get()
        if not messagebox.askyesno("Konfirmasi",
                                   f"Aktifkan acara:\n'{nama}'?\n\nAcara lain yang sedang aktif akan di-nonaktifkan."):
            return

        def post():
            try:
                resp = requests.post(f"{SERVER}/acara.php",
                                     data={"action": "aktifkan",
                                           "id": self._selected_id},
                                     headers=get_headers(),
                                     timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Acara diaktifkan! Arduino siap menerima presensi."))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _selesaikan(self):
        if not self._selected_id:
            return

        def post():
            try:
                resp = requests.post(f"{SERVER}/acara.php",
                                     data={"action": "selesaikan",
                                           "id": self._selected_id},
                                     headers=get_headers(),
                                     timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Acara ditandai selesai!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _hapus(self):
        if not self._selected_id:
            messagebox.showwarning("Pilih Dulu", "Pilih acara yang akan dihapus!")
            return
        nama = self.entries["nama_acara"].get()
        if not messagebox.askyesno("Konfirmasi",
                                   f"Hapus acara '{nama}'?\nData presensi juga ikut terhapus."):
            return

        def post():
            try:
                resp = requests.post(f"{SERVER}/acara.php",
                                     data={"action": "hapus",
                                           "id": self._selected_id},
                                     headers=get_headers(),
                                     timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Acara dihapus!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _on_success(self, msg):
        messagebox.showinfo("Berhasil", msg)
        self._reset_form()
        self._load_data()
