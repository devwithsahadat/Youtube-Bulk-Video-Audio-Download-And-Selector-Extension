// YouTube Bulk Selector - Universal Content Script (Supports 100% of YouTube Pages)

(function () {
  'use strict';

  // State: Map of videoId -> { id, title, url, thumb }
  let selectedVideos = new Map();
  let sidebarOpen = false;

  // Load saved videos from chrome.storage
  function loadSavedVideos() {
    chrome.storage.local.get(['yt_selected_videos'], (result) => {
      if (result && Array.isArray(result.yt_selected_videos)) {
        selectedVideos.clear();
        result.yt_selected_videos.forEach((item) => {
          if (item && item.id) selectedVideos.set(item.id, item);
        });
        updateAllCheckboxes();
        updateUI();
      }
    });
  }

  // Save videos to chrome.storage
  function saveVideos() {
    const list = Array.from(selectedVideos.values());
    chrome.storage.local.set({ yt_selected_videos: list }, () => {
      updateUI();
    });
  }

  // Clean YouTube URL to canonical format (https://www.youtube.com/watch?v=ID)
  function cleanVideoUrl(rawHref) {
    if (!rawHref) return null;
    try {
      const url = new URL(rawHref, window.location.origin);
      let videoId = url.searchParams.get('v');
      if (!videoId && url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/shorts/')[1].split('/')[0];
      }
      if (videoId && videoId.length >= 8) {
        return {
          id: videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`
        };
      }
    } catch (e) {
      // Ignored
    }
    return null;
  }

  // Create UI Elements: Floating Button & Sidebar Panel
  function injectUIElements() {
    if (document.getElementById('yt-bulk-floating-btn')) return;

    // Floating Button at Bottom Right
    const floatBtn = document.createElement('button');
    floatBtn.id = 'yt-bulk-floating-btn';
    floatBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span>Selected Videos</span>
      <span class="badge-count" id="yt-bulk-badge">0</span>
    `;
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
    document.body.appendChild(floatBtn);

    // Slide-out Sidebar Panel
    const sidebar = document.createElement('div');
    sidebar.id = 'yt-bulk-sidebar-panel';
    sidebar.innerHTML = `
      <div class="yt-bulk-header">
        <div class="yt-bulk-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#ff0033">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <span>Selected Videos (<span id="yt-bulk-header-count">0</span>)</span>
        </div>
        <button class="yt-bulk-close-btn" id="yt-bulk-close-btn">&times;</button>
      </div>

      <div class="yt-bulk-actions">
        <button class="yt-bulk-btn-sm" id="yt-bulk-select-all-btn">✓ Select All Visible</button>
        <button class="yt-bulk-btn-sm" id="yt-bulk-clear-btn">✕ Clear All</button>
      </div>

      <div class="yt-bulk-list" id="yt-bulk-list-container">
        <div class="yt-bulk-empty-state">No videos selected yet.<br>Click the checkboxes on the right side of YouTube videos to select them.</div>
      </div>

      <div class="yt-bulk-footer">
        <button class="yt-bulk-copy-btn" id="yt-bulk-copy-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          <span>Copy All Links</span>
        </button>
      </div>
    `;
    document.body.appendChild(sidebar);

    // Event listeners for Sidebar
    document.getElementById('yt-bulk-close-btn').onclick = toggleSidebar;
    document.getElementById('yt-bulk-clear-btn').onclick = clearAllSelections;
    document.getElementById('yt-bulk-select-all-btn').onclick = selectAllVisibleVideos;
    document.getElementById('yt-bulk-copy-btn').onclick = copyAllLinks;
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    const sidebar = document.getElementById('yt-bulk-sidebar-panel');
    if (sidebar) {
      sidebar.classList.toggle('open', sidebarOpen);
    }
  }

  function showToast(message) {
    const existing = document.querySelector('.yt-bulk-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'yt-bulk-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3000);
  }

  function updateUI() {
    const count = selectedVideos.size;
    const badge = document.getElementById('yt-bulk-badge');
    const headerCount = document.getElementById('yt-bulk-header-count');
    const listContainer = document.getElementById('yt-bulk-list-container');

    if (badge) badge.textContent = count;
    if (headerCount) headerCount.textContent = count;

    if (listContainer) {
      if (count === 0) {
        listContainer.innerHTML = `<div class="yt-bulk-empty-state">No videos selected yet.<br>Click the checkboxes on the right side of YouTube videos to select them.</div>`;
      } else {
        listContainer.innerHTML = '';
        selectedVideos.forEach((video) => {
          const item = document.createElement('div');
          item.className = 'yt-bulk-item';
          item.innerHTML = `
            <img class="yt-bulk-item-thumb" src="${video.thumb || 'https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'}" alt="thumb">
            <div class="yt-bulk-item-info">
              <div class="yt-bulk-item-title" title="${video.title}">${video.title || 'YouTube Video'}</div>
              <a class="yt-bulk-item-link" href="${video.url}" target="_blank">${video.url}</a>
            </div>
            <button class="yt-bulk-item-delete" title="Remove" data-id="${video.id}">✕</button>
          `;

          item.querySelector('.yt-bulk-item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            const vidId = e.currentTarget.getAttribute('data-id');
            selectedVideos.delete(vidId);
            saveVideos();
            updateCheckboxForId(vidId, false);
          });

          listContainer.appendChild(item);
        });
      }
    }
  }

  function copyAllLinks() {
    if (selectedVideos.size === 0) {
      showToast('⚠️ No videos selected to copy!');
      return;
    }

    const links = Array.from(selectedVideos.values()).map(v => v.url).join('\n');
    navigator.clipboard.writeText(links).then(() => {
      const copyBtn = document.getElementById('yt-bulk-copy-btn');
      const originalHtml = copyBtn.innerHTML;
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = `<span>✓ Copied ${selectedVideos.size} Links!</span>`;
      showToast(`🎉 Successfully copied ${selectedVideos.size} video links to clipboard!`);
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = originalHtml;
      }, 2500);
    }).catch(err => {
      console.error('Failed to copy links:', err);
      showToast('❌ Failed to copy to clipboard.');
    });
  }

  function clearAllSelections() {
    selectedVideos.clear();
    saveVideos();
    updateAllCheckboxes();
    showToast('🗑️ Cleared all selections');
  }

  function selectAllVisibleVideos() {
    const boxes = document.querySelectorAll('.yt-bulk-checkbox-container');
    let added = 0;

    boxes.forEach(box => {
      const vidId = box.getAttribute('data-video-id');
      const vidUrl = box.getAttribute('data-video-url');
      const vidTitle = box.getAttribute('data-video-title');
      const vidThumb = box.getAttribute('data-video-thumb');

      if (vidId && vidUrl && !selectedVideos.has(vidId)) {
        selectedVideos.set(vidId, {
          id: vidId,
          url: vidUrl,
          title: vidTitle || 'YouTube Video',
          thumb: vidThumb || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`
        });
        added++;
      }
    });

    saveVideos();
    updateAllCheckboxes();
    showToast(`✓ Selected ${added} visible videos (Total: ${selectedVideos.size})`);
  }

  function updateCheckboxForId(videoId, isChecked) {
    const boxes = document.querySelectorAll(`.yt-bulk-checkbox-container[data-video-id="${videoId}"]`);
    boxes.forEach(box => {
      box.classList.toggle('selected', isChecked);
    });
  }

  function updateAllCheckboxes() {
    const boxes = document.querySelectorAll('.yt-bulk-checkbox-container');
    boxes.forEach(box => {
      const videoId = box.getAttribute('data-video-id');
      const isSelected = selectedVideos.has(videoId);
      box.classList.toggle('selected', isSelected);
    });
  }

  // Toggle Video Selection Handler
  function handleBoxClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const box = e.currentTarget;
    const vidId = box.getAttribute('data-video-id');
    const vidUrl = box.getAttribute('data-video-url');
    const vidTitle = box.getAttribute('data-video-title') || 'YouTube Video';
    const vidThumb = box.getAttribute('data-video-thumb') || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`;

    if (!vidId || !vidUrl) return;

    const isCurrentlySelected = selectedVideos.has(vidId);
    const willSelect = !isCurrentlySelected;

    if (willSelect) {
      selectedVideos.set(vidId, {
        id: vidId,
        url: vidUrl,
        title: vidTitle,
        thumb: vidThumb
      });
    } else {
      selectedVideos.delete(vidId);
    }

    updateCheckboxForId(vidId, willSelect);
    saveVideos();
  }

  // Universal Video Element Processor
  function processVideoElement(anchor) {
    const parsed = cleanVideoUrl(anchor.href || anchor.getAttribute('href'));
    if (!parsed) return;

    // Find the enclosing card or item container
    const card = anchor.closest(`
      ytd-compact-video-renderer,
      ytd-playlist-panel-video-renderer,
      ytd-video-renderer,
      ytd-rich-item-renderer,
      ytd-grid-video-renderer,
      ytd-playlist-video-renderer,
      ytd-reel-item-renderer,
      yt-lockup-view-model,
      .yt-lockup-view-model,
      ytd-compact-radio-renderer,
      ytd-compact-playlist-renderer,
      ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer,
      #dismissible
    `) || anchor.parentElement;

    if (!card) return;

    // Avoid duplicate injection in the same card
    if (card.querySelector('.yt-bulk-checkbox-container')) return;

    // Mark parent container relative for positioning
    const computed = window.getComputedStyle(card);
    if (computed.position === 'static') {
      card.style.position = 'relative';
    }

    // Extract Title
    const titleEl = card.querySelector('#video-title, span#video-title, #video-title-link, h3, [title], a.title') || anchor;
    let title = titleEl.getAttribute('title') || titleEl.textContent || 'YouTube Video';
    title = title.trim();

    // Extract Thumbnail
    const thumbEl = card.querySelector('img[src*="ytimg"], img[src*="ggpht"], img');
    const thumb = thumbEl ? thumbEl.src : `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`;

    // Create checkbox badge
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'yt-bulk-checkbox-container';
    checkboxWrapper.setAttribute('data-video-id', parsed.id);
    checkboxWrapper.setAttribute('data-video-url', parsed.url);
    checkboxWrapper.setAttribute('data-video-title', title);
    checkboxWrapper.setAttribute('data-video-thumb', thumb);
    checkboxWrapper.title = 'Click to Select/Deselect Video';

    const isSelected = selectedVideos.has(parsed.id);
    if (isSelected) {
      checkboxWrapper.classList.add('selected');
    }

    // Checkmark SVG icon
    checkboxWrapper.innerHTML = `
      <svg class="yt-bulk-check-icon" viewBox="0 0 24 24">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `;

    // Listeners
    checkboxWrapper.addEventListener('click', handleBoxClick, true);
    checkboxWrapper.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);

    card.appendChild(checkboxWrapper);
  }

  // Scan and inject checkboxes into ALL video links across ALL YouTube pages
  function scanAndInject() {
    // Universal query for all video links (covers watch sidebar, related, home, search, channels, shorts shelves)
    const videoAnchors = document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]');
    videoAnchors.forEach(processVideoElement);
  }

  // Initialize
  function init() {
    injectUIElements();
    loadSavedVideos();
    scanAndInject();

    // YouTube dynamic SPA observer
    const observer = new MutationObserver(() => {
      scanAndInject();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // YouTube navigation events
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(scanAndInject, 200);
      setTimeout(scanAndInject, 800);
      setTimeout(scanAndInject, 2000);
    });

    // Periodic check for lazy loaded dynamic items
    setInterval(scanAndInject, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
