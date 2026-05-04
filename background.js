// background.js
let lastRightClickedImageUrl = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "captureImage",
    title: "Capturar imagen con EasySS",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "captureImage") {
    const url = info.srcUrl || lastRightClickedImageUrl;
    if (url) {
      fetchImageAsDataUrl(url).then(dataUrl => {
        if (dataUrl) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'IMAGE_CAPTURED_CONTEXT_MENU',
            dataUrl: dataUrl,
            srcUrl: url
          }).catch(err => console.log("Tab not ready for message", err));
        }
      });
    }
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
    fetchImageAsDataUrl(message.url).then(dataUrl => {
      if (dataUrl) {
        chrome.storage.local.set({ 
          preemptiveImage: {
            dataUrl: dataUrl,
            timestamp: Date.now(),
            url: message.url
          }
        });
        // Broadcast to any open modal
        chrome.runtime.sendMessage({
          type: 'EXTERNAL_IMAGE_CAPTURED',
          dataUrl: dataUrl
        }).catch(() => {}); // No one listening is fine
      }
    });
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
  if (message.type === 'ERASE_DOWNLOAD') {
    chrome.downloads.erase({ id: message.id }, () => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'SHOW_DOWNLOAD') {
    chrome.downloads.show(message.id);
    return;
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
      dataUrl: dataUrl
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
    console.error("Background: Failed to handle universal clipboard", err);
  }
}

async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: 'Leer el portapapeles universalmente independientemente de la pestaña activa.'
  });
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
          if (isImg || hasImgExt) {
            filtered.push({
              id: item.id,
              url: item.url,
              filename: item.filename.split(/[\\/]/).pop(),
              timestamp: new Date(item.startTime).getTime()
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
