# Entry point aplikasi GUI presensi mahasiswa RFID

import tkinter as tk
from tkinter import ttk
from config import *
from halaman_dashboard  import HalamanDashboard
from halaman_mahasiswa  import HalamanMahasiswa
from halaman_acara      import HalamanAcara
from halaman_presensi   import HalamanPresensi


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(TITLE)
        self.geometry(f"{WIDTH}x{HEIGHT}")
        self.configure(bg=BG_DARK)
        self.resizable(True, True)
        self.minsize(1024, 600)

        # ── Halaman aktif ────────────────────────────────────
        self._pages        = {}
        self._active_page  = None
        self._active_btn   = None

        self._build_layout()
        self._show_page("dashboard")

    # ─────────────────────────────────────────────────────────
    # LAYOUT: Sidebar + Content
    # ─────────────────────────────────────────────────────────
    def _build_layout(self):
        # ── Sidebar ─────────────────────────────────────────
        sidebar = tk.Frame(self, bg=BG_SIDEBAR, width=220)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)

        # Logo / Title
        logo_frame = tk.Frame(sidebar, bg=ACCENT, pady=20)
        logo_frame.pack(fill="x")

        tk.Label(logo_frame, text="🎓", font=("Arial", 28),
                 bg=ACCENT).pack()
        tk.Label(logo_frame, text="PRESENSI",
                 font=(FONT_FAMILY, 14, "bold"),
                 bg=ACCENT, fg="white").pack()
        tk.Label(logo_frame, text="RFID Mahasiswa",
                 font=(FONT_FAMILY, 9),
                 bg=ACCENT, fg="#E0DDFF").pack()

        # Nav buttons
        nav_items = [
            ("📊", "Dashboard",  "dashboard"),
            ("👥", "Mahasiswa",  "mahasiswa"),
            ("📅", "Acara",      "acara"),
            ("✅", "Presensi",   "presensi"),
        ]

        nav_frame = tk.Frame(sidebar, bg=BG_SIDEBAR)
        nav_frame.pack(fill="both", expand=True, pady=12)

        self._nav_buttons = {}
        for icon, label, key in nav_items:
            btn = self._make_nav_btn(nav_frame, icon, label, key)
            btn.pack(fill="x", padx=10, pady=3)
            self._nav_buttons[key] = btn

        # ── Footer sidebar ──────────────────────────────────
        footer = tk.Frame(sidebar, bg=BG_SIDEBAR, pady=12)
        footer.pack(fill="x", side="bottom")

        self.lbl_status = tk.Label(
            footer, text="⚫ Menghubungkan...",
            font=FONT_SM, bg=BG_SIDEBAR, fg=TEXT_DIM,
            wraplength=200
        )
        self.lbl_status.pack()

        self._check_connection()

        # ── Content Area ─────────────────────────────────────
        self.content = tk.Frame(self, bg=BG_DARK)
        self.content.pack(side="right", fill="both", expand=True)

        # Preload halaman
        page_classes = {
            "dashboard": HalamanDashboard,
            "mahasiswa": HalamanMahasiswa,
            "acara":     HalamanAcara,
            "presensi":  HalamanPresensi,
        }
        for key, cls in page_classes.items():
            page = cls(self.content)
            page.place(relx=0, rely=0, relwidth=1, relheight=1)
            self._pages[key] = page

    def _make_nav_btn(self, parent, icon, label, key):
        btn = tk.Button(
            parent,
            text=f"  {icon}  {label}",
            font=(FONT_FAMILY, 12),
            bg=BG_SIDEBAR, fg=TEXT,
            activebackground=ACCENT, activeforeground="white",
            relief="flat", anchor="w", padx=10, pady=10,
            cursor="hand2",
            command=lambda k=key: self._show_page(k)
        )

        def on_enter(e, b=btn):
            if self._active_page != key:
                b.config(bg=BG_CARD)

        def on_leave(e, b=btn):
            if self._active_page != key:
                b.config(bg=BG_SIDEBAR)

        btn.bind("<Enter>", on_enter)
        btn.bind("<Leave>", on_leave)
        return btn

    def _show_page(self, key):
        # Reset warna tombol lama
        if self._active_page and self._active_page in self._nav_buttons:
            prev_btn = self._nav_buttons[self._active_page]
            prev_btn.config(bg=BG_SIDEBAR, fg=TEXT)

        # Aktifkan halaman baru
        self._active_page = key
        btn = self._nav_buttons.get(key)
        if btn:
            btn.config(bg=ACCENT, fg="white")

        # Raise halaman ke depan
        self._pages[key].lift()

    # ─────────────────────────────────────────────────────────
    # CEK KONEKSI SERVER
    # ─────────────────────────────────────────────────────────
    def _check_connection(self):
        import requests, threading

        def check():
            try:
                resp = requests.get(f"{SERVER}/status.php", headers=get_headers(), timeout=4)
                if resp.status_code == 200:
                    self.after(0, lambda: self.lbl_status.config(
                        text="🟢 Server Terhubung", fg=SUCCESS
                    ))
                else:
                    self.after(0, lambda: self.lbl_status.config(
                        text=f"🔴 Server Error ({resp.status_code})", fg=DANGER
                    ))
            except Exception:
                self.after(0, lambda: self.lbl_status.config(
                    text="🔴 Server Tidak Ditemukan\nCek MAMP & URL di config.py",
                    fg=DANGER
                ))

        threading.Thread(target=check, daemon=True).start()
        # Re-check setiap 30 detik
        self.after(30000, self._check_connection)


if __name__ == "__main__":
    app = App()
    app.mainloop()
