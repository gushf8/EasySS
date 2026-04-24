// modal.js
const DB_NAME = 'EasySS_DB';
const STORE_NAME = 'images';
let db;

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

function sendMessage(type, data = {}) {
  window.parent.postMessage({ source: 'EASYSS_EXTENSION', type, ...data }, '*');
}

function renderImages(images, newHash = null) {
  const grid = document.getElementById('imageGrid');
  grid.innerHTML = '';
  
  if (images.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg style="width:64px;height:64px;color:rgba(255,255,255,0.15);margin-bottom:16px" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        <p style="font-weight:600; margin-bottom:8px">No hay imágenes guardadas</p>
        <p style="font-size:0.9rem;opacity:0.7;max-width:80%">Usa <b>Win+Shift+S</b> para capturar pantalla y aparecerá aquí automáticamente.</p>
      </div>`;
    return;
  }
  
  images.forEach(item => {
    const card = document.createElement('div');
    card.className = 'image-card';
    
    const imgUrl = URL.createObjectURL(item.blob);
    
    let badgeHtml = '';
    if (item.hash === newHash) {
      badgeHtml = '<div class="badge-new">NUEVA</div>';
    }
    
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    card.innerHTML = `
      ${badgeHtml}
      <img src="${imgUrl}" alt="Captura">
      <div class="overlay">
        <div class="overlay-text">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
          Subir imagen (${timeStr})
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      // Send selected image as DataURL
      const reader = new FileReader();
      reader.onload = (e) => {
        sendMessage('FILE_SELECTED', {
          dataUrl: e.target.result,
          filename: `easyss_${item.timestamp}.png`
        });
      };
      reader.readAsDataURL(item.blob);
    });
    
    grid.appendChild(card);
  });
}

async function checkClipboard() {
  let newImageAddedHash = null;
  
  // Wait a bit for focus to settle
  await new Promise(r => setTimeout(r, 100));

  try {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      console.warn("Clipboard API not available");
      return null;
    }

    const items = await navigator.clipboard.read();
    
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const savedItem = await addImageToDB(blob);
          newImageAddedHash = savedItem.hash;
          break;
        }
      }
      if (newImageAddedHash) break;
    }
  } catch (err) {
    console.log('Clipboard access info:', err.message);
    // This is common if the user hasn't interacted or permission is denied
  }
  return newImageAddedHash;
}

async function refreshUI() {
  try {
    // 1. Get clipboard image (and save to DB)
    const newHash = await checkClipboard();
    
    // 2. Get images from IndexedDB (Clipboard history)
    const dbImages = await getImagesFromDB();
    
    // 3. Get images from Downloads (via background)
    let downloadImages = [];
    try {
      downloadImages = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_RECENT_DOWNLOADS' }, (response) => {
          resolve(response || []);
        });
      });
    } catch (err) {
      console.log("Could not get downloads:", err);
    }

    // 4. Combine and Sort
    // We need to normalize them to a similar format
    const combined = [
      ...dbImages.map(img => ({ ...img, type: 'clipboard' })),
      ...downloadImages.map(img => ({ 
        id: 'dl_' + img.id, 
        blob: null, // Will fetch on click or use URL
        url: img.url,
        timestamp: img.timestamp, 
        hash: img.url, // Use URL as hash for downloads
        filename: img.filename,
        type: 'download'
      }))
    ];

    // Sort by timestamp descending
    combined.sort((a, b) => b.timestamp - a.timestamp);

    renderImages(combined, newHash);
  } catch (err) {
    console.error("Error refreshing UI:", err);
    const grid = document.getElementById('imageGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <p style="color:var(--danger)">No se pudieron cargar las imágenes.</p>
          <p style="font-size:0.8rem;opacity:0.6">${err.message}</p>
        </div>`;
    }
  }
}

function renderImages(images, newHash = null) {
  const grid = document.getElementById('imageGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (images.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div style="background:var(--glass); width:80px; height:80px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
          <svg style="width:40px;height:40px;opacity:0.3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        </div>
        <p style="font-weight:700; margin:0; font-size:1.1rem; color:white;">No hay imágenes recientes</p>
        <p style="font-size:0.9rem;opacity:0.6;max-width:280px;margin:10px 0 0 0;">Copia una imagen o usa <b>Win+Shift+S</b> para que aparezca aquí.</p>
      </div>`;
    return;
  }
  
  images.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    if (index === 0) card.style.animationDelay = '0.1s';
    
    // Determine image source
    let imgUrl;
    if (item.type === 'clipboard') {
      imgUrl = URL.createObjectURL(item.blob);
    } else {
      imgUrl = item.url; // Use the original download URL
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
      <img src="${imgUrl}" alt="Imagen" onerror="this.src='https://via.placeholder.com/200?text=Error+de+Carga'">
      <div class="overlay">
        <div class="overlay-text">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
          Subir (${timeStr})
        </div>
      </div>
    `;
    
    card.addEventListener('click', async () => {
      card.style.transform = 'scale(0.95)';
      card.style.opacity = '0.7';
      
      try {
        let blob;
        if (item.type === 'clipboard') {
          blob = item.blob;
        } else {
          // For downloads, we need to fetch the image to get a blob
          const response = await fetch(item.url);
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
        alert("No se pudo procesar esta imagen. Es posible que el archivo ya no esté disponible.");
        card.style.transform = '';
        card.style.opacity = '';
      }
    });
    
    grid.appendChild(card);
  });
}

// Event Listeners
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'FOCUS_MODAL') {
    window.focus();
    refreshUI();
  }
});

// Refresh when window gets focus (e.g. user returns from taking a screenshot)
window.addEventListener('focus', refreshUI);

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('closeBtn').addEventListener('click', () => sendMessage('CLOSE_MODAL'));
  
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') sendMessage('CLOSE_MODAL');
  });
  
  document.getElementById('fallbackBtn').addEventListener('click', () => sendMessage('OPEN_DEFAULT'));

  try {
    await initDB();
    await refreshUI();
  } catch(e) {
    console.error("Initialization error:", e);
  }
});

document.addEventListener('paste', async (e) => {
  const items = (e.clipboardData || window.clipboardData).items;
  let newImageBlob = null;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      newImageBlob = item.getAsFile();
      break;
    }
  }
  
  if (newImageBlob) {
    try {
      await addImageToDB(newImageBlob);
      // Use refreshUI to re-sync everything (DB + Downloads)
      await refreshUI();
    } catch (err) {
      console.error("Error pasting image:", err);
    }
  }
});

function sendMessage(type, data = {}) {
  window.parent.postMessage({ source: 'EASYSS_EXTENSION', type, ...data }, '*');
}
