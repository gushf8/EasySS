// offscreen.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'READ_CLIPBOARD_OFFSCREEN') {
    readClipboard();
  }
});

async function readClipboard() {
  try {
    // navigator.clipboard.read() can be very finicky in offscreen documents.
    // We'll use the 'paste' event listener trick which is often more reliable
    // in extension contexts when we have 'clipboardRead' permission.
    
    const textArea = document.createElement('textarea');
    document.body.appendChild(textArea);
    textArea.focus();
    
    // Attempt to read via navigator.clipboard first
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          broadcastBlob(blob);
          document.body.removeChild(textArea);
          return;
        }
      }
    } catch (e) {
      console.log("Offscreen: navigator.clipboard failed, trying execCommand");
    }

    // Fallback: execCommand('paste') - requires a listener
    const pasteHandler = (e) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          broadcastBlob(blob);
          break;
        }
      }
    };

    document.addEventListener('paste', pasteHandler, { once: true });
    document.execCommand('paste');
    document.removeEventListener('paste', pasteHandler);
    
    document.body.removeChild(textArea);
  } catch (err) {
    console.log('Offscreen clipboard total failure:', err.message);
  }
}

function broadcastBlob(blob) {
  const reader = new FileReader();
  reader.onloadend = () => {
    chrome.runtime.sendMessage({
      type: 'CLIPBOARD_DATA_FROM_OFFSCREEN',
      dataUrl: reader.result
    });
  };
  reader.readAsDataURL(blob);
}
