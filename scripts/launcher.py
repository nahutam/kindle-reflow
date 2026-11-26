"""
KindleFlow v2.4 — Standalone Windows Launcher
Runs an embedded, localhost-only HTTP server for the statically-exported Next.js application
and opens the default web browser. Provides a clean desktop controller for clean shutdown.
"""

import sys
import os
import threading
import webbrowser
import mimetypes
import tempfile
import json
import base64
import queue
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import ctypes

APP_TITLE = "KindleFlow v2.4"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 38281
PORT_FILE = os.path.join(tempfile.gettempdir(), "kindleflow_port.txt")
MUTEX_NAME = "Local\\KindleFlow_App_Mutex_v2"
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".kindleflow")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")


def get_default_output_dir():
    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    if os.path.isdir(downloads):
        return downloads
    docs = os.path.join(os.path.expanduser("~"), "Documents", "KindleFlow")
    os.makedirs(docs, exist_ok=True)
    return docs


def load_config():
    try:
        if os.path.isfile(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        log_debug(f"Error loading config: {e}")
    default_dir = get_default_output_dir()
    return {"outputDirectory": default_dir}


def save_config(cfg):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        log_debug(f"Error saving config: {e}")


def get_collision_safe_name(directory, filename):
    base, ext = os.path.splitext(filename)
    target = os.path.join(directory, filename)
    counter = 1
    while os.path.exists(target):
        target = os.path.join(directory, f"{base} ({counter}){ext}")
        counter += 1
    return target


def get_web_dir():
    """Locate the web assets directory (supports PyInstaller onefile / onedir and source)."""
    # PyInstaller temp directory
    if hasattr(sys, '_MEIPASS'):
        bundle_dir = os.path.join(sys._MEIPASS, 'web_dist')
        if os.path.isdir(bundle_dir):
            return bundle_dir

    # Next to executable
    exe_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    adjacent_dir = os.path.join(exe_dir, 'web_dist')
    if os.path.isdir(adjacent_dir):
        return adjacent_dir

    # Source development directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    source_out = os.path.abspath(os.path.join(script_dir, '..', 'out'))
    if os.path.isdir(source_out):
        return source_out

    return None


class KindleFlowHandler(SimpleHTTPRequestHandler):
    """Custom request handler with accurate MIME types and SPA routing fallback."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.web_directory, **kwargs)

    @classmethod
    def set_directory(cls, directory):
        cls.web_directory = directory

    def end_headers(self):
        # Strict local headers: no caching, local CORS
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/shutdown':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "ok", "message": "KindleFlow server stopping"}')
            if hasattr(self.server, 'shutdown_callback'):
                threading.Timer(0.15, self.server.shutdown_callback).start()
            return

        if self.path == '/api/browse-directory':
            current_cfg = load_config()
            initial_dir = current_cfg.get("outputDirectory", get_default_output_dir())
            selected_dir = None
            if hasattr(self.server, 'browse_callback'):
                selected_dir = self.server.browse_callback(initial_dir)
            else:
                try:
                    root_dlg = tk.Tk()
                    root_dlg.withdraw()
                    selected_dir = filedialog.askdirectory(title="Choose KindleFlow Output Directory", initialdir=initial_dir)
                    root_dlg.destroy()
                except Exception as e:
                    log_debug(f"Error in browse dialog fallback: {e}")

            if selected_dir and os.path.isdir(selected_dir):
                current_cfg["outputDirectory"] = selected_dir
                save_config(current_cfg)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "outputDirectory": selected_dir}).encode('utf-8'))
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "cancelled", "outputDirectory": initial_dir}).encode('utf-8'))
            return

        if self.path == '/api/save-file':
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len)
                data = json.loads(body.decode('utf-8'))
                file_name = data.get('fileName', 'kindle-output.pdf')
                base64_data = data.get('fileBase64', '')
                
                cfg = load_config()
                out_dir = cfg.get("outputDirectory", get_default_output_dir())
                if not os.path.isdir(out_dir):
                    os.makedirs(out_dir, exist_ok=True)

                if not os.access(out_dir, os.W_OK):
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "error": f"Output directory is not writable: {out_dir}"}).encode('utf-8'))
                    return

                target_path = get_collision_safe_name(out_dir, file_name)
                binary_content = base64.b64decode(base64_data)
                with open(target_path, 'wb') as f:
                    f.write(binary_content)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "ok",
                    "savedPath": target_path,
                    "fileName": os.path.basename(target_path),
                    "fileSize": len(binary_content)
                }).encode('utf-8'))
            except Exception as e:
                log_debug(f"Error in save-file: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "error": str(e)}).encode('utf-8'))
            return

        self.send_error(404, "Not Found")

    def guess_type(self, path):
        # Ensure correct JavaScript MIME types for Mozilla PDF.js workers (.mjs)
        path_str = str(path).lower()
        if path_str.endswith('.mjs') or path_str.endswith('.js'):
            return 'application/javascript'
        if path_str.endswith('.css'):
            return 'text/css'
        if path_str.endswith('.svg'):
            return 'image/svg+xml'
        if path_str.endswith('.pdf'):
            return 'application/pdf'
        if path_str.endswith('.png'):
            return 'image/png'
        if path_str.endswith('.jpg') or path_str.endswith('.jpeg'):
            return 'image/jpeg'
        if path_str.endswith('.html'):
            return 'text/html'
        if path_str.endswith('.json'):
            return 'application/json'
        return super().guess_type(path)

    def do_GET(self):
        clean_path = self.path.split('?')[0].split('#')[0]

        if clean_path == '/api/config':
            cfg = load_config()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            resp = json.dumps({
                "status": "ok",
                "outputDirectory": cfg.get("outputDirectory", get_default_output_dir()),
                "isNative": True
            }).encode('utf-8')
            self.wfile.write(resp)
            return

        # Check if requested file exists; if not and no extension, serve index.html (SPA routing)
        full_path = os.path.normpath(os.path.join(self.web_directory, clean_path.lstrip('/')))

        if not os.path.exists(full_path):
            # If not found and looks like a route (no file extension), serve index.html
            base_name = os.path.basename(clean_path)
            if '.' not in base_name:
                self.path = '/index.html'
        super().do_GET()

    def log_message(self, format, *args):
        # Suppress stdout/stderr logging in windowed (--noconsole) mode
        pass


def find_free_port(host, start_port):
    """Find a free port starting from start_port on host."""
    import socket
    for port in range(start_port, start_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free port available in range.")


def log_debug(msg):
    log_path = os.path.join(tempfile.gettempdir(), "kindleflow_debug.log")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{os.getpid()}] {msg}\n")


def is_already_running(host, port):
    """Check if another KindleFlow instance is actively listening on host:port."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.connect((host, port))
            return True
        except (ConnectionRefusedError, OSError):
            return False


def main():
    log_debug("Starting main()")
    # 1. Single-instance check via active socket probe
    if is_already_running(DEFAULT_HOST, DEFAULT_PORT):
        log_debug("Already running - opening browser and exiting")
        webbrowser.open(f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/")
        sys.exit(0)

    # 2. Locate web directory
    web_dir = get_web_dir()
    log_debug(f"Resolved web_dir: {web_dir}")
    if not web_dir or not os.path.isdir(web_dir):
        log_debug(f"Web dir does not exist: {web_dir}")
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "KindleFlow — Missing Assets",
            f"The application web assets could not be located.\nExpected path: {web_dir}\n"
            "Please run 'pnpm build' before launching."
        )
        sys.exit(1)

    # 3. Bind HTTP server
    port = find_free_port(DEFAULT_HOST, DEFAULT_PORT)
    log_debug(f"Binding HTTP server on port {port}")
    try:
        with open(PORT_FILE, 'w') as f:
            f.write(str(port))
    except Exception as e:
        log_debug(f"Error writing port file: {e}")

    KindleFlowHandler.set_directory(web_dir)
    server = ThreadingHTTPServer((DEFAULT_HOST, port), KindleFlowHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    log_debug("HTTP server thread started")

    url = f"http://{DEFAULT_HOST}:{port}/"

    # 4. Open browser automatically
    def open_browser():
        log_debug(f"Opening browser at {url}")
        webbrowser.open(url)

    threading.Timer(0.3, open_browser).start()

    log_debug("Starting Tkinter mainloop")
    # 5. Build Desktop Status Window
    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("400x260")
    root.resizable(False, False)
    root.configure(bg="#f8fafc")

    # Center window on screen
    root.update_idletasks()
    w = root.winfo_width()
    h = root.winfo_height()
    x = (root.winfo_screenwidth() // 2) - (w // 2)
    y = (root.winfo_screenheight() // 2) - (h // 2)
    root.geometry(f"{w}x{h}+{x}+{y}")

    # UI Content
    frame = tk.Frame(root, bg="#f8fafc", padx=20, pady=16)
    frame.pack(fill=tk.BOTH, expand=True)

    header_label = tk.Label(
        frame,
        text="KindleFlow v2.4",
        font=("Segoe UI", 13, "bold"),
        bg="#f8fafc",
        fg="#0f172a"
    )
    header_label.pack(anchor="w")

    subtitle_label = tk.Label(
        frame,
        text="Academic PDF Reflower for Amazon Kindle",
        font=("Segoe UI", 9),
        bg="#f8fafc",
        fg="#64748b"
    )
    subtitle_label.pack(anchor="w", pady=(1, 8))

    status_frame = tk.Frame(frame, bg="#ecfdf5", padx=10, pady=6, highlightbackground="#a7f3d0", highlightthickness=1)
    status_frame.pack(fill=tk.X, pady=(0, 10))

    status_label = tk.Label(
        status_frame,
        text=f"● Running locally on 127.0.0.1:{port}",
        font=("Segoe UI", 9, "bold"),
        bg="#ecfdf5",
        fg="#065f46"
    )
    status_label.pack(anchor="w")

    privacy_label = tk.Label(
        status_frame,
        text="100% offline & private. Safe to minimize this window.",
        font=("Segoe UI", 8),
        bg="#ecfdf5",
        fg="#047857"
    )
    privacy_label.pack(anchor="w")

    # Output Directory Frame
    out_dir_frame = tk.Frame(frame, bg="#f1f5f9", padx=8, pady=5, highlightbackground="#cbd5e1", highlightthickness=1)
    out_dir_frame.pack(fill=tk.X, pady=(0, 10))

    out_cfg = load_config()
    current_out_dir = out_cfg.get("outputDirectory", get_default_output_dir())
    out_dir_var = tk.StringVar(value=current_out_dir)

    out_title_label = tk.Label(
        out_dir_frame,
        text="Output Folder:",
        font=("Segoe UI", 8, "bold"),
        bg="#f1f5f9",
        fg="#475569"
    )
    out_title_label.pack(anchor="w")

    out_row = tk.Frame(out_dir_frame, bg="#f1f5f9")
    out_row.pack(fill=tk.X, pady=(1, 0))

    out_path_label = tk.Label(
        out_row,
        textvariable=out_dir_var,
        font=("Segoe UI", 8),
        bg="#f1f5f9",
        fg="#1e293b",
        anchor="w",
        wraplength=270,
        justify=tk.LEFT
    )
    out_path_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

    def choose_folder():
        initial = out_dir_var.get()
        chosen = filedialog.askdirectory(parent=root, title="Choose KindleFlow Output Directory", initialdir=initial)
        if chosen and os.path.isdir(chosen):
            out_dir_var.set(chosen)
            cfg = load_config()
            cfg["outputDirectory"] = chosen
            save_config(cfg)

    change_btn = tk.Button(
        out_row,
        text="Change...",
        command=choose_folder,
        bg="#e2e8f0",
        fg="#334155",
        font=("Segoe UI", 8),
        relief=tk.FLAT,
        padx=6,
        pady=2,
        cursor="hand2"
    )
    change_btn.pack(side=tk.RIGHT)

    # Thread-safe queue for browser-initiated directory picker
    browse_queue = queue.Queue()
    browse_result = queue.Queue()

    def check_browse_queue():
        try:
            while not browse_queue.empty():
                init_dir = browse_queue.get_nowait()
                root.attributes("-topmost", True)
                chosen = filedialog.askdirectory(parent=root, title="Choose KindleFlow Output Directory", initialdir=init_dir)
                root.attributes("-topmost", False)
                if chosen and os.path.isdir(chosen):
                    out_dir_var.set(chosen)
                browse_result.put(chosen)
        except Exception as e:
            log_debug(f"Error in check_browse_queue: {e}")
            browse_result.put(None)
        root.after(100, check_browse_queue)

    root.after(100, check_browse_queue)

    def handle_browse_request(init_dir):
        browse_queue.put(init_dir)
        try:
            return browse_result.get(timeout=60)
        except Exception:
            return None

    server.browse_callback = handle_browse_request

    btn_frame = tk.Frame(frame, bg="#f8fafc")
    btn_frame.pack(fill=tk.X, pady=(2, 0))

    def on_open_click():
        open_browser()

    def on_close():
        log_debug("on_close triggered — cleaning up and exiting")
        try:
            if os.path.isfile(PORT_FILE):
                os.remove(PORT_FILE)
        except Exception:
            pass

        def shutdown_http():
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                pass

        threading.Thread(target=shutdown_http, daemon=True).start()
        try:
            root.destroy()
        except Exception:
            pass
        sys.exit(0)

    def trigger_shutdown():
        log_debug("Shutdown triggered via HTTP API /api/shutdown")
        root.after(50, on_close)

    server.shutdown_callback = trigger_shutdown

    btn_open = tk.Button(
        btn_frame,
        text="Open in Browser",
        command=on_open_click,
        bg="#0284c7",
        fg="#ffffff",
        font=("Segoe UI", 9, "bold"),
        relief=tk.FLAT,
        padx=12,
        pady=5,
        cursor="hand2"
    )
    btn_open.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

    btn_stop = tk.Button(
        btn_frame,
        text="Stop & Exit",
        command=on_close,
        bg="#e2e8f0",
        fg="#334155",
        font=("Segoe UI", 9),
        relief=tk.FLAT,
        padx=12,
        pady=5,
        cursor="hand2"
    )
    btn_stop.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(6, 0))

    root.protocol("WM_DELETE_WINDOW", on_close)

    root.mainloop()


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        log_path = os.path.join(tempfile.gettempdir(), "kindleflow_error.log")
        with open(log_path, "w") as f:
            traceback.print_exc(file=f)
        try:
            import tkinter.messagebox as mb
            mb.showerror("KindleFlow Error", f"Fatal Error:\n{e}\n\nSee {log_path}")
        except Exception:
            pass
        sys.exit(1)
