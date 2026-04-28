// content.js
let currentDomInput = null;
let currentProgrammaticInputId = null;
let modalIframe = null;
let ignoreNextDomClick = false;
let isModalOpen = false;
let lastFallbackTime = 0;
const FALLBACK_COOLDOWN = 2000;

function isContextInvalid() {
  return typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL;
}

let lastRightClickedImageUrl = null;
const handleCaptureEvent = (e) => {
  const isRightClick = e.type === 'contextmenu' || (e.type === 'mousedown' && e.button === 2);
  if (!isRightClick) return;

  const elements = document.elementsFromPoint(e.clientX, e.clientY);
  for (const el of elements) {
    let url = null;
    if (el.tagName === 'IMG' && el.src) {
      url = el.src;
    } else {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        const match = bg.match(/url\("?(.*?)"?\)/);
        if (match) url = match[1];
      }
    }

    if (url) {
      lastRightClickedImageUrl = url;
      chrome.runtime.sendMessage({ 
        type: 'PREEMPTIVE_CAPTURE', 
        url: url 
      }).catch(() => {});
      return;
    }
  }
};

window.addEventListener('contextmenu', handleCaptureEvent, true);
window.addEventListener('mousedown', handleCaptureEvent, true);

let lastShiftTime = 0;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    const now = Date.now();
    if (now - lastShiftTime < 350) { // 350ms for double click
      openModal(); // Manual mode
    }
    lastShiftTime = now;
  }
}, true); // Use window + capture phase for maximum priority



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
    const items = (e.clipboardData || window.clipboardData).items;
    let hasImage = false;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        hasImage = true;
        break;
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

  modalIframe = document.createElement('iframe');
  const hasTarget = (input || programmaticId) ? 'true' : 'false';
  modalIframe.src = chrome.runtime.getURL(`modal.html?hasTarget=${hasTarget}`);
  modalIframe.id = 'easyss-extension-modal-iframe';
  
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
  
  // Aggressive Focus Management for sites like WhatsApp/FB
  const focusInterval = setInterval(() => {
    if (modalIframe && isModalOpen) {
      modalIframe.focus();
      // Inform the modal to also try to gain focus internally
      modalIframe.contentWindow.postMessage({ type: 'FOCUS_MODAL' }, '*');
    } else {
      clearInterval(focusInterval);
    }
  }, 300);
  
  setTimeout(() => {
    if (modalIframe) {
      modalIframe.focus();
      modalIframe.contentWindow.postMessage({ type: 'FOCUS_MODAL' }, '*');
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
    }
 else if (currentDomInput) {
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
      // Manual mode (Double Shift): Try to paste the file into the active element
      pasteFileToActiveElement(e.data.dataUrl, e.data.filename);
    }
    closeModal();
  } else if (e.data.type === 'OPEN_DEFAULT') {
    if (currentProgrammaticInputId) {
      window.postMessage({
        source: 'EASYSS_CONTENT_SCRIPT',
        action: 'OPEN_DEFAULT',
        inputId: currentProgrammaticInputId
      }, '*');
      closeModal();
    } else if (currentDomInput) {
      const input = currentDomInput;
      // CRITICAL: Set this so main_world.js and content.js ignore the next click
      input.dataset.easyssIgnoreNext = "true";
      ignoreNextDomClick = true;
      lastFallbackTime = Date.now();
      document.documentElement.dataset.easyssCooldown = "true";
      setTimeout(() => delete document.documentElement.dataset.easyssCooldown, FALLBACK_COOLDOWN);
      
      // Trigger click IMMEDIATELY while the user gesture from the iframe message is still fresh
      input.click();
      closeModal();
    } else {
      // No target input! Trigger the local file picker in the modal but HIDE the modal first
      if (modalIframe && modalIframe.contentWindow) {
        lastFallbackTime = Date.now();
        document.documentElement.dataset.easyssCooldown = "true";
        setTimeout(() => delete document.documentElement.dataset.easyssCooldown, FALLBACK_COOLDOWN);

        modalIframe.style.opacity = '0';
        modalIframe.style.pointerEvents = 'none';
        modalIframe.contentWindow.postMessage({ source: 'EASYSS_CONTENT_SCRIPT', type: 'TRIGGER_LOCAL_FILE_PICKER' }, '*');
      }
    }
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

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    const activeEl = document.activeElement;
    if (activeEl) {
      // Dispatch a paste event which most modern web apps (WhatsApp, Discord, etc) listen to
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      activeEl.dispatchEvent(pasteEvent);
      console.log("EasySS: Attempted to auto-paste file into", activeEl.tagName);
    }
  } catch (err) {
    console.error("EasySS: Error auto-pasting file", err);
  }
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
