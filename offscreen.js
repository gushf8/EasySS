// offscreen.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'READ_CLIPBOARD_OFFSCREEN') {
    readClipboard();
  } else if (message.type === 'WRITE_CLIPBOARD_OFFSCREEN') {
    writeToClipboard(message.dataUrl);
  }
});

async function writeToClipboard(dataUrl) {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const pngBlob = await convertToPng(blob);
    
    try {
      const data = [new ClipboardItem({ 'image/png': pngBlob })];
      await navigator.clipboard.write(data);
      chrome.runtime.sendMessage({ type: 'CLIPBOARD_WRITE_SUCCESS' });
      return;
    } catch (clipErr) {
      console.warn("navigator.clipboard.write failed in offscreen, trying execCommand fallback:", clipErr);
      
      // Fallback: document.execCommand('copy') using a selected <img> element
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.position = 'fixed';
      img.style.pointerEvents = 'none';
      img.style.opacity = '0';
      document.body.appendChild(img);
      
      const range = document.createRange();
      range.selectNode(img);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      
      const success = document.execCommand('copy');
      document.body.removeChild(img);
      selection.removeAllRanges();
      
      if (success) {
        chrome.runtime.sendMessage({ type: 'CLIPBOARD_WRITE_SUCCESS' });
        return;
      } else {
        throw new Error("execCommand copy returned false");
      }
    }
  } catch (err) {
    console.warn("Offscreen write failed:", err);
    chrome.runtime.sendMessage({ type: 'CLIPBOARD_WRITE_ERROR', error: err.message });
  }
}

async function convertToPng(blob) {
  if (blob.type === 'image/png') return blob;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((resultBlob) => {
          if (resultBlob) resolve(resultBlob);
          else reject(new Error('Canvas toBlob failed'));
          URL.revokeObjectURL(url);
        }, 'image/png');
      } catch (e) { reject(e); URL.revokeObjectURL(url); }
    };
    img.onerror = () => { reject(new Error('Failed to load image')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function readClipboard() {
  try {
    const pasteTarget = document.createElement('div');
    pasteTarget.contentEditable = 'true';
    document.body.appendChild(pasteTarget);
    pasteTarget.focus();
    
    let imageFound = false;

    // Attempt to read via navigator.clipboard first
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          try {
            const blob = await item.getType(imageType);
            if (blob && blob.size > 0) {
              broadcastBlob(blob);
              imageFound = true;
              break;
            }
          } catch(e) {
            console.log("Offscreen: failed to get blob for", imageType, e);
          }
        }
      }
    } catch (e) {
      console.log("Offscreen: navigator.clipboard failed or not focused", e);
    }

    if (!imageFound) {
      // Fallback: execCommand('paste') - requires a listener
      const pastePromise = new Promise(resolve => {
        const pasteHandler = (e) => {
          let found = false;
          
          // 1. Check for files (handles Word images and Windows Explorer file copies)
          if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            for (const file of e.clipboardData.files) {
              if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i)) {
                broadcastBlob(file);
                found = true;
                break;
              }
            }
          }
          
          // 2. Check for items
          if (!found && e.clipboardData.items) {
            for (const item of e.clipboardData.items) {
              if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                if (blob && blob.size > 0) {
                  broadcastBlob(blob);
                  found = true;
                  break;
                }
              }
            }
          }

          // 3. Check for HTML base64 images as a last resort
          if (!found) {
            const html = e.clipboardData.getData('text/html');
            if (html) {
              const match = html.match(/src="(data:image\/[^;]+;base64,[^"]+)"/i);
              if (match) {
                fetch(match[1])
                  .then(res => res.blob())
                  .then(blob => {
                    broadcastBlob(blob);
                  }).catch(err => console.log("Failed to fetch base64 from html", err));
                found = true; // Resolve early, broadcast will happen async
              }
            }
          }

          resolve(found);
        };

        document.addEventListener('paste', pasteHandler, { once: true });
        document.execCommand('paste');
        // Clean up if paste event never fires
        setTimeout(() => {
          document.removeEventListener('paste', pasteHandler);
          resolve(false);
        }, 100);
      });

      await pastePromise;
    }
    
    document.body.removeChild(pasteTarget);
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
