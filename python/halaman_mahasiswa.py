# Modul manajemen data mahasiswa dan kartu RFID

import tkinter as tk
from tkinter import ttk, messagebox
import requests
import threading
from config import *


class HalamanMahasiswa(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK)
        self._selected_id = None
        self._scan_mode   = False
        self._build_ui()
        self._load_data()

    # ─────────────────────────────────────────────────────────
    # BUILD UI
    # ─────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Header ──────────────────────────────────────────
        header = tk.Frame(self, bg=BG_DARK)
        header.pack(fill="x", padx=24, pady=(20, 8))

        tk.Label(header, text="👥 Kelola Mahasiswa", font=FONT_XXL,
                 bg=BG_DARK, fg=TEXT).pack(side="left")

        # ── Search Bar ──────────────────────────────────────
        search_frame = tk.Frame(self, bg=BG_DARK)
        search_frame.pack(fill="x", padx=24, pady=4)

        tk.Label(search_frame, text="🔍", font=FONT_LG,
                 bg=BG_DARK, fg=TEXT_DIM).pack(side="left")

        self.var_search = tk.StringVar()
        self.var_search.trace("w", lambda *_: self._load_data())
        entry_search = tk.Entry(search_frame, textvariable=self.var_search,
                                font=FONT_MD, bg=BG_CARD, fg=TEXT,
                                insertbackground=TEXT, relief="flat",
                                width=40)
        entry_search.pack(side="left", padx=8, ipady=6)
        tk.Label(search_frame, text="(cari nama / NIM / prodi)",
                 font=FONT_SM, bg=BG_DARK, fg=TEXT_DIM).pack(side="left")

        # ── Layout Utama: Tabel kiri + Form kanan ───────────
        main = tk.Frame(self, bg=BG_DARK)
        main.pack(fill="both", expand=True, padx=24, pady=8)

        # ── Tabel ──────────────────────────────────────────
        tbl_frame = tk.Frame(main, bg=BG_CARD)
        tbl_frame.pack(side="left", fill="both", expand=True)

        cols = ("ID", "UID Kartu", "NIM", "Nama", "Prodi", "Angkatan")
        self.tree = ttk.Treeview(tbl_frame, columns=cols,
                                 show="headings", height=20)
        col_w = [40, 130, 100, 180, 160, 80]
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

        # ── Tombol Aksi Tabel ──────────────────────────────
        btn_tbl = tk.Frame(main, bg=BG_DARK, width=10)
        btn_tbl.pack(side="left", fill="y", padx=8)

        # ── Form Panel (kanan) ─────────────────────────────
        form_frame = tk.Frame(main, bg=BG_CARD, width=310)
        form_frame.pack(side="right", fill="y")
        form_frame.pack_propagate(False)

        tk.Label(form_frame, text="Form Mahasiswa", font=FONT_LG,
                 bg=BG_CARD, fg=TEXT, pady=12).pack()

        # Separator
        tk.Frame(form_frame, bg=ACCENT, height=2).pack(fill="x", padx=16)

        form_inner = tk.Frame(form_frame, bg=BG_CARD)
        form_inner.pack(fill="both", expand=True, padx=16, pady=12)

        self.entries = {}
        fields = [
            ("uid",      "UID Kartu RFID *"),
            ("nim",      "NIM *"),
            ("nama",     "Nama Lengkap *"),
            ("prodi",    "Program Studi"),
            ("angkatan", "Angkatan"),
        ]

        for key, label in fields:
            tk.Label(form_inner, text=label, font=FONT_SM,
                     bg=BG_CARD, fg=TEXT_DIM, anchor="w").pack(fill="x", pady=(6, 2))

            var = tk.StringVar()
            e = tk.Entry(form_inner, textvariable=var,
                         font=FONT_MD, bg=BG_DARK, fg=TEXT,
                         insertbackground=TEXT, relief="flat",
                         highlightthickness=1, highlightbackground=BORDER,
                         highlightcolor=ACCENT)
            e.pack(fill="x", ipady=5)
            self.entries[key] = var

        # ── Tombol Scan UID ─────────────────────────────────
        self.btn_scan = tk.Button(
            form_inner, text="📡 Scan Kartu RFID",
            font=FONT_SM, bg=ACCENT2, fg="white",
            relief="flat", pady=5, cursor="hand2",
            command=self._toggle_scan
        )
        self.btn_scan.pack(fill="x", pady=(8, 0))

        self.lbl_scan_status = tk.Label(
            form_inner, text="", font=FONT_SM,
            bg=BG_CARD, fg=TEXT_DIM
        )
        self.lbl_scan_status.pack(pady=2)

        # ── Tombol Aksi Form ────────────────────────────────
        tk.Frame(form_inner, bg=BORDER, height=1).pack(fill="x", pady=10)

        btn_actions = tk.Frame(form_inner, bg=BG_CARD)
        btn_actions.pack(fill="x")

        self.btn_tambah = tk.Button(
            btn_actions, text="➕ Tambah",
            font=FONT_SM, bg=SUCCESS, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._tambah
        )
        self.btn_tambah.pack(side="left", expand=True, fill="x", padx=(0, 4))

        self.btn_edit = tk.Button(
            btn_actions, text="✏️ Simpan Edit",
            font=FONT_SM, bg=ACCENT, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._edit, state="disabled"
        )
        self.btn_edit.pack(side="left", expand=True, fill="x", padx=(4, 0))

        tk.Button(
            form_inner, text="🗑️ Hapus Dipilih",
            font=FONT_SM, bg=DANGER, fg="white",
            relief="flat", pady=6, cursor="hand2",
            command=self._hapus
        ).pack(fill="x", pady=(8, 0))

        tk.Button(
            form_inner, text="🔄 Reset Form",
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

    # ─────────────────────────────────────────────────────────
    # DATA
    # ─────────────────────────────────────────────────────────
    def _load_data(self, *_):
        def fetch():
            try:
                s = self.var_search.get().strip()
                params = {"action": "list"}
                if s:
                    params["search"] = s
                resp = requests.get(f"{SERVER}/mahasiswa.php",
                                    params=params, headers=get_headers(), timeout=8)
                data = resp.json().get("data", [])
                self.after(0, lambda: self._populate_table(data))
            except Exception as e:
                print(f"[Mahasiswa] Load error: {e}")

        threading.Thread(target=fetch, daemon=True).start()

    def _populate_table(self, data):
        for row in self.tree.get_children():
            self.tree.delete(row)
        for m in data:
            self.tree.insert("", "end", iid=str(m["id"]), values=(
                m["id"], m["uid"], m["nim"], m["nama"],
                m["prodi"], m["angkatan"]
            ))

    def _on_select(self, _=None):
        sel = self.tree.selection()
        if not sel:
            return
        item  = self.tree.item(sel[0])
        vals  = item["values"]
        self._selected_id = vals[0]

        self.entries["uid"].set(vals[1])
        self.entries["nim"].set(vals[2])
        self.entries["nama"].set(vals[3])
        self.entries["prodi"].set(vals[4])
        self.entries["angkatan"].set(vals[5])

        self.btn_edit.config(state="normal")

    def _reset_form(self):
        for v in self.entries.values():
            v.set("")
        self._selected_id = None
        self.btn_edit.config(state="disabled")
        self.lbl_scan_status.config(text="")

    # ─────────────────────────────────────────────────────────
    # SCAN UID
    # ─────────────────────────────────────────────────────────
    def _toggle_scan(self):
        if not self._scan_mode:
            self._scan_mode = True
            self.btn_scan.config(text="⏹ Stop Scan", bg=DANGER)
            self.lbl_scan_status.config(text="⏳ Menunggu tap kartu...", fg=WARNING)
            # Clear UID lama
            try:
                requests.get(f"{SERVER}/mahasiswa.php?action=clear_uid", headers=get_headers(), timeout=4)
            except Exception:
                pass
            self._do_scan()
        else:
            self._scan_mode = False
            self.btn_scan.config(text="📡 Scan Kartu RFID", bg=ACCENT2)
            self.lbl_scan_status.config(text="Scan dihentikan", fg=TEXT_DIM)

    def _do_scan(self):
        if not self._scan_mode:
            return
        def check():
            try:
                resp = requests.get(
                    f"{SERVER}/mahasiswa.php?action=scan_uid",
                    headers=get_headers(),
                    timeout=4
                )
                uid = resp.json().get("uid", "").strip()
                if uid:
                    self.after(0, lambda: self._uid_diterima(uid))
                    return
            except Exception:
                pass
            if self._scan_mode:
                self.after(1500, self._do_scan)

        threading.Thread(target=check, daemon=True).start()

    def _uid_diterima(self, uid):
        self._scan_mode = False
        self.btn_scan.config(text="📡 Scan Kartu RFID", bg=ACCENT2)
        self.entries["uid"].set(uid.upper())
        self.lbl_scan_status.config(
            text=f"✅ UID diterima: {uid}", fg=SUCCESS
        )
        # Clear UID di server
        try:
            requests.get(f"{SERVER}/mahasiswa.php?action=clear_uid", headers=get_headers(), timeout=4)
        except Exception:
            pass

    # ─────────────────────────────────────────────────────────
    # CRUD
    # ─────────────────────────────────────────────────────────
    def _get_form_data(self):
        return {
            "uid":      self.entries["uid"].get().strip().upper(),
            "nim":      self.entries["nim"].get().strip(),
            "nama":     self.entries["nama"].get().strip(),
            "prodi":    self.entries["prodi"].get().strip(),
            "angkatan": self.entries["angkatan"].get().strip() or str(__import__("datetime").date.today().year)
        }

    def _tambah(self):
        data = self._get_form_data()
        if not data["uid"] or not data["nim"] or not data["nama"]:
            messagebox.showwarning("Form Tidak Lengkap",
                                   "UID Kartu, NIM, dan Nama wajib diisi!")
            return
        data["action"] = "tambah"

        def post():
            try:
                resp = requests.post(f"{SERVER}/mahasiswa.php",
                                     data=data, headers=get_headers(), timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Mahasiswa berhasil ditambahkan!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "Error")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _edit(self):
        if not self._selected_id:
            return
        data = self._get_form_data()
        data["action"] = "edit"
        data["id"]     = self._selected_id

        def post():
            try:
                resp = requests.post(f"{SERVER}/mahasiswa.php",
                                     data=data, headers=get_headers(), timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Data berhasil diubah!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "Error")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _hapus(self):
        if not self._selected_id:
            messagebox.showwarning("Pilih Dulu",
                                   "Pilih mahasiswa yang ingin dihapus!")
            return
        nama = self.entries["nama"].get()
        if not messagebox.askyesno("Konfirmasi",
                                   f"Hapus mahasiswa '{nama}'?\nData presensi juga akan terhapus."):
            return

        def post():
            try:
                resp = requests.post(f"{SERVER}/mahasiswa.php",
                                     data={"action": "hapus",
                                           "id": self._selected_id},
                                     headers=get_headers(),
                                     timeout=8)
                r = resp.json()
                if r.get("status") == "ok":
                    self.after(0, lambda: self._on_success("Mahasiswa dihapus!"))
                else:
                    self.after(0, lambda: messagebox.showerror("Gagal", r.get("pesan", "Error")))
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=post, daemon=True).start()

    def _on_success(self, msg):
        messagebox.showinfo("Berhasil", msg)
        self._reset_form()
        self._load_data()
