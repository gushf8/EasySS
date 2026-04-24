// content.js
let currentDomInput = null;
let currentProgrammaticInputId = null;
let modalIframe = null;
let ignoreNextDomClick = false;

// --- 1. LISTEN FOR PROGRAMMATIC CLICKS FROM MAIN_WORLD.JS ---
window.addEventListener('message', function(e) {
  if (!e.data || e.data.source !== 'EASYSS_PAGE_SCRIPT') return;
  
  if (e.data.type === 'CLICK_INTERCEPTED') {
    currentProgrammaticInputId = e.data.inputId;
    currentDomInput = null; // Clear DOM input just in case
    openModal();
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
      
      e.preventDefault();
      currentDomInput = target;
      currentProgrammaticInputId = null;
      openModal();
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


// --- 4. MODAL MANAGEMENT ---
function openModal() {
  if (modalIframe) return;
  
  modalIframe = document.createElement('iframe');
  modalIframe.src = chrome.runtime.getURL('modal.html');
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
  
  // Keep focus on the iframe
  const focusHandler = () => {
    if (modalIframe) modalIframe.focus();
  };
  window.addEventListener('blur', focusHandler);
  modalIframe._focusHandler = focusHandler;
  
  setTimeout(() => {
    if (modalIframe) {
      modalIframe.focus();
      modalIframe.contentWindow.postMessage({ type: 'FOCUS_MODAL' }, '*');
    }
  }, 100);
}

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
        
        const event = new Event('change', { bubbles: true });
        currentDomInput.dispatchEvent(event);
      } catch (err) {
        console.error("EasySS: Error processing file", err);
      }
    }
    closeModal();
  } else if (e.data.type === 'OPEN_DEFAULT') {
    if (currentProgrammaticInputId) {
      window.postMessage({
        source: 'EASYSS_CONTENT_SCRIPT',
        action: 'OPEN_DEFAULT',
        inputId: currentProgrammaticInputId
      }, '*');
    }
 else if (currentDomInput) {
      ignoreNextDomClick = true;
      currentDomInput.click();
    }
    closeModal();
  }
});

function closeModal() {
  if (modalIframe) {
    if (modalIframe._focusHandler) {
      window.removeEventListener('blur', modalIframe._focusHandler);
    }
    modalIframe.remove();
    modalIframe = null;
  }
  currentDomInput = null;
  currentProgrammaticInputId = null;
}
