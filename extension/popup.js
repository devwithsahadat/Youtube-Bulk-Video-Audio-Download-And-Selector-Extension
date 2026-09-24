// Popup script for Chrome extension

document.addEventListener('DOMContentLoaded', () => {
  const countBadge = document.getElementById('popup-count-badge');
  const selectedCount = document.getElementById('popup-selected-count');
  const copyBtn = document.getElementById('popup-copy-btn');
  const clearBtn = document.getElementById('popup-clear-btn');

  let currentVideos = [];

  function loadVideos() {
    chrome.storage.local.get(['yt_selected_videos'], (result) => {
      currentVideos = result.yt_selected_videos || [];
      const count = currentVideos.length;
      countBadge.textContent = count;
      selectedCount.textContent = count;
    });
  }

  loadVideos();

  copyBtn.addEventListener('click', () => {
    if (currentVideos.length === 0) {
      alert('No videos selected to copy!');
      return;
    }

    const links = currentVideos.map(v => v.url).join('\n');
    navigator.clipboard.writeText(links).then(() => {
      const originalText = copyBtn.innerHTML;
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = `<span>✓ Copied ${currentVideos.length} Links!</span>`;
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = originalText;
      }, 2000);
    }).catch(err => {
      console.error(err);
      alert('Failed to copy links to clipboard.');
    });
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all selected video links?')) {
      chrome.storage.local.set({ yt_selected_videos: [] }, () => {
        loadVideos();
      });
    }
  });
});
