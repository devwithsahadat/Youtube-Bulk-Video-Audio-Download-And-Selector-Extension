// YouTube Bulk Downloader - Client Logic

let socket = null;
let currentTasks = new Map();
let currentFormat = 'video'; // 'video' or 'audio'
let currentFolder = '';

// DOM Elements
const urlInput = document.getElementById('url-input');
const linkCountBadge = document.getElementById('link-count-badge');
const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
const formatButtons = document.querySelectorAll('#format-toggle .toggle-btn');
const qualitySelect = document.getElementById('quality-select');
const folderPathInput = document.getElementById('folder-path-input');
const btnBrowseFolder = document.getElementById('btn-browse-folder');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnStartDownload = document.getElementById('btn-start-download');
const btnClearCompleted = document.getElementById('btn-clear-completed');
const tasksContainer = document.getElementById('tasks-container');

// Stats Elements
const statTotal = document.getElementById('stat-total');
const statActive = document.getElementById('stat-active');
const statCompleted = document.getElementById('stat-completed');
const statFailed = document.getElementById('stat-failed');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  loadDefaultFolder();
  setupEventListeners();
  updateLinkCount();
});

// Setup Listeners
function setupEventListeners() {
  // Input changes
  urlInput.addEventListener('input', updateLinkCount);

  // Paste from clipboard
  btnPasteClipboard.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (urlInput.value.trim().length > 0) {
          urlInput.value = urlInput.value.trim() + '\n' + text.trim();
        } else {
          urlInput.value = text.trim();
        }
        updateLinkCount();
      }
    } catch (e) {
      alert('Could not access clipboard. Please paste manually into the box.');
    }
  });

  // Format toggle
  formatButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      formatButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFormat = btn.dataset.format;
      updateQualityOptions();
    });
  });

  // Browse folder
  btnBrowseFolder.addEventListener('click', async () => {
    btnBrowseFolder.disabled = true;
    btnBrowseFolder.innerText = 'Opening...';
    try {
      const res = await fetch('/api/browse-folder', { method: 'POST' });
      const data = await res.json();
      if (data.folder) {
        currentFolder = data.folder;
        folderPathInput.value = currentFolder;
      }
    } catch (e) {
      console.error(e);
    } finally {
      btnBrowseFolder.disabled = false;
      btnBrowseFolder.innerHTML = '<span>📁 Browse</span>';
    }
  });

  // Open folder
  btnOpenFolder.addEventListener('click', async () => {
    try {
      await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: currentFolder })
      });
    } catch (e) {
      console.error(e);
    }
  });

  // Start Download
  btnStartDownload.addEventListener('click', startDownload);

  // Clear completed
  btnClearCompleted.addEventListener('click', async () => {
    try {
      await fetch('/api/clear-completed', { method: 'POST' });
      // Remove completed from map
      for (const [id, task] of currentTasks.entries()) {
        if (task.status === 'completed' || task.status === 'error') {
          currentTasks.delete(id);
        }
      }
      renderTasks();
      updateStats();
    } catch (e) {
      console.error(e);
    }
  });
}

function updateQualityOptions() {
  qualitySelect.innerHTML = '';
  if (currentFormat === 'video') {
    qualitySelect.innerHTML = `
      <option value="best">Best Available Quality (1080p/4K MP4)</option>
      <option value="1080p">1080p Full HD MP4</option>
      <option value="720p">720p HD MP4</option>
      <option value="480p">480p SD MP4</option>
    `;
  } else {
    qualitySelect.innerHTML = `
      <option value="320k">High Quality MP3 (320 kbps)</option>
      <option value="192k">Standard Quality MP3 (192 kbps)</option>
    `;
  }
}

async function loadDefaultFolder() {
  try {
    const res = await fetch('/api/default-folder');
    const data = await res.json();
    if (data.folder) {
      currentFolder = data.folder;
      folderPathInput.value = currentFolder;
    }
  } catch (e) {
    console.error('Failed to load default folder:', e);
  }
}

function parseUrls() {
  const lines = urlInput.value.split('\n');
  const valid = lines
    .map(l => l.trim())
    .filter(l => l.startsWith('http://') || l.startsWith('https://'));
  return valid;
}

function updateLinkCount() {
  const urls = parseUrls();
  linkCountBadge.textContent = `${urls.length} Links`;
}

async function startDownload() {
  const urls = parseUrls();
  if (urls.length === 0) {
    alert('Please paste at least one valid YouTube link into the box.');
    return;
  }

  btnStartDownload.disabled = true;
  btnStartDownload.innerHTML = '<span>Starting Downloads...</span>';

  try {
    const res = await fetch('/api/start-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: urls,
        format_type: currentFormat,
        quality: qualitySelect.value,
        output_folder: currentFolder
      })
    });

    const data = await res.json();
    if (res.ok) {
      urlInput.value = '';
      updateLinkCount();
    } else {
      alert('Download request failed: ' + (data.detail || 'Unknown error'));
    }
  } catch (e) {
    console.error(e);
    alert('Failed to connect to backend server.');
  } finally {
    btnStartDownload.disabled = false;
    btnStartDownload.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
      <span>Start Bulk Download</span>
    `;
  }
}

// WebSocket Setup
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    statusDot.className = 'status-dot online';
    statusText.textContent = 'Connected';
  };

  socket.onclose = () => {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Disconnected (Reconnecting...)';
    setTimeout(initWebSocket, 2000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'init') {
        currentTasks.clear();
        (data.tasks || []).forEach(t => currentTasks.set(t.id, t));
        renderTasks();
        updateStats();
      } else if (data.type === 'task_update') {
        const task = data.task;
        currentTasks.set(task.id, task);
        updateOrRenderSingleTask(task);
        updateStats();
      }
    } catch (e) {
      console.error('WS Parse Error:', e);
    }
  };
}

function updateStats() {
  const tasks = Array.from(currentTasks.values());
  statTotal.textContent = tasks.length;
  statActive.textContent = tasks.filter(t => t.status === 'downloading' || t.status === 'processing' || t.status === 'queued').length;
  statCompleted.textContent = tasks.filter(t => t.status === 'completed').length;
  statFailed.textContent = tasks.filter(t => t.status === 'error').length;
}

function getStatusBadge(status) {
  switch (status) {
    case 'queued':
      return `<span class="task-badge badge-queued">Queued</span>`;
    case 'downloading':
      return `<span class="task-badge badge-downloading">Downloading</span>`;
    case 'processing':
      return `<span class="task-badge badge-processing">Converting</span>`;
    case 'completed':
      return `<span class="task-badge badge-completed">Completed</span>`;
    case 'error':
      return `<span class="task-badge badge-error">Failed</span>`;
    default:
      return `<span class="task-badge badge-queued">${status}</span>`;
  }
}

function renderTasks() {
  if (currentTasks.size === 0) {
    tasksContainer.innerHTML = `
      <div class="empty-tasks-state">
        <div class="empty-icon">📥</div>
        <h3>No Downloads in Progress</h3>
        <p>Paste your YouTube video links above and click "Start Bulk Download" to begin downloading.</p>
      </div>
    `;
    return;
  }

  tasksContainer.innerHTML = '';
  // Show newest tasks first
  const list = Array.from(currentTasks.values()).reverse();
  list.forEach(task => {
    tasksContainer.appendChild(createTaskElement(task));
  });
}

function createTaskElement(task) {
  const el = document.createElement('div');
  el.className = 'task-item';
  el.id = `task-${task.id}`;

  const thumbUrl = task.thumbnail || 'https://via.placeholder.com/120x68/1a1a22/94a3b8?text=YouTube';
  const isComplete = task.status === 'completed';

  el.innerHTML = `
    <img class="task-thumb" src="${thumbUrl}" alt="Thumbnail">
    <div class="task-details">
      <div class="task-top-row">
        <span class="task-title" title="${task.title}">${task.title}</span>
        <div class="task-status-box">${getStatusBadge(task.status)}</div>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill ${isComplete ? 'completed' : ''}" style="width: ${task.progress}%;"></div>
      </div>
      <div class="task-meta-row">
        <span class="meta-progress">${task.progress}%</span>
        <span class="meta-speed">${task.speed || ''}</span>
        <span class="meta-eta">${task.status === 'downloading' ? 'ETA: ' + task.eta : (task.error_msg ? task.error_msg : '')}</span>
      </div>
    </div>
  `;

  return el;
}

function updateOrRenderSingleTask(task) {
  let el = document.getElementById(`task-${task.id}`);
  if (!el) {
    renderTasks();
    return;
  }

  const thumb = el.querySelector('.task-thumb');
  if (task.thumbnail && thumb.src !== task.thumbnail) {
    thumb.src = task.thumbnail;
  }

  const title = el.querySelector('.task-title');
  if (title && title.textContent !== task.title) {
    title.textContent = task.title;
    title.title = task.title;
  }

  const statusBox = el.querySelector('.task-status-box');
  if (statusBox) {
    statusBox.innerHTML = getStatusBadge(task.status);
  }

  const progressFill = el.querySelector('.progress-bar-fill');
  if (progressFill) {
    progressFill.style.width = `${task.progress}%`;
    if (task.status === 'completed') {
      progressFill.classList.add('completed');
    }
  }

  const metaProgress = el.querySelector('.meta-progress');
  if (metaProgress) metaProgress.textContent = `${task.progress}%`;

  const metaSpeed = el.querySelector('.meta-speed');
  if (metaSpeed) metaSpeed.textContent = task.speed || '';

  const metaEta = el.querySelector('.meta-eta');
  if (metaEta) {
    if (task.status === 'downloading') {
      metaEta.textContent = `ETA: ${task.eta}`;
    } else if (task.status === 'error') {
      metaEta.textContent = task.error_msg || 'Error';
    } else if (task.status === 'completed') {
      metaEta.textContent = 'Saved to disk';
    } else {
      metaEta.textContent = '';
    }
  }
}
