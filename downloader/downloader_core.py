import os
import sys
import uuid
import time
import asyncio
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Callable, Any
import yt_dlp

class DownloadTask:
    def __init__(self, task_id: str, url: str, format_type: str, quality: str, output_folder: str, browser_cookies: str = "none", cookie_file: Optional[str] = None):
        self.id: str = task_id
        self.url: str = url
        self.format_type: str = format_type  # 'video' or 'audio'
        self.quality: str = quality          # 'best', '1080p', '720p', '480p', '320k', etc.
        self.output_folder: str = output_folder
        self.browser_cookies: str = browser_cookies  # 'none', 'chrome', 'edge', 'firefox', 'brave', 'opera'
        self.cookie_file: Optional[str] = cookie_file
        self.title: str = "Fetching info..."
        self.thumbnail: str = ""
        self.status: str = "queued"          # 'queued', 'downloading', 'processing', 'completed', 'error'
        self.progress: float = 0.0
        self.speed: str = "0 KB/s"
        self.eta: str = "--:--"
        self.downloaded_bytes: int = 0
        self.total_bytes: int = 0
        self.error_msg: Optional[str] = None
        self.file_path: Optional[str] = None
        self.created_at: float = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "url": self.url,
            "format_type": self.format_type,
            "quality": self.quality,
            "output_folder": self.output_folder,
            "browser_cookies": self.browser_cookies,
            "title": self.title,
            "thumbnail": self.thumbnail,
            "status": self.status,
            "progress": round(self.progress, 1),
            "speed": self.speed,
            "eta": self.eta,
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "error_msg": self.error_msg,
            "file_path": self.file_path
        }


class DownloadManager:
    def __init__(self, max_concurrent: int = 2):
        self.tasks: Dict[str, DownloadTask] = {}
        self.max_concurrent = max_concurrent
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent)
        self.notify_callbacks: List[Callable[[Dict[str, Any]], Any]] = []
        self._lock = threading.Lock()

    def register_callback(self, callback: Callable[[Dict[str, Any]], Any]):
        self.notify_callbacks.append(callback)

    def notify_update(self, task: DownloadTask):
        data = {"type": "task_update", "task": task.to_dict()}
        for cb in self.notify_callbacks:
            try:
                cb(data)
            except Exception:
                pass

    def get_all_tasks(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [task.to_dict() for task in self.tasks.values()]

    def add_batch(self, urls: List[str], format_type: str, quality: str, output_folder: str, browser_cookies: str = "none", cookie_file: Optional[str] = None) -> List[str]:
        task_ids = []
        os.makedirs(output_folder, exist_ok=True)

        for url in urls:
            url = url.strip()
            if not url or not (url.startswith("http://") or url.startswith("https://")):
                continue
            
            task_id = str(uuid.uuid4())[:8]
            task = DownloadTask(
                task_id=task_id,
                url=url,
                format_type=format_type,
                quality=quality,
                output_folder=output_folder,
                browser_cookies=browser_cookies,
                cookie_file=cookie_file
            )
            
            with self._lock:
                self.tasks[task_id] = task
            
            task_ids.append(task_id)
            self.notify_update(task)
            
            # Submit to thread pool
            self.executor.submit(self._download_worker, task)

        return task_ids

    def _progress_hook(self, d: Dict[str, Any], task: DownloadTask):
        status = d.get('status')
        if status == 'downloading':
            task.status = 'downloading'
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes') or 0
            task.downloaded_bytes = downloaded
            task.total_bytes = total
            
            if total > 0:
                task.progress = (downloaded / total) * 100
            else:
                task.progress = 0.0

            speed_val = d.get('speed')
            if speed_val:
                if speed_val > 1024 * 1024:
                    task.speed = f"{speed_val / (1024 * 1024):.1f} MB/s"
                else:
                    task.speed = f"{speed_val / 1024:.1f} KB/s"
            else:
                task.speed = "--"

            eta_val = d.get('eta')
            if eta_val is not None:
                mins, secs = divmod(int(eta_val), 60)
                task.eta = f"{mins:02d}:{secs:02d}"
            else:
                task.eta = "--:--"

            self.notify_update(task)

        elif status == 'finished':
            task.status = 'processing'
            task.progress = 100.0
            task.speed = "Finalizing..."
            task.eta = "00:00"
            self.notify_update(task)

    def _download_worker(self, task: DownloadTask):
        try:
            # Build yt-dlp options
            outtmpl = os.path.join(task.output_folder, '%(title)s [%(id)s].%(ext)s')
            
            ydl_opts: Dict[str, Any] = {
                'outtmpl': outtmpl,
                'progress_hooks': [lambda d: self._progress_hook(d, task)],
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'ignoreerrors': False,
                'retries': 5,
                # Mobile clients fallback to bypass bot check on RDP/datacenter IPs
                'extractor_args': {
                    'youtube': {
                        'player_client': ['android', 'ios', 'web'],
                        'player_skip': ['webpage', 'configs']
                    }
                },
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            }

            # Handle Cookies
            # 1. Custom cookies.txt file
            default_cookie_file = os.path.join(os.path.dirname(__file__), "cookies.txt")
            if task.cookie_file and os.path.exists(task.cookie_file):
                ydl_opts['cookiefile'] = task.cookie_file
            elif os.path.exists(default_cookie_file):
                ydl_opts['cookiefile'] = default_cookie_file
            # 2. Browser cookies
            elif task.browser_cookies and task.browser_cookies.lower() != "none":
                try:
                    ydl_opts['cookiesfrombrowser'] = (task.browser_cookies.lower(),)
                except Exception as ce:
                    print(f"Warning: Could not load cookies from browser '{task.browser_cookies}': {ce}")

            if task.format_type == 'audio':
                ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '320' if task.quality == '320k' else '192',
                    }],
                })
            else: # Video
                if task.quality == '1080p':
                    fmt = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'
                elif task.quality == '720p':
                    fmt = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best'
                elif task.quality == '480p':
                    fmt = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best'
                else: # 'best'
                    fmt = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best'

                ydl_opts.update({
                    'format': fmt,
                    'merge_output_format': 'mp4',
                })

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # First extract info to get title/thumbnail
                info = ydl.extract_info(task.url, download=False)
                if info:
                    task.title = info.get('title', task.title)
                    task.thumbnail = info.get('thumbnail', '')
                    self.notify_update(task)

                # Now perform the download
                task.status = 'downloading'
                self.notify_update(task)
                
                info_result = ydl.extract_info(task.url, download=True)
                
                task.status = 'completed'
                task.progress = 100.0
                task.speed = "Complete"
                task.eta = "Done"
                if info_result and '_filename' in info_result:
                    task.file_path = info_result['_filename']
                self.notify_update(task)

        except Exception as e:
            error_str = str(e)
            task.status = 'error'
            task.error_msg = error_str
            self.notify_update(task)
            print(f"Error downloading {task.url}: {error_str}", file=sys.stderr)

    def clear_finished(self):
        with self._lock:
            to_delete = [tid for tid, t in self.tasks.items() if t.status in ('completed', 'error')]
            for tid in to_delete:
                del self.tasks[tid]
