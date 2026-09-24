import os
import sys
import time
import socket
import webbrowser
import threading
import subprocess

def check_and_install_dependencies():
    required = ["yt_dlp", "fastapi", "uvicorn", "websockets", "requests"]
    missing = []
    for pkg in required:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    
    if missing:
        print(f"[*] Installing missing dependencies: {', '.join(missing)}...")
        req_path = os.path.join(os.path.dirname(__file__), "requirements.txt")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_path])
        print("[✓] All dependencies installed successfully!")

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def find_available_port(start_port: int = 8765) -> int:
    port = start_port
    while is_port_in_use(port):
        port += 1
    return port

def open_browser(url: str):
    time.sleep(1.2)
    print(f"[*] Opening browser at {url}")
    webbrowser.open(url)

if __name__ == "__main__":
    print("=" * 60)
    print("   YouTube Bulk Downloader Dashboard (yt-dlp Engine)   ")
    print("=" * 60)

    check_and_install_dependencies()

    import uvicorn
    from app import app

    port = find_available_port(8765)
    url = f"http://127.0.0.1:{port}"

    print(f"\n[🚀] Server starting at: {url}")
    print("[💡] Press Ctrl+C in this terminal to stop the server.\n")

    threading.Thread(target=open_browser, args=(url,), daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
