// main_world.js
(function() {
  // Force fallback to <input type="file"> by hiding File System Access API
  if (window.showOpenFilePicker) {
    try { window.showOpenFilePicker = undefined; } catch(e) {}
  }

  const originalInputClick = HTMLInputElement.prototype.click;
  const originalHtmlClick = HTMLElement.prototype.click;
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  
  const inputMap = new Map();
  let nextInputId = 1;

  function interceptClick(element) {
    if (element && element.tagName === 'INPUT' && element.type === 'file') {
      if (element.dataset.easyssIgnoreNext === "true") {
        element.dataset.easyssIgnoreNext = "false";
        return false;
      }

      if (document.documentElement.dataset.easyssCooldown === "true") {
        return false;
      }

      const inputId = nextInputId++;
      inputMap.set(inputId, element);
      
      window.postMessage({
        source: 'EASYSS_PAGE_SCRIPT',
        type: 'CLICK_INTERCEPTED',
        inputId: inputId,
        accept: element.accept
      }, '*');
      
      return true; 
    }
    return false;
  }
  
  if (originalInputClick) {
    HTMLInputElement.prototype.click = function() {
      if (interceptClick(this)) return;
      return originalInputClick.apply(this, arguments);
    };
  }

  if (originalHtmlClick) {
    HTMLElement.prototype.click = function() {
      if (interceptClick(this)) return;
      return originalHtmlClick.apply(this, arguments);
    };
  }

  if (originalDispatchEvent) {
    EventTarget.prototype.dispatchEvent = function(event) {
      if (event && event.type === 'click' && interceptClick(this)) {
        event.preventDefault();
        return originalDispatchEvent.apply(this, arguments);
      }
      return originalDispatchEvent.apply(this, arguments);
    };
  }

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.source !== 'EASYSS_CONTENT_SCRIPT') return;
    
    const data = e.data;
    
    if (data.action === 'PASTE_FILE') {
      try {
        const parts = data.dataUrl.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const file = new File([blob], data.filename || 'screenshot.png', { type: mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        
        const activeEl = document.activeElement;
        if (activeEl) {
          if (activeEl.focus) activeEl.focus();
          
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true
          });
          
          Object.defineProperty(pasteEvent, 'clipboardData', {
            value: dt,
            writable: false,
            configurable: true
          });
          
          activeEl.dispatchEvent(pasteEvent);
          console.log("EasySS: Dispatched main world paste event into", activeEl.tagName);
        }
      } catch (err) {
        console.error("EasySS: Error in main world PASTE_FILE", err);
      }
      return;
    }
    
    const input = inputMap.get(data.inputId);
    if (!input) return;
    
    if (data.action === 'OPEN_DEFAULT') {
      input.dataset.easyssIgnoreNext = "true";
      if (originalInputClick) {
        originalInputClick.call(input);
      } else if (originalHtmlClick) {
        originalHtmlClick.call(input);
      }
      inputMap.delete(data.inputId);
    } else if (data.action === 'FILE_SELECTED') {
      try {
        const parts = data.dataUrl.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        
        const file = new File([blob], data.filename || 'screenshot.png', { type: mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        inputMap.delete(data.inputId);
      } catch (err) {
        console.error("EasySS: Error converting dataUrl", err);
      }
    } else if (data.action === 'CANCEL') {
      inputMap.delete(data.inputId);
    }
  });

})();
