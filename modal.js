// modal.js
if (typeof chrome === 'undefined' || !chrome.runtime) {
  console.error("EasySS: Extension context lost. Please refresh the page.");
}
const DB_NAME = 'EasySS_DB';
const STORE_NAME = 'images';
let db;

// Check if we have a target input in the parent page
const urlParams = new URLSearchParams(window.location.search);
const hasTargetInput = urlParams.get('hasTarget') === 'true';

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = event => reject(event.target.error);
    request.onsuccess = event => {
      db = event.target.result;
      resolve(db);
    };
    request.onupgradeneeded = event => {
      db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('hash', 'hash', { unique: true });
      }
    };
  });
}

// Simple hash to avoid duplicate images
async function hashBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-1', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deleteImageFromDB(id) {
  if (!id) return;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function copyToClipboard(item) {
  try {
    let blob;
    if (item.type === 'clipboard') {
      blob = item.blob;
    } else {
      const response = await fetch(item.url);
      blob = await response.blob();
    }
    
    if (blob.type.startsWith('image/')) {
      const data = [new ClipboardItem({ [blob.type]: blob })];
      await navigator.clipboard.write(data);
      showToast("Imagen copiada al portapapeles");
    } else {
      // For docs, we can't easily copy a file object, so we copy the filename
      await navigator.clipboard.writeText(item.filename);
      showToast("Nombre del archivo copiado");
    }
  } catch (err) {
    console.error("Error copying to clipboard:", err);
    showToast("Error al copiar");
  }
}

async function handleUIError(element) {
  // Just hide from the extension's current view, don't touch the browser history
  const card = element.closest('.image-card') || element.closest('.doc-item');
  if (card) {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
    card.title = "Archivo no disponible localmente";
    // We don't remove it or erase it from history automatically anymore
  }
}

async function downloadItem(item) {
  try {
    let url;
    if (item.type === 'clipboard') {
      url = URL.createObjectURL(item.blob);
    } else {
      url = item.url;
    }
    
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename || `easyss_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    if (item.type === 'clipboard') {
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
    showToast("Descarga iniciada");
  } catch (err) {
    console.error("Error downloading item:", err);
    showToast("Error al descargar");
  }
}

async function deleteItemPermanently(element, id) {
  const card = element.closest('.image-card') || element.closest('.doc-item');
  if (card) card.remove();
  
  if (!id) return;

  if (typeof id === 'string' && id.startsWith('dl_')) {
    // User explicitly asked to delete a download from history
    const downloadId = parseInt(id.replace('dl_', ''));
    chrome.runtime.sendMessage({ type: 'ERASE_DOWNLOAD', id: downloadId });
  } else if (typeof id === 'number') {
    // User explicitly asked to delete a clipboard item from IndexedDB
    try {
      await deleteImageFromDB(id);
    } catch (err) {
      console.error('Error deleting image from DB:', err);
    }
  }
}

async function addImageToDB(blob) {
  const hash = await hashBlob(blob);
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('hash');
    const request = index.get(hash);
    
    request.onsuccess = () => {
      if (request.result) {
        // Already exists, update timestamp to move it to the top
        const item = request.result;
        item.timestamp = Date.now();
        store.put(item);
        resolve(item);
      } else {
        const item = {
          blob: blob,
          timestamp: Date.now(),
          hash: hash
        };
        const addReq = store.add(item);
        addReq.onsuccess = () => {
          item.id = addReq.result;
          resolve(item);
        };
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function getImagesFromDB() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    // Open cursor in descending order to get newest first
    const request = index.openCursor(null, 'prev');
    
    const results = [];
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector('span').innerText = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

async function processAndSendBlob(blob, filename = null) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      sendMessage('FILE_SELECTED', {
        dataUrl: e.target.result,
        filename: filename || `easyss_${Date.now()}.png`
      });
      resolve();
    };
    reader.readAsDataURL(blob);
  });
}



async function checkClipboard() {
  let newImageAddedHash = null;
  // NO DELAY: Instant reading to beat site focus-stealing
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      return null;
    }

    const items = await navigator.clipboard.read();
    
    for (const item of items) {
      // Find the first image type available
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const savedItem = await addImageToDB(blob);
        newImageAddedHash = savedItem.hash;
        break;
      }
    }
  } catch (err) {
    // This is expected if the user hasn't interacted yet or permission is not granted
    console.log('Clipboard auto-check info:', err.message);
  }
  return newImageAddedHash;
}

async function refreshUI() {
  try {
    // 0. Check for pre-emptive capture (Right-click bypass)
    try {
      const storage = await chrome.storage.local.get('preemptiveImage');
      if (storage.preemptiveImage) {
        const { dataUrl, timestamp } = storage.preemptiveImage;
        // Only consider it if it happened in the last 2 minutes
        if (Date.now() - timestamp < 120000) {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          await addImageToDB(blob);
          // Clear it so we don't add it again on next refresh
          chrome.storage.local.remove('preemptiveImage');
        }
      }
    } catch (err) {
      console.log("Pre-emptive check info:", err);
    }

    // 1. Get clipboard image (Only if we have focus to avoid site flickering)
    if (document.hasFocus()) {
      await checkClipboard();
    }
    
    // 2. Get history from DB
    const dbImages = await getImagesFromDB();
    
    // 3. Get images from Downloads
    let downloadImages = [];
    try {
      downloadImages = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_RECENT_DOWNLOADS' }, (response) => {
          resolve(response || []);
        });
      });
    } catch (err) {
      console.log("Could not get image downloads:", err);
    }

    // 4. Get documents from Downloads
    let downloadDocuments = [];
    try {
      downloadDocuments = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_RECENT_DOCUMENTS' }, (response) => {
          resolve(response || []);
        });
      });
    } catch (err) {
      console.log("Could not get document downloads:", err);
    }

    // 5. Render Sections
    const clipboardItems = dbImages.map(img => ({ ...img, type: 'clipboard' }));
    const imageItems = downloadImages.map(img => ({ 
      ...img,
      id: 'dl_' + img.id, 
      type: 'download'
    }));

    renderSection('clipboardGrid', clipboardItems.slice(0, 40), newHash); 
    renderSection('downloadsGrid', imageItems.slice(0, 40), null); 
    renderDocuments(downloadDocuments);
    
  } catch (err) {
    console.error("Error refreshing UI:", err);
  }
}

function renderDocuments(docs) {
  const list = document.getElementById('documentsList');
  if (!list) return;
  
  list.innerHTML = '';
  
  if (docs.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding: 20px;"><p style="font-size:0.8rem;opacity:0.5;">No hay documentos recientes</p></div>';
    return;
  }
  
  docs.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-item';
    
    const ext = doc.filename.split('.').pop().toLowerCase();
    const color = getIconColor(ext);
    const date = new Date(doc.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    item.innerHTML = `
      <div class="doc-icon-wrapper" style="color:${color}">
        ${getDocIcon(ext)}
      </div>
      <div class="doc-info">
        <div class="doc-name" title="${doc.filename}">${doc.filename}</div>
        <div class="doc-meta">${ext.toUpperCase()} • ${timeStr}</div>
      </div>
      <button class="icon-btn copy-doc-btn" style="width:28px;height:28px;margin-left:auto;opacity:0;transition:opacity 0.2s;margin-right:8px;" title="Copiar">
        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
      </button>
      <button class="icon-btn delete-doc-btn" style="width:28px;height:28px;opacity:0;transition:opacity 0.2s;" title="Eliminar">
        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    `;
    
    const downloadId = 'dl_' + doc.id;

    const delBtn = item.querySelector('.delete-doc-btn');
    const copyBtn = item.querySelector('.copy-doc-btn');
    item.addEventListener('mouseenter', () => {
      delBtn.style.opacity = '1';
      copyBtn.style.opacity = '1';
    });
    item.addEventListener('mouseleave', () => {
      delBtn.style.opacity = '0';
      copyBtn.style.opacity = '0';
    });
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItemPermanently(item, downloadId);
    });
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(doc);
    });
    
    item.addEventListener('click', async () => {
      item.style.background = 'rgba(255,255,255,0.1)';
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(doc.url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error('File not found');
        const blob = await response.blob();
        
        const reader = new FileReader();
        reader.onload = (e) => {
          sendMessage('FILE_SELECTED', {
            dataUrl: e.target.result,
            filename: doc.filename
          });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error("Error selecting document:", err);
        showToast("Documento no disponible");
        handleUIError(item);
      }
    });
    
    list.appendChild(item);
  });
}

function getIconColor(ext) {
  const colors = {
    pdf: '#ff4d4d',
    doc: '#2b579a',
    docx: '#2b579a',
    xls: '#217346',
    xlsx: '#217346',
    ppt: '#d24726',
    pptx: '#d24726',
    txt: '#9ca3af',
    csv: '#10b981'
  };
  return colors[ext] || '#818cf8';
}

function getDocIcon(ext) {
  // Simplified icons
  if (ext === 'pdf') return '<svg style="width:20px;height:20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-5h2v5z"/></svg>';
  return '<svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>';
}

function renderSection(gridId, items, newHash) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (items.length === 0) {
    const isClipboard = gridId === 'clipboardGrid';
    grid.innerHTML = `
      <div class="empty-state">
        <p style="font-size:0.9rem;opacity:0.6;">${isClipboard ? 'No hay capturas recientes' : 'No hay descargas recientes'}</p>
      </div>`;
    return;
  }
  
  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    
    // Determine image source
    let imgUrl;
    if (item.type === 'clipboard') {
      imgUrl = URL.createObjectURL(item.blob);
    } else {
      imgUrl = item.url;
    }
    
    let badgeHtml = '';
    if (item.hash === newHash) {
      badgeHtml = '<div class="badge-new">Nueva</div>';
    } else if (item.type === 'download') {
      badgeHtml = '<div class="badge-download">Descarga</div>';
    }
    
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    card.innerHTML = `
      ${badgeHtml}
      <button class="copy-btn" title="Copiar al portapapeles">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
      </button>
      <button class="download-btn" title="Descargar a mi PC">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
      </button>
      <button class="delete-btn" title="Eliminar de la lista">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
      <img src="${imgUrl}" alt="Imagen">
      <div class="overlay">
        <div class="overlay-text">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
          Seleccionar (${timeStr})
        </div>
      </div>
    `;
    
    const img = card.querySelector('img');
    img.addEventListener('error', () => handleUIError(img));
    
    const delBtn = card.querySelector('.delete-btn');
    const copyBtn = card.querySelector('.copy-btn');
    const dlBtn = card.querySelector('.download-btn');
    
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItemPermanently(card, item.id);
    });
    
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item);
    });

    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadItem(item);
    });

    card.addEventListener('click', async () => {
      card.style.transform = 'scale(0.95)';
      card.style.opacity = '0.7';
      
      try {
        let blob;
        if (item.type === 'clipboard') {
          blob = item.blob;
        } else {
          // Add timeout to fetch
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(item.url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) throw new Error('File not found');
          blob = await response.blob();
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          sendMessage('FILE_SELECTED', {
            dataUrl: e.target.result,
            filename: item.filename || `easyss_${item.timestamp}.png`
          });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error("Error processing selection:", err);
        showToast("Archivo no disponible");
        handleUIError(card);
      }
    });
    
    grid.appendChild(card);
  });
}

// Event Listeners
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'FOCUS_MODAL') {
    window.focus();
    // Immediate refresh
    refreshUI();
    // Delayed retry for heavy clipboard data (like Facebook images)
    setTimeout(refreshUI, 500);
  } else if (e.data && e.data.type === 'EXTERNAL_IMAGE_CAPTURED') {
    handleExternalImage(e.data.dataUrl);
  } else if (e.data && e.data.type === 'TRIGGER_LOCAL_FILE_PICKER') {
    document.getElementById('localFileInput').click();
  }
});

async function handleExternalImage(dataUrl) {
  if (!dataUrl) return;
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await addImageToDB(blob);
    showToast("Imagen capturada con éxito");
    refreshUI();
  } catch (err) {
    console.error("Error handling external image:", err);
  }
}

async function exportDatabase() {
  try {
    showToast("Preparando respaldo...");
    const items = await getImagesFromDB();
    const exportData = [];
    
    for (const item of items) {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(item.blob);
      });
      exportData.push({
        timestamp: item.timestamp,
        hash: item.hash,
        data: base64
      });
    }
    
    const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `easyss_backup_${new Date().toISOString().slice(0,10)}.easyss`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Respaldo descargado con éxito");
  } catch (err) {
    console.error("Export error:", err);
    showToast("Error al exportar");
  }
}

async function importDatabase(file) {
  try {
    showToast("Restaurando historial...");
    const text = await file.text();
    const importData = JSON.parse(text);
    
    let count = 0;
    for (const item of importData) {
      const response = await fetch(item.data);
      const blob = await response.blob();
      await addImageToDB(blob);
      count++;
    }
    
    showToast(`Restauradas ${count} imágenes`);
    refreshUI();
  } catch (err) {
    console.error("Import error:", err);
    showToast("Error: Archivo no válido");
  }
}

async function checkActivation() {
  return new Promise((resolve) => {
    chrome.storage.local.get('isActivated', (result) => {
      if (!result.isActivated) {
        document.getElementById('activationOverlay').style.display = 'flex';
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
      document.getElementById('activationOverlay').style.opacity = '0';
      setTimeout(() => {
        document.getElementById('activationOverlay').style.display = 'none';
      }, 400);
      showToast("¡EasySS Activado!");
    });
  } else {
    error.style.display = 'block';
    document.getElementById('activationPassword').style.borderColor = 'var(--danger)';
    setTimeout(() => {
      document.getElementById('activationPassword').style.borderColor = 'rgba(255, 255, 255, 0.1)';
    }, 1000);
  }
}

// Refresh when window gets focus (e.g. user returns from taking a screenshot)
window.addEventListener('focus', refreshUI);

document.addEventListener('DOMContentLoaded', async () => {
  await checkActivation();
  
  // Initial refresh
  refreshUI();
  
  document.getElementById('closeBtn').addEventListener('click', () => sendMessage('CLOSE_MODAL'));
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';
    refreshUI().then(() => {
      setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
    });
  });
    
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') sendMessage('CLOSE_MODAL');
  });
  
  const triggerFallback = () => {
    if (hasTargetInput) {
      sendMessage('OPEN_DEFAULT');
    } else {
      // Direct click on local input to preserve user gesture strength
      document.getElementById('localFileInput').click();
    }
  };

  document.getElementById('fallbackBtn').addEventListener('click', triggerFallback);
  document.getElementById('sidebarUploadBtn').addEventListener('click', triggerFallback);

  document.getElementById('exportBtn').addEventListener('click', exportDatabase);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('backupFileInput').click());
  
  document.getElementById('backupFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importDatabase(file);
  });

  document.getElementById('activateBtn').addEventListener('click', handleActivation);
  document.getElementById('activationPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleActivation();
  });

  document.getElementById('localFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (file.type.startsWith('image/')) {
        await addImageToDB(file);
      }
      await processAndSendBlob(file, file.name);
    } catch (err) {
      console.error("Error processing local file:", err);
      showToast("Error al procesar archivo");
    }
  });

  try {
    await initDB();
    await refreshUI();
  } catch(e) {
    console.error("Initialization error:", e);
  }
});

document.addEventListener('paste', async (e) => {
  // Prevent propagation to the underlying page (like WhatsApp chat)
  e.stopPropagation();

  const items = (e.clipboardData || window.clipboardData).items;
  let newImageBlob = null;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      newImageBlob = item.getAsFile();
      break;
    }
  }
  
  if (newImageBlob) {
    // Prevent default only if we found an image to avoid blocking text paste if ever needed
    e.preventDefault(); 
    try {
      showToast("Imagen pegada con éxito");
      
      // Save to DB for history
      await addImageToDB(newImageBlob);
      
      // Auto-send immediately
      await processAndSendBlob(newImageBlob);
    } catch (err) {
      console.error("Error pasting image:", err);
    }
  }
});

function sendMessage(type, data = {}) {
  window.parent.postMessage({ source: 'EASYSS_EXTENSION', type, ...data }, '*');
}
