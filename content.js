// content.js
let currentDomInput = null;
let currentProgrammaticInputId = null;
let modalIframe = null;
let ignoreNextDomClick = false;
let isModalOpen = false;
let lastActiveElement = null;
let lastFallbackTime = 0;
const FALLBACK_COOLDOWN = 2000;

function isContextInvalid() {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
      return true;
    }
    const id = chrome.runtime.id;
    if (!id) return true;
    chrome.runtime.getURL(''); // Dummy call to trigger error if context is dead
    return false;
  } catch (e) {
    return true;
  }
}

let lastRightClickedImageUrl = null;
let lastCapturedTime = 0;
const handleCaptureEvent = (e) => {
  const isRightClick = e.type === 'contextmenu' || (e.type === 'mousedown' && e.button === 2);
  if (!isRightClick) return;

  // Prevent double-triggering when both mousedown and contextmenu fire on a single right-click
  const now = Date.now();
  if (now - lastCapturedTime < 150) return;
  lastCapturedTime = now;

  const elements = document.elementsFromPoint(e.clientX, e.clientY);
  for (const el of elements) {
    let url = null;
    if (el.tagName === 'IMG' && el.src) {
      url = el.src;
    } else if (el.tagName === 'VIDEO') {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = el.videoWidth || el.clientWidth || 640;
        canvas.height = el.videoHeight || el.clientHeight || 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL('image/png');
      } catch (err) {
        console.warn("EasySS: Could not capture frame from video", err);
      }
    } else {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        const match = bg.match(/url\("?(.*?)"?\)/);
        if (match) url = match[1];
      }
    }

    if (url) {
      lastRightClickedImageUrl = url;
      if (!isContextInvalid()) {
        try {
          chrome.runtime.sendMessage({ 
            type: 'PREEMPTIVE_CAPTURE', 
            url: url,
            source: 'Copiado'
          }).catch(() => {});
        } catch (e) {}
      }
      
      // If modal is open, send it directly too
      if (modalIframe) {
        modalIframe.contentWindow.postMessage({
          type: 'EXTERNAL_IMAGE_CAPTURED',
          dataUrl: url,
          source: 'Copiado'
        }, '*');
      }
      return;
    }
  }
};

window.addEventListener('contextmenu', handleCaptureEvent, true);
window.addEventListener('mousedown', handleCaptureEvent, true);

// Clipboard reading is now handled only by the modal to avoid permission prompts on the host page

let lastShiftTime = 0;
let configuredShortcutKey = 'CtrlShift';

// Initial load of shortcut
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get('shortcutKey', (data) => {
    if (data.shortcutKey) configuredShortcutKey = data.shortcutKey;
  });

  // Keep in sync
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.shortcutKey) configuredShortcutKey = changes.shortcutKey.newValue;
  });
}

let ctrlPressed = false;
let shiftPressed = false;
let otherKeyPressed = false;

window.addEventListener('keydown', (e) => {
  if (configuredShortcutKey === 'None') return;
  if (e.key === 'Control') ctrlPressed = true;
  if (e.key === 'Shift') shiftPressed = true;
  if (e.key !== 'Control' && e.key !== 'Shift') {
    otherKeyPressed = true;
  }
}, true);

window.addEventListener('keyup', (e) => {
  if (configuredShortcutKey === 'None') return;

  if (e.key === 'Control') {
    if (ctrlPressed && shiftPressed && !otherKeyPressed) {
      openModal();
    }
    ctrlPressed = false;
  }
  if (e.key === 'Shift') {
    if (ctrlPressed && shiftPressed && !otherKeyPressed) {
      openModal();
    }
    shiftPressed = false;
  }
  if (!ctrlPressed && !shiftPressed) {
    otherKeyPressed = false;
  }
}, true);

// Notify background when window regains focus or visibility (to detect new screenshots universally)
function triggerUniversalRefresh() {
  if (isModalOpen && !isContextInvalid()) {
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_CLIPBOARD_UNIVERSAL' }).catch(() => {});
    } catch (e) {}
    if (modalIframe && modalIframe.contentWindow) {
      modalIframe.contentWindow.postMessage({ type: 'FOCUS_MODAL' }, '*');
    }
  }
}

window.addEventListener('focus', triggerUniversalRefresh, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') triggerUniversalRefresh();
});

// --- 1. LISTEN FOR PROGRAMMATIC CLICKS FROM MAIN_WORLD.JS ---
window.addEventListener('message', function(e) {
  if (!e.data || e.data.source !== 'EASYSS_PAGE_SCRIPT') return;
  if (isContextInvalid()) return;
  
  if (e.data.type === 'CLICK_INTERCEPTED') {
    if (Date.now() - lastFallbackTime < FALLBACK_COOLDOWN) return;
    openModal(null, e.data.inputId);
  }
});

// --- 3. LISTEN FOR REAL DOM CLICKS ---
document.addEventListener('click', function(e) {
  let target = e.target;
  while (target && target !== document) {
    if (target.tagName === 'INPUT' && target.type === 'file') {
      if (ignoreNextDomClick) {
        ignoreNextDomClick = false;
        return; // Allow default behavior
      }

      if (Date.now() - lastFallbackTime < FALLBACK_COOLDOWN) return;
      
      e.preventDefault();
      openModal(target);
      return;
    }
    target = target.parentNode;
  }
}, true); // Use capture phase to intercept early

// --- 3b. PREVENT PASTE LEAKAGE TO PAGE ---
document.addEventListener('paste', function(e) {
  if (modalIframe) {
    let hasImage = false;
    const clipboardData = e.clipboardData || window.clipboardData;
    
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (const file of clipboardData.files) {
        if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i)) {
          hasImage = true;
          break;
        }
      }
    }
    
    if (!hasImage && clipboardData.items) {
      for (const item of clipboardData.items) {
        if (item.type.indexOf('image') !== -1) {
          hasImage = true;
          break;
        }
      }
    }

    if (hasImage) {
      e.preventDefault();
      e.stopPropagation();
      modalIframe.focus();
    }
  }
}, true);


function openModal(input = null, programmaticId = null) {
  if (isContextInvalid()) {
    console.log("EasySS: Context invalidated. Please refresh the page to use the extension.");
    return;
  }
  if (modalIframe) return;
  
  currentDomInput = input;
  currentProgrammaticInputId = programmaticId;
  isModalOpen = true;
  
  // Remember what was focused before opening the modal (for Ctrl + Shift paste)
  lastActiveElement = document.activeElement;

  modalIframe = document.createElement('iframe');
  const hasTarget = (input || programmaticId) ? 'true' : 'false';
  modalIframe.src = chrome.runtime.getURL(`modal.html?hasTarget=${hasTarget}`);
  modalIframe.id = 'easyss-extension-modal-iframe';
  
  // Use Popover API to guarantee top layer rendering above native dialogs
  if ('popover' in HTMLElement.prototype) {
    modalIframe.setAttribute('popover', 'manual');
  }
  
  // Important: allow clipboard access in the iframe
  modalIframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  
  modalIframe.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    border: none !important;
    background: transparent !important;
    color-scheme: light !important;
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    transition: opacity 0.3s ease !important;
  `;
  
  document.documentElement.appendChild(modalIframe);
  
  // Actually move it to the Top Layer
  if (modalIframe.showPopover) {
    try {
      modalIframe.showPopover();
    } catch(e) {
      console.log("EasySS: Failed to show popover", e);
    }
  }
  
  setTimeout(() => {
    if (modalIframe) {
      modalIframe.focus();
      modalIframe.contentWindow.postMessage({ type: 'FOCUS_MODAL' }, '*');
      // Trigger universal refresh immediately when opening
      chrome.runtime.sendMessage({ type: 'REFRESH_CLIPBOARD_UNIVERSAL' }).catch(() => {});
    }
  }, 100);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'IMAGE_CAPTURED_CONTEXT_MENU') {
    if (isModalOpen && modalIframe) {
      modalIframe.contentWindow.postMessage({
        type: 'EXTERNAL_IMAGE_CAPTURED',
        dataUrl: message.dataUrl
      }, '*');
    } else {
      openModal();
      setTimeout(() => {
        if (modalIframe) {
          modalIframe.contentWindow.postMessage({
            type: 'EXTERNAL_IMAGE_CAPTURED',
            dataUrl: message.dataUrl
          }, '*');
        }
      }, 1000);
    }
  } else if (message.type === 'OPEN_MODAL_MANUAL') {
    openModal();
  } else if (message.type === 'SHOW_TOAST') {
    showContentToast(message.message);
  }
});

window.addEventListener('message', function(e) {
  if (!e.data || e.data.source !== 'EASYSS_EXTENSION') return;
  
  if (e.data.type === 'CLOSE_MODAL') {
    if (currentProgrammaticInputId) {
      // Send to main world script
      window.postMessage({
        source: 'EASYSS_CONTENT_SCRIPT',
        action: 'CANCEL',
        inputId: currentProgrammaticInputId
      }, '*');
    }
    closeModal();
  } else if (e.data.type === 'FILE_SELECTED') {
    if (currentProgrammaticInputId) {
      // Send to main world script
      window.postMessage({
        source: 'EASYSS_CONTENT_SCRIPT',
        action: 'FILE_SELECTED',
        inputId: currentProgrammaticInputId,
        dataUrl: e.data.dataUrl,
        filename: e.data.filename
      }, '*');
    } else if (currentDomInput) {
      try {
        const parts = e.data.dataUrl.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        
        const file = new File([blob], e.data.filename || 'screenshot.png', { type: mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        currentDomInput.files = dt.files;
        
        const eventChange = new Event('change', { bubbles: true });
        const eventInput = new Event('input', { bubbles: true });
        currentDomInput.dispatchEvent(eventInput);
        currentDomInput.dispatchEvent(eventChange);
        currentDomInput.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch (err) {
        console.error("EasySS: Error processing file", err);
      }
    } else {
      // Manual mode (Ctrl + Shift): Try to paste the file into the active element
      pasteFileToActiveElement(e.data.dataUrl, e.data.filename);
    }
    closeModal();
  } else if (e.data.type === 'OPEN_DEFAULT') {
    // Set global fallback state to prevent immediate re-interception
    ignoreNextDomClick = true;
    lastFallbackTime = Date.now();
    document.documentElement.dataset.easyssCooldown = "true";
    setTimeout(() => delete document.documentElement.dataset.easyssCooldown, FALLBACK_COOLDOWN);

    if (currentProgrammaticInputId) {
      window.postMessage({
        source: 'EASYSS_CONTENT_SCRIPT',
        action: 'OPEN_DEFAULT',
        inputId: currentProgrammaticInputId
      }, '*');
      closeModal();
    } else if (currentDomInput) {
      const input = currentDomInput;
      input.dataset.easyssIgnoreNext = "true";
      input.click();
      closeModal();
    } else {
      // No target input! Trigger the local file picker in the modal but HIDE the modal first
      if (modalIframe && modalIframe.contentWindow) {
        modalIframe.style.opacity = '0';
        modalIframe.style.pointerEvents = 'none';
        modalIframe.contentWindow.postMessage({ source: 'EASYSS_CONTENT_SCRIPT', type: 'TRIGGER_LOCAL_FILE_PICKER' }, '*');
      }
    }
  } else if (e.data.type === 'WRITE_CLIPBOARD_FROM_CONTENT') {
    writeClipboardFromContent(e.data.dataUrl);
  }
});

async function pasteFileToActiveElement(dataUrl, filename) {
  try {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    const blob = new Blob([u8arr], { type: mime });
    const file = new File([blob], filename || 'file.png', { type: mime });

    const isImage = mime.startsWith('image/');

    // 1. Write the image/text to the clipboard (so it is ready on Ctrl+V if auto-paste is ignored)
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        if (isImage) {
          const data = [new ClipboardItem({ 'image/png': blob })];
          await navigator.clipboard.write(data);
        } else {
          try {
            const data = [new ClipboardItem({ [mime]: blob })];
            await navigator.clipboard.write(data);
          } catch (err) {
            console.warn("Could not write document to clipboard as ClipboardItem:", err);
          }
        }
      } else {
        if (isImage) {
          chrome.runtime.sendMessage({ 
            type: 'WRITE_CLIPBOARD_REQUEST', 
            dataUrl: dataUrl 
          });
        }
      }
    } catch (clipErr) {
      console.warn("EasySS: Direct clipboard write failed during auto-paste, trying background:", clipErr);
      if (isImage) {
        chrome.runtime.sendMessage({ 
          type: 'WRITE_CLIPBOARD_REQUEST', 
          dataUrl: dataUrl 
        });
      }
    }

    // 2. Focus active element and post message to main world to dispatch paste event
    const activeEl = lastActiveElement || document.activeElement;
    if (activeEl) {
      if (activeEl.focus) activeEl.focus();
      
      window.postMessage({
        source: 'EASYSS_CONTENT_SCRIPT',
        action: 'PASTE_FILE',
        dataUrl: dataUrl,
        filename: filename || 'file.png'
      }, '*');
      console.log("EasySS: Requested main world to auto-paste file into active element");
    }
    
    // 4. Show content toast notifying the user (Removed as requested)
    // showContentToast(isImage ? "Imagen copiada. Puedes pegar con Ctrl + V." : "Documento listo para pegar. Puedes pegar con Ctrl + V.");
    
  } catch (err) {
    console.warn("EasySS: Error auto-pasting file", err);
  }
}

function showContentToast(message) {
  let container = document.getElementById('easyss-content-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'easyss-content-toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(15, 23, 42, 0.95);
    color: #f8fafc;
    padding: 12px 18px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    gap: 12px;
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  
  const isError = message.toLowerCase().includes('error') || message.toLowerCase().includes('falló') || message.toLowerCase().includes('solo se');
  const strokeColor = isError ? '#ef4444' : '#10b981';
  const fillColor = isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
  
  const icon = document.createElement('div');
  icon.style.display = 'flex';
  icon.style.alignItems = 'center';
  icon.style.justifyContent = 'center';
  icon.style.flexShrink = '0';
  
  if (isError) {
    icon.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" fill="${fillColor}"></circle>
        <line x1="12" x2="12" y1="8" y2="12"></line>
        <line x1="12" x2="12.01" y1="16" y2="16"></line>
      </svg>
    `;
  } else {
    // Premium lucide-like clipboard-check
    icon.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" fill="${fillColor}"></path>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        <path d="m9 14 2 2 4-4"></path>
      </svg>
    `;
  }
  toast.appendChild(icon);

  // Format keyboard shortcuts with premium kbd styling
  const kbdStyle = `
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-bottom: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 1.5px 5px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #ffffff;
    box-shadow: 0 1px 0 rgba(0,0,0,0.2);
    margin: 0 2px;
    font-weight: 600;
    vertical-align: middle;
  `;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPad|iPhone|iPod/.test(navigator.userAgent || navigator.platform);
  let htmlContent = message;
  
  if (htmlContent.includes("Ctrl + V")) {
    const shortcut = isMac 
      ? `<kbd style="${kbdStyle}">⌘ Cmd</kbd> + <kbd style="${kbdStyle}">V</kbd>` 
      : `<kbd style="${kbdStyle}">Ctrl</kbd> + <kbd style="${kbdStyle}">V</kbd>`;
    htmlContent = htmlContent.replace("Ctrl + V", shortcut);
  }

  const text = document.createElement('span');
  text.style.lineHeight = '1.4';
  text.innerHTML = htmlContent;
  toast.appendChild(text);

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    toast.style.transform = 'translateY(-20px)';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 4500);
}

function closeModal() {
  if (modalIframe) {
    if (modalIframe._focusHandler) {
      window.removeEventListener('blur', modalIframe._focusHandler);
    }
    modalIframe.remove();
    modalIframe = null;
  }
  isModalOpen = false;
  currentDomInput = null;
  currentProgrammaticInputId = null;
}

async function writeClipboardFromContent(dataUrl) {
  if (navigator.clipboard && navigator.clipboard.write) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const data = [new ClipboardItem({ 'image/png': blob })];
      await navigator.clipboard.write(data);
      if (!isContextInvalid()) {
        try {
          chrome.runtime.sendMessage({ type: 'CLIPBOARD_WRITE_SUCCESS' });
        } catch (e) {}
      }
      return;
    } catch (err) {
      console.warn("EasySS content script direct clipboard write failed, trying offscreen fallback:", err);
    }
  } else {
    console.warn("EasySS content script: navigator.clipboard.write not available, trying offscreen fallback.");
  }
  
  if (!isContextInvalid()) {
    try {
      // Fallback to background offscreen
      chrome.runtime.sendMessage({ 
        type: 'WRITE_CLIPBOARD_REQUEST', 
        dataUrl: dataUrl 
      });
    } catch (e) {}
  }
}
