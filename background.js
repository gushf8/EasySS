// background.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_RECENT_DOWNLOADS') {
    getRecentImageDownloads().then(sendResponse);
    return true; // Keep channel open for async response
  }
});

async function getRecentImageDownloads() {
  return new Promise((resolve) => {
    // Search for images in downloads
    chrome.downloads.search({
      limit: 10,
      orderBy: ['-startTime'],
      state: 'complete'
    }, (items) => {
      const imageItems = items
        .filter(item => {
          // Filter by MIME type or extension
          const isImage = item.mime && item.mime.startsWith('image/');
          const hasImageExt = /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(item.filename);
          return isImage || hasImageExt;
        })
        .map(item => ({
          id: item.id,
          url: item.url,
          filename: item.filename.split(/[\\/]/).pop(), // Get just the name
          mime: item.mime,
          timestamp: new Date(item.startTime).getTime()
        }));
      
      resolve(imageItems.slice(0, 5)); // Return top 5
    });
  });
}
