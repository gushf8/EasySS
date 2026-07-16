// background.js
let lastRightClickedImageUrl = null;

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-easyss") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_MODAL_MANUAL' }).catch(() => {});
      }
    });
  }
});

// chrome.action.onClicked.addListener((tab) => {
//   if (tab && tab.id) {
//     chrome.tabs.sendMessage(tab.id, { type: 'OPEN_MODAL_MANUAL' }).catch(() => {});
//   }
// });

chrome.contextMenus.removeAll(() => {
  chrome.contextMenus.create({
    id: "captureImage",
    title: "Capturar imagen con EasySS",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "downloadVideo",
    title: "Descargar video",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "captureImage") {
    const url = info.srcUrl || lastRightClickedImageUrl;
    if (url) {
      const processDataUrl = (dataUrl) => {
        if (dataUrl) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'IMAGE_CAPTURED_CONTEXT_MENU',
            dataUrl: dataUrl,
            srcUrl: url
          }).catch(err => console.log("Tab not ready for message", err));
        }
      };
      
      if (url.startsWith('data:')) {
        processDataUrl(url);
      } else {
        fetchImageAsDataUrl(url).then(processDataUrl);
      }
    }
  } else if (info.menuItemId === "downloadVideo") {
    handleVideoDownload(info, tab);
  }
});

async function fetchImageAsDataUrl(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("Error fetching image:", err);
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PREEMPTIVE_CAPTURE') {
    lastRightClickedImageUrl = message.url;
    const processDataUrl = (dataUrl) => {
      if (dataUrl) {
        chrome.storage.local.set({ 
          preemptiveImage: {
            dataUrl: dataUrl,
            timestamp: Date.now(),
            url: message.url.startsWith('data:') ? 'video_frame.png' : message.url,
            source: message.source || 'Copiado'
          }
        });
        // Broadcast to any open modal
        chrome.runtime.sendMessage({
          type: 'EXTERNAL_IMAGE_CAPTURED',
          dataUrl: dataUrl,
          source: message.source || 'Copiado'
        }).catch(() => {}); // No one listening is fine
      }
    };
    
    if (message.url.startsWith('data:')) {
      processDataUrl(message.url);
    } else {
      fetchImageAsDataUrl(message.url).then(processDataUrl);
    }
    return;
  }
  if (message.type === 'OPEN_CHROME_SHORTCUTS') {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return;
  }
  if (message.type === 'WRITE_CLIPBOARD_REQUEST') {
    handleUniversalWriteRequest(message.dataUrl);
    return;
  }
  if (message.type === 'GET_RECENT_DOWNLOADS') {
    getRecentDownloads('image').then(sendResponse);
    return true;
  }
  if (message.type === 'GET_RECENT_DOCUMENTS') {
    getRecentDownloads('document').then(sendResponse);
    return true;
  }
  if (message.type === 'DOWNLOAD_VIDEO_URL') {
    downloadVideoByUrl(message.url, message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_RECENT_VIDEOS') {
    getRecentVideoDownloads().then(sendResponse);
    return true;
  }
  if (message.type === 'ERASE_DOWNLOAD') {
    chrome.downloads.erase({ id: message.id }, () => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'SHOW_DOWNLOAD') {
    chrome.downloads.show(message.id);
    return;
  }
  // Cobalt bridge messages — handled inside downloadVideoByUrl promise, ignore here
  if (message.type === 'COBALT_BRIDGE_STARTED' ||
      message.type === 'COBALT_BRIDGE_SUCCESS' ||
      message.type === 'COBALT_BRIDGE_FAILED') {
    return; // handled by per-request listeners inside downloadVideoByUrl
  }
  if (message.type === 'REFRESH_CLIPBOARD_UNIVERSAL') {
    handleUniversalClipboardRequest();
    return;
  }
  if (message.type === 'CLIPBOARD_DATA_FROM_OFFSCREEN') {
    // We got an image from the offscreen document!
    const dataUrl = message.dataUrl;
    // Notify all extension parts
    chrome.runtime.sendMessage({
      type: 'EXTERNAL_IMAGE_CAPTURED',
      dataUrl: dataUrl,
      source: 'SS'
    }).catch(() => {});
    return;
  }
});

async function handleUniversalClipboardRequest() {
  try {
    await setupOffscreenDocument();
    // Give it a tiny bit of time to initialize its listener
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'READ_CLIPBOARD_OFFSCREEN'
      }).catch(() => {});
    }, 50);
  } catch (err) {
    console.warn("Background: Failed to handle universal clipboard", err);
  }
}

async function handleUniversalWriteRequest(dataUrl) {
  try {
    await setupOffscreenDocument();
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'WRITE_CLIPBOARD_OFFSCREEN',
        dataUrl: dataUrl
      }).catch(() => {});
    }, 50);
  } catch (err) {
    console.warn("Background: Failed to handle universal write", err);
  }
}

async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Leer y escribir en el portapapeles universalmente.'
    });
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document may be created')) {
      throw err;
    }
  }
}

async function getRecentDownloads(type = 'image') {
  return new Promise((resolve) => {
    chrome.downloads.search({
      limit: 100, // Search more to find enough valid items
      orderBy: ['-startTime'],
      state: 'complete',
      exists: true
    }, (items) => {
      const filtered = [];

      items.forEach(item => {
        // Smart Cleanup: If file no longer exists, erase it from history
        if (item.exists === false) {
          chrome.downloads.erase({ id: item.id });
          return;
        }

        const ext = item.filename.split('.').pop().toLowerCase();

        if (type === 'image') {
          const isImg = item.mime && item.mime.startsWith('image/');
          const hasImgExt = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(item.filename);
          const isVideo = item.mime && item.mime.startsWith('video/');
          const hasVideoExt = /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(item.filename);
          if (isImg || hasImgExt || isVideo || hasVideoExt) {
            filtered.push({
              id: item.id,
              url: item.url,
              filename: item.filename.split(/[\\/]/).pop(),
              timestamp: new Date(item.startTime).getTime(),
              isVideo: isVideo || hasVideoExt
            });
          }
        } else {
          // Documents
          const isDoc = item.mime && (
            item.mime.includes('pdf') ||
            item.mime.includes('word') ||
            item.mime.includes('excel') ||
            item.mime.includes('officedocument') ||
            item.mime.includes('powerpoint') ||
            item.mime.includes('text/plain')
          );
          const hasDocExt = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)$/i.test(item.filename);
          // Ensure it's not an image extension
          const isNotImg = !/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(item.filename);

          if ((isDoc || hasDocExt) && isNotImg) {
            filtered.push({
              id: item.id,
              url: item.url,
              filename: item.filename.split(/[\\/]/).pop(),
              timestamp: new Date(item.startTime).getTime()
            });
          }
        }
      });

      // Return more results to allow months of history
      resolve(type === 'image' ? filtered.slice(0, 100) : filtered.slice(0, 100));
    });
  });
}

const COBALT_INSTANCES = [
  'https://api.cobalt.tools/',
  'https://cobalt.api.ryz.cx/',
  'https://api.smooth.yt/',
  'https://co.wuk.sh/',
  'https://cobalt-api.kwiatuszek.xyz/'
];

async function handleVideoDownload(info, tab) {
  let videoUrl = info.pageUrl || tab.url;
  
  if (info.linkUrl && (info.linkUrl.includes('youtube.com') || info.linkUrl.includes('youtu.be') || info.linkUrl.includes('instagram.com') || info.linkUrl.includes('facebook.com') || info.linkUrl.includes('fb.watch'))) {
    videoUrl = info.linkUrl;
  }

  await downloadVideoByUrl(videoUrl, tab.id);
}

async function downloadVideoByUrl(videoUrl, tabId = null) {
  if (!videoUrl) {
    if (tabId) showToast(tabId, "No se pudo obtener la URL del video.");
    return { success: false, error: "No se pudo obtener la URL del video." };
  }

  if (tabId) showToast(tabId, "Procesando descarga de video...");

  for (const instance of COBALT_INSTANCES) {
    try {
      console.log(`Intentando con instancia Cobalt: ${instance}`);
      const response = await fetch(instance, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: videoUrl,
          videoQuality: '720',
          filenamePattern: 'classic'
        })
      });

      if (!response.ok) {
        console.warn(`Instancia ${instance} devolvió estado ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (data && data.url) {
        return new Promise((resolve) => {
          chrome.downloads.download({
            url: data.url,
            filename: data.filename || `video_${Date.now()}.mp4`
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error("Error al descargar:", chrome.runtime.lastError);
              if (tabId) showToast(tabId, "Error al iniciar la descarga del archivo.");
              resolve({ success: false, error: "Error al iniciar descarga del archivo." });
            } else {
              if (tabId) showToast(tabId, "Descarga de video iniciada.");
              resolve({ success: true, downloadId: downloadId });
            }
          });
        });
      } else if (data && data.status === 'error') {
        console.warn(`Instancia ${instance} devolvió error de Cobalt:`, data.error);
      }
    } catch (err) {
      console.warn(`Error con la instancia Cobalt ${instance}:`, err);
    }
  }

  // ── Cobalt Bridge: open cobalt.tools as a hidden tunnel ──────────────────
  // The content scripts (cobalt_bridge.js + cobalt_bridge_main.js) will:
  //   1. Fill cobalt.tools input with the video URL and submit
  //   2. Intercept cobalt's internal fetch response (which contains the real CDN URL)
  //   3. postMessage → sendMessage → here → chrome.downloads.download
  // The tab is opened in the background and auto-closed after success/timeout.
  if (tabId) showToast(tabId, "Conectando con cobalt.tools para obtener enlace...");

  return new Promise((resolve) => {
    const bridgeHash = `#easyssdl:${encodeURIComponent(videoUrl)}`;
    const bridgeUrl = `https://cobalt.tools/${bridgeHash}`;

    chrome.tabs.create({ url: bridgeUrl, active: false }, (bridgeTab) => {
      if (chrome.runtime.lastError || !bridgeTab) {
        if (tabId) showToast(tabId, "No se pudo abrir cobalt.tools.");
        resolve({ success: false, error: 'Could not open bridge tab' });
        return;
      }

      const bridgeTabId = bridgeTab.id;
      let resolved = false;

      function cleanup() {
        chrome.runtime.onMessage.removeListener(bridgeListener);
        chrome.tabs.remove(bridgeTabId).catch(() => {});
      }

      function bridgeListener(msg) {
        if (resolved) return;
        if (msg.type === 'COBALT_BRIDGE_SUCCESS' && msg.url) {
          resolved = true;
          cleanup();
          chrome.downloads.download({
            url: msg.url,
            filename: msg.filename || `video_${Date.now()}.mp4`
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              if (tabId) showToast(tabId, "Error al iniciar la descarga.");
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              if (tabId) showToast(tabId, "✅ Descarga iniciada (cobalt bridge).");
              resolve({ success: true, downloadId });
            }
          });
        } else if (msg.type === 'COBALT_BRIDGE_FAILED') {
          resolved = true;
          cleanup();
          // Last resort: open cobalt.tools visibly so user can download manually
          if (tabId) showToast(tabId, "Abriendo cobalt.tools para descarga manual...");
          chrome.tabs.create({ url: `https://cobalt.tools/#${encodeURIComponent(videoUrl)}` });
          resolve({ success: true, openedTab: true });
        }
      }

      chrome.runtime.onMessage.addListener(bridgeListener);

      // Hard timeout – 45 seconds
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        if (tabId) showToast(tabId, "Tiempo agotado. Abriendo cobalt.tools...");
        chrome.tabs.create({ url: `https://cobalt.tools/#${encodeURIComponent(videoUrl)}` });
        resolve({ success: true, openedTab: true });
      }, 45000);
    });
  });
}

async function getRecentVideoDownloads() {
  return new Promise((resolve) => {
    chrome.downloads.search({
      limit: 100,
      orderBy: ['-startTime'],
      state: 'complete',
      exists: true
    }, (items) => {
      const filtered = [];
      items.forEach(item => {
        if (item.exists === false) {
          chrome.downloads.erase({ id: item.id });
          return;
        }
        const isVideo = item.mime && item.mime.startsWith('video/');
        const hasVideoExt = /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(item.filename);
        if (isVideo || hasVideoExt) {
          filtered.push({
            id: item.id,
            url: item.url,
            filename: item.filename.split(/[\\/]/).pop(),
            timestamp: new Date(item.startTime).getTime()
          });
        }
      });
      resolve(filtered);
    });
  });
}

function showToast(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, {
    type: 'SHOW_TOAST',
    message: message
  }).catch((err) => {
    console.log("No se pudo enviar mensaje de toast al tab", tabId, err);
  });
}
