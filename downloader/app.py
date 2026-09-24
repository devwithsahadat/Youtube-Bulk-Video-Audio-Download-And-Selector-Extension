import os
import sys
import asyncio
import threading
import subprocess
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from downloader_core import DownloadManager

app = FastAPI(title="YouTube Bulk Downloader API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Manager instance
manager = DownloadManager(max_concurrent=3)

# Default download folder
DEFAULT_DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "YouTube_Downloads")
os.makedirs(DEFAULT_DOWNLOAD_DIR, exist_ok=True)

# Connected WebSocket clients
active_websockets: List[WebSocket] = []
ws_loop: Optional[asyncio.AbstractEventLoop] = None

def broadcast_sync(data: dict):
    """Callback triggered from download threads to notify websockets"""
    if ws_loop and active_websockets:
        asyncio.run_coroutine_threadsafe(_broadcast_async(data), ws_loop)

async def _broadcast_async(data: dict):
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_json(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in active_websockets:
            active_websockets.remove(ws)

manager.register_callback(broadcast_sync)


class DownloadRequest(BaseModel):
    urls: List[str]
    format_type: str = "video"       # 'video' or 'audio'
    quality: str = "best"            # 'best', '1080p', '720p', '480p', '320k'
    output_folder: Optional[str] = None


class OpenFolderRequest(BaseModel):
    folder_path: str


@app.get("/api/default-folder")
def get_default_folder():
    return {"folder": DEFAULT_DOWNLOAD_DIR}


@app.post("/api/browse-folder")
def browse_folder():
    """Opens a native Windows folder selection dialog"""
    selected_path = [""]

    def _open_dialog():
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            folder = filedialog.askdirectory(
                title="Select Download Folder for YouTube Videos",
                initialdir=DEFAULT_DOWNLOAD_DIR
            )
            root.destroy()
            if folder:
                selected_path[0] = os.path.normpath(folder)
        except Exception as e:
            print("Folder dialog error:", e)

    t = threading.Thread(target=_open_dialog)
    t.start()
    t.join(timeout=30)

    if selected_path[0]:
        return {"folder": selected_path[0]}
    return {"folder": None, "message": "No folder selected"}


@app.post("/api/open-folder")
def open_folder(req: OpenFolderRequest):
    """Opens the directory in Windows Explorer"""
    path = req.folder_path or DEFAULT_DOWNLOAD_DIR
    if os.path.exists(path):
        try:
            if sys.platform == 'win32':
                os.startfile(path)
            else:
                subprocess.Popen(['xdg-open', path])
            return {"status": "success"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        raise HTTPException(status_code=404, detail="Directory does not exist")


@app.get("/api/tasks")
def get_tasks():
    return {"tasks": manager.get_all_tasks()}


@app.post("/api/start-download")
def start_download(req: DownloadRequest):
    folder = req.output_folder or DEFAULT_DOWNLOAD_DIR
    if not req.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")

    task_ids = manager.add_batch(
        urls=req.urls,
        format_type=req.format_type,
        quality=req.quality,
        output_folder=folder
    )
    return {"status": "started", "count": len(task_ids), "task_ids": task_ids}


@app.post("/api/clear-completed")
def clear_completed():
    manager.clear_finished()
    return {"status": "cleared"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global ws_loop
    ws_loop = asyncio.get_event_loop()
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        # Send initial state
        await websocket.send_json({"type": "init", "tasks": manager.get_all_tasks()})
        while True:
            # Keep alive / receive client pings
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_websockets:
            active_websockets.remove(websocket)


# Mount static web directory
web_dir = Path(__file__).parent / "web"
web_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")

@app.get("/")
def serve_index():
    index_file = web_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Web UI is building..."}
