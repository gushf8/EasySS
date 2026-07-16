// popup.js
let detectedVideoUrl = null;
let activeTabId = null;

// Initialize Popup
document.addEventListener('DOMContentLoaded', async () => {
  await checkActivation();
  
  // Input and Actions Event Listeners
  document.getElementById('activateBtn').addEventListener('click', handleActivation);
  document.getElementById('activationPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleActivation();
  });

  document.getElementById('downloadBtn').addEventListener('click', handleManualDownload);
  document.getElementById('videoUrlInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleManualDownload();
  });

  document.getElementById('quickDownloadBtn').addEventListener('click', handleQuickDownload);

  // Check current page for videos
  detectPageVideo();

  // Load download history
  loadVideoHistory();
});

// Toast Utility
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector('span').innerText = message;
  toast.classList.remove('error');
  if (type === 'error') toast.classList.add('error');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Activation Checking
async function checkActivation() {
  return new Promise((resolve) => {
    chrome.storage.local.get('isActivated', (result) => {
      if (!result.isActivated) {
        document.getElementById('activationOverlay').style.display = 'flex';
        setTimeout(() => {
          const pwdInput = document.getElementById('activationPassword');
          if (pwdInput) pwdInput.focus();
        }, 120);
      } else {
        // Force focus on main manual URL input if already activated
        setTimeout(() => {
          const urlInput = document.getElementById('videoUrlInput');
          if (urlInput) urlInput.focus();
        }, 100);
      }
      resolve();
    });
  });
}

function handleActivation() {
  const password = document.getElementById('activationPassword').value;
  const error = document.getElementById('activationError');
  
  if (password === 'meloso824') {
    chrome.storage.local.set({ isActivated: true }, () => {
      document.getElementById('activationOverlay').style.display = 'none';
      showToast("¡EasySS Activado!");
      setTimeout(() => {
        const urlInput = document.getElementById('videoUrlInput');
        if (urlInput) urlInput.focus();
      }, 100);
    });
  } else {
    error.style.display = 'block';
    document.getElementById('activationPassword').style.borderColor = 'var(--danger)';
    setTimeout(() => {
      document.getElementById('activationPassword').style.borderColor = 'var(--border-color)';
    }, 1000);
  }
}

// Auto Detect Tab Video
function detectPageVideo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      activeTabId = tabs[0].id;
      const url = tabs[0].url;
      
      const isYouTube = url.includes('youtube.com/watch') || url.includes('youtu.be/');
      const isInstagram = url.includes('instagram.com/p/') || url.includes('instagram.com/reel/') || url.includes('instagram.com/reels/') || url.includes('instagram.com/tv/');
      const isFacebook = url.includes('facebook.com/') || url.includes('fb.watch/') || url.includes('facebook.com/watch/');

      if (isYouTube || isInstagram || isFacebook) {
        detectedVideoUrl = url;
        document.getElementById('detectedUrlText').innerText = url;
        document.getElementById('autoDetectCard').style.display = 'flex';
      }
    }
  });
}

// Manual Download Submission
function handleManualDownload() {
  const url = document.getElementById('videoUrlInput').value.trim();
  if (!url) {
    showToast("Por favor, introduce un enlace de video", "error");
    return;
  }
  executeVideoDownload(url);
}

// Quick Auto-detected Download
function handleQuickDownload() {
  if (detectedVideoUrl) {
    executeVideoDownload(detectedVideoUrl);
  }
}

// Downloader execution
function executeVideoDownload(url) {
  const statusBox = document.getElementById('statusBox');
  const statusText = document.getElementById('statusText');
  const downloadBtn = document.getElementById('downloadBtn');
  const quickDownloadBtn = document.getElementById('quickDownloadBtn');
  const inputEl = document.getElementById('videoUrlInput');

  // Disable controls and show status spinner
  statusBox.style.display = 'flex';
  statusText.innerText = "Procesando descarga de video...";
  downloadBtn.disabled = true;
  quickDownloadBtn.disabled = true;
  inputEl.disabled = true;

  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_VIDEO_URL',
    url: url,
    tabId: activeTabId
  }, (response) => {
    // Re-enable controls
    downloadBtn.disabled = false;
    quickDownloadBtn.disabled = false;
    inputEl.disabled = false;
    statusBox.style.display = 'none';

    if (response && response.success) {
      if (response.openedTab) {
        showToast("Abriendo herramienta de descarga...");
        setTimeout(() => window.close(), 1500);
      } else {
        showToast("Descarga de video iniciada");
        document.getElementById('videoUrlInput').value = '';
        // Reload video downloads list after a short delay
        setTimeout(loadVideoHistory, 1500);
      }
    } else {
      const errMsg = (response && response.error) ? response.error : "Error al descargar el video.";
      showToast(errMsg, "error");
    }
  });
}

// Load Video History
function loadVideoHistory() {
  chrome.runtime.sendMessage({ type: 'GET_RECENT_VIDEOS' }, (videos) => {
    const grid = document.getElementById('videosGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!videos || videos.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <p>No hay videos descargados recientemente</p>
        </div>`;
      return;
    }

    // Render videos list
    videos.forEach((video) => {
      const date = new Date(video.timestamp);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const item = document.createElement('div');
      item.className = 'video-item';
      item.dataset.id = video.id;

      item.innerHTML = `
        <div class="video-icon-wrapper">
          <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 00-2 2z"></path></svg>
        </div>
        <div class="video-info">
          <div class="video-name" title="${video.filename}">${video.filename}</div>
          <div class="video-meta">${dateStr}</div>
        </div>
        <div class="video-actions">
          <button class="action-icon-btn locate" title="Abrir ubicación del archivo">
            <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
          </button>
          <button class="action-icon-btn delete" title="Mover a la papelera">
            <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      `;

      // Locate Item Click
      item.querySelector('.locate').addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'SHOW_DOWNLOAD', id: video.id });
      });

      // Delete Item Click
      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm("¿Eliminar este video del historial de descargas?")) {
          chrome.runtime.sendMessage({ type: 'ERASE_DOWNLOAD', id: video.id }, (response) => {
            if (response && response.success) {
              item.remove();
              // If grid is empty now, show empty state
              if (grid.children.length === 0) {
                grid.innerHTML = `
                  <div class="empty-state">
                    <p>No hay videos descargados recientemente</p>
                  </div>`;
              }
            }
          });
        }
      });

      grid.appendChild(item);
    });
  });
}
