// modal.js
if (typeof chrome === 'undefined' || !chrome.runtime) {
  console.error("EasySS: Extension context lost. Please refresh the page.");
}
const DB_NAME = 'EasySS_DB';
const STORE_NAME = 'images';
let db;

// Persistent blacklist to prevent auto-readding deleted clipboard items
// We use chrome.storage.local because the modal (iframe) is re-created on each open.
async function isHashBanned(hash) {
  return new Promise((resolve) => {
    chrome.storage.local.get('deletedHashes', (data) => {
      const list = data.deletedHashes || [];
      // Consider a hash banned if it's in the list and was deleted recently (last 24h)
      const banned = list.some(item => item.hash === hash && (Date.now() - item.timestamp < 86400000));
      resolve(banned);
    });
  });
}

async function banHash(hash) {
  return new Promise((resolve) => {
    chrome.storage.local.get('deletedHashes', (data) => {
      let list = data.deletedHashes || [];
      // Remove if already exists to move it to the top
      list = list.filter(item => item.hash !== hash);
      list.unshift({ hash, timestamp: Date.now() });
      chrome.storage.local.set({ deletedHashes: list.slice(0, 100) }, resolve);
    });
  });
}

async function unbanHash(hash) {
  return new Promise((resolve) => {
    chrome.storage.local.get('deletedHashes', (data) => {
      let list = data.deletedHashes || [];
      list = list.filter(item => item.hash !== hash);
      chrome.storage.local.set({ deletedHashes: list }, resolve);
    });
  });
}

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
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.deleted = true;
        item.deletedAt = Date.now();
        store.put(item);
        resolve();
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function restoreImageFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = async () => {
      const item = getReq.result;
      if (item) {
        item.deleted = false;
        if (item.hash) await unbanHash(item.hash);
        store.put(item);
        resolve();
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function permanentlyDeleteFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function emptyTrashInDB() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.deleted) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
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
      // Ensure we use PNG for maximum compatibility with ClipboardItem
      // and wait for a user gesture context if needed
      const pngBlob = await convertToPng(blob);
      const data = [new ClipboardItem({ 'image/png': pngBlob })];
      await navigator.clipboard.write(data);
      showToast("Imagen copiada al portapapeles");
    } else {
      // For docs, we can't easily copy a file object, so we copy the filename
      await navigator.clipboard.writeText(item.filename || "Archivo");
      showToast("Nombre del archivo copiado");
    }
  } catch (err) {
    console.error("Error copying to clipboard:", err);
    // If it's a fetch error for downloads, explain it
    if (err.name === 'TypeError' && item.type === 'download') {
      showToast("No se puede copiar: URL de origen inaccesible");
    } else {
      showToast("Error al copiar");
    }
  }
}

async function convertToPng(blob) {
  // If it's already PNG, we still might want to re-process it to ensure it's a "clean" blob
  // but let's try returning it directly first for performance
  if (blob.type === 'image/png') return blob;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((resultBlob) => {
          if (resultBlob) resolve(resultBlob);
          else reject(new Error('Canvas toBlob failed'));
          URL.revokeObjectURL(url);
        }, 'image/png');
      } catch (e) {
        reject(e);
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      reject(new Error('Failed to load image for conversion'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

async function handleUIError(element) {
  const card = element.closest('.image-card') || element.closest('.doc-item');
  if (card) {
    const id = card.dataset.id;
    const type = card.dataset.type;
    
    // Remove from UI immediately
    card.remove();
    
    // If it's a download that no longer exists, erase it from Chrome history
    if (type === 'download' && id) {
      const numericId = parseInt(id.toString().replace('dl_', ''));
      if (!isNaN(numericId)) {
        chrome.runtime.sendMessage({ type: 'ERASE_DOWNLOAD', id: numericId });
      }
    }
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
    showToast("Error al descargar", "error");
  }
}

async function deleteItemPermanently(element, id, hash = null) {
  const card = element.closest('.image-card') || element.closest('.doc-item');
  if (card) card.remove();
  
  if (!id) return;

  // Add to persistent blacklist to avoid auto-readding from clipboard sync
  if (hash) {
    await banHash(hash);
  }

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

function locateItem(id) {
  if (typeof id === 'string' && id.startsWith('dl_')) {
    const numericId = parseInt(id.replace('dl_', ''));
    chrome.runtime.sendMessage({ type: 'SHOW_DOWNLOAD', id: numericId });
  }
}

async function addImageToDB(blob, source = 'SS') {
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
        // Update source if it was previously undefined or if we want to prioritize the new source
        item.source = source; 
        store.put(item);
        resolve({ item, isNew: false });
      } else {
        const item = {
          blob: blob,
          timestamp: Date.now(),
          hash: hash,
          source: source
        };
        const addReq = store.add(item);
        addReq.onsuccess = () => {
          item.id = addReq.result;
          resolve({ item, isNew: true });
        };
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function getImagesFromDB(includeDeleted = false) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');
    
    const results = [];
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        const item = cursor.value;
        if (includeDeleted || !item.deleted) {
          if (includeDeleted && !item.deleted) {
            // If we are looking for trash, skip active items
          } else if (!includeDeleted && item.deleted) {
            // If we are looking for active, skip deleted items
          } else {
            results.push(item);
          }
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function getTrashedImagesFromDB() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');
    
    const results = [];
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        const item = cursor.value;
        if (item.deleted) results.push(item);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.querySelector('span').innerText = message;
  toast.classList.remove('error');
  if (type === 'error') toast.classList.add('error');
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
  // Direct clipboard reading from modal is disabled to avoid "Permissions policy violation"
  // We rely entirely on the offscreen document via the background script.
  return null;
}

async function refreshUI() {
  if (!db) return; // Ensure database is ready

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
          const hash = await hashBlob(blob);

          if (!(await isHashBanned(hash))) {
            await addImageToDB(blob, 'Copiado');
          }
          // Clear it so we don't add it again on next refresh
          chrome.storage.local.remove('preemptiveImage');
        }
      }
    } catch (err) {
      console.log("Pre-emptive check info:", err);
    }

    // 1. Get clipboard image (Universal approach)
    // We no longer read directly from the modal to avoid "Permissions policy violation"
    // instead we rely on the background script's offscreen document broadcast.
    let newHash = null;
    
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

    renderSection('clipboardGrid', clipboardItems.slice(0, 100), newHash); 
    renderSection('downloadsGrid', imageItems.slice(0, 100), null); 
    renderDocuments(downloadDocuments.slice(0, 100));
    
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
    item.dataset.id = 'dl_' + doc.id;
    item.dataset.type = 'download';
    
    const ext = doc.filename.split('.').pop().toLowerCase();
    const color = getIconColor(ext);
    const date = new Date(doc.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    item.innerHTML = `
      <div class="doc-icon-wrapper" style="color:${color}; background: ${color}15; border: 1px solid ${color}30;">
        ${getDocIcon(ext)}
      </div>
      <div class="doc-info">
        <div class="doc-name" title="${doc.filename}">
          <span class="doc-name-text">${doc.filename}</span>
        </div>
        <div class="doc-meta">${ext.toUpperCase()} • ${timeStr}</div>
      </div>
      <button class="icon-btn locate-doc-btn" title="Abrir carpeta">
        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
      </button>
      <button class="icon-btn copy-doc-btn" title="Copiar">
        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
      </button>
      <button class="icon-btn delete-doc-btn" title="Eliminar">
        <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    `;
    
    const downloadId = 'dl_' + doc.id;

    const delBtn = item.querySelector('.delete-doc-btn');
    const copyBtn = item.querySelector('.copy-doc-btn');
    
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItemPermanently(item, downloadId);
    });
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(doc);
    });

    const locateBtn = item.querySelector('.locate-doc-btn');
    locateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      locateItem(downloadId);
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
        showToast("Documento no disponible", "error");
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
    txt: '#94a3b8',
    csv: '#10b981',
    json: '#f59e0b',
    js: '#f59e0b',
    zip: '#eab308',
    rar: '#eab308',
    jpg: '#ec4899',
    png: '#ec4899',
    gif: '#ec4899'
  };
  return colors[ext] || '#818cf8';
}

function getDocIcon(ext) {
  const size = "24px";
  
  // PDF Icon
  if (ext === 'pdf') {
    return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="9" y1="15" x2="12" y2="15"></line>
      <line x1="9" y1="12" x2="15" y2="12"></line>
      <line x1="9" y1="18" x2="15" y2="18"></line>
    </svg>`;
  }
  
  // Word Icon
  if (ext === 'doc' || ext === 'docx') {
    return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <path d="M9 13h6"></path>
      <path d="M9 17h3"></path>
      <path d="M9 9h1"></path>
    </svg>`;
  }
  
  // Excel / CSV Icon
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') {
    return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="8" y1="13" x2="16" y2="13"></line>
      <line x1="8" y1="17" x2="16" y2="17"></line>
      <line x1="12" y1="13" x2="12" y2="17"></line>
    </svg>`;
  }
  
  // Powerpoint Icon
  if (ext === 'ppt' || ext === 'pptx') {
    return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <rect x="8" y="12" width="8" height="6" rx="1"></rect>
    </svg>`;
  }
  
  // Text / JSON / JS Icon
  if (ext === 'txt' || ext === 'json' || ext === 'js') {
    return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="8" y1="13" x2="16" y2="13"></line>
      <line x1="8" y1="17" x2="14" y2="17"></line>
      <line x1="8" y1="9" x2="10" y2="9"></line>
    </svg>`;
  }

  // Archive Icon
  if (ext === 'zip' || ext === 'rar') {
    return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <path d="M12 12v6"></path>
      <path d="M10 12h4"></path>
      <path d="M10 15h4"></path>
      <path d="M10 18h4"></path>
    </svg>`;
  }

  // Generic/Default Icon
  return `<svg style="width:${size};height:${size};" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
  </svg>`;
}

function renderSection(gridId, items, newHash) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (items.length === 0) {
    const isClipboard = gridId === 'clipboardGrid';
    const isTrash = gridId === 'trashGrid';
    grid.innerHTML = `
      <div class="empty-state">
        <p style="font-size:0.9rem;opacity:0.6;">${isTrash ? 'La papelera está vacía' : (isClipboard ? 'No hay capturas recientes' : 'No hay descargas recientes')}</p>
      </div>`;
    return;
  }
  
  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.id = item.id;
    card.dataset.type = item.type;
    
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
    } else if (item.source) {
      const sourceLabel = item.source === 'SS' ? 'SS' : 'Copiado';
      badgeHtml = `<div class="badge-source">${sourceLabel}</div>`;
    }
    
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const locateBtnHtml = item.type === 'download' ? `
      <button class="locate-btn" title="Abrir ubicación del archivo">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
      </button>
    ` : '';

    const deleteTitle = item.deleted ? "Eliminar permanentemente" : "Mover a la papelera";
    card.innerHTML = `
      ${badgeHtml}
      ${locateBtnHtml}
      <button class="copy-btn" title="Copiar al portapapeles">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
      </button>
      ${item.deleted ? `
      <button class="restore-btn" title="Restaurar imagen">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
      </button>` : `
      <button class="download-btn" title="Descargar a mi PC">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
      </button>`}
      <button class="delete-btn" title="${deleteTitle}">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
      <img src="${imgUrl}" alt="Imagen">
      <div class="badge-dimensions" style="display:none;"></div>
      <div class="overlay">
        <div class="overlay-text">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
          Seleccionar (${timeStr})
        </div>
      </div>
    `;
    
    const img = card.querySelector('img');
    const dimBadge = card.querySelector('.badge-dimensions');
    
    const updateDims = () => {
      if (img.naturalWidth && img.naturalHeight) {
        dimBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        dimBadge.style.display = 'block';
      }
    };
    
    img.onload = updateDims;
    if (img.complete) updateDims();
    
    img.addEventListener('error', () => handleUIError(img));
    
    const delBtn = card.querySelector('.delete-btn');
    const copyBtn = card.querySelector('.copy-btn');
    const dlBtn = card.querySelector('.download-btn');
    
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (item.deleted) {
        if (confirm("¿Eliminar permanentemente esta imagen?")) {
          await permanentlyDeleteFromDB(item.id);
          card.remove();
        }
      } else {
        await deleteItemPermanently(card, item.id, item.hash);
      }
    });

    const restoreBtn = card.querySelector('.restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await restoreImageFromDB(item.id);
        card.remove();
        refreshUI();
      });
    }
    
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item);
    });

    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadItem(item);
    });

    const locateBtn = card.querySelector('.locate-btn');
    if (locateBtn) {
      locateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        locateItem(item.id);
      });
    }

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
        showToast("Archivo no disponible", "error");
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

// Also listen for messages from background script (broadcasts)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EXTERNAL_IMAGE_CAPTURED') {
      handleExternalImage(message.dataUrl);
    }
  });
}

async function handleExternalImage(dataUrl) {
  if (!dataUrl) return;
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const hash = await hashBlob(blob);

    if (await isHashBanned(hash)) {
      console.log("EasySS: Skipping re-adding a recently deleted image.");
      return;
    }

    const { isNew } = await addImageToDB(blob, 'Copiado');
    if (isNew) {
      showToast("Imagen capturada con éxito");
    }
    refreshUI();
  } catch (err) {
    console.error("Error handling external image:", err);
    // If fetch failed (likely CORS), we don't do anything here as the background 
    // script is likely already fetching it and will broadcast the DataURL soon.
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
    showToast("Error al exportar", "error");
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
    showToast("Error: Archivo no válido", "error");
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
  
  document.getElementById('closeBtn').addEventListener('click', () => sendMessage('CLOSE_MODAL'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sendMessage('CLOSE_MODAL');
  });
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';
    
    // Request universal clipboard check
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'REFRESH_CLIPBOARD_UNIVERSAL' }).catch(() => {});
    }

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

  // Trash UI Event Listeners
  document.getElementById('trashBtn').addEventListener('click', async () => {
    const trashedItems = await getTrashedImagesFromDB();
    renderSection('trashGrid', trashedItems.map(img => ({ ...img, type: 'clipboard' })), null);
    document.getElementById('trashOverlay').style.display = 'flex';
  });

  document.getElementById('closeTrashBtn').addEventListener('click', () => {
    document.getElementById('trashOverlay').style.display = 'none';
    refreshUI();
  });

  document.getElementById('emptyTrashBtn').addEventListener('click', async () => {
    if (confirm("¿Seguro que quieres vaciar la papelera? Esta acción no se puede deshacer.")) {
      await emptyTrashInDB();
      document.getElementById('trashGrid').innerHTML = `
        <div class="empty-state">
          <p style="font-size:0.9rem;opacity:0.6;">La papelera está vacía</p>
        </div>`;
      showToast("Papelera vaciada");
    }
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
      showToast("Error al procesar archivo", "error");
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

  let newImageBlob = null;
  const files = (e.clipboardData || window.clipboardData).files;
  
  // 1. Check files first (better for Word/Windows copies)
  if (files && files.length > 0) {
    for (const file of files) {
      if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i)) {
        newImageBlob = file;
        break;
      }
    }
  }

  // 2. Check items if no file found
  if (!newImageBlob) {
    const items = (e.clipboardData || window.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile();
        if (blob && blob.size > 0) {
          newImageBlob = blob;
          break;
        }
      }
    }
  }
  
  if (newImageBlob) {
    // Prevent default only if we found an image to avoid blocking text paste if ever needed
    e.preventDefault(); 
    try {
      showToast("Imagen pegada con éxito");
      
      // If user explicitly pastes it, remove from blacklist if it was there
      const hash = await hashBlob(newImageBlob);
      await unbanHash(hash);

      // Save to DB for history
      await addImageToDB(newImageBlob, 'SS');
      
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
