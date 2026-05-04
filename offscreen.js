// offscreen.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'READ_CLIPBOARD_OFFSCREEN') {
    readClipboard();
  }
});

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
