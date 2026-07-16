// cobalt_bridge_main.js
// Runs in MAIN world on cobalt.tools
// Intercepts cobalt's own internal fetch/XHR to capture the CDN download URL
// and relays it back to the extension via postMessage → isolated world → background

(function () {
  // Only activate when the extension triggered this page
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#easyssdl:')) return;

  const targetVideoUrl = decodeURIComponent(hash.slice('#easyssdl:'.length));
  if (!targetVideoUrl) return;

  // ── 1. Intercept fetch ─────────────────────────────────────────────────────
  const _originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);

    try {
      const clone = response.clone();
      // Only parse JSON responses
      const ct = response.headers.get('Content-Type') || '';
      if (ct.includes('application/json') || ct.includes('text/json') || ct.includes('json')) {
        clone.json().then((data) => {
          if (data && typeof data === 'object') {
            // Cobalt API response has { status, url } or { url }
            const dlUrl = data.url || (data.picker && data.picker[0] && data.picker[0].url);
            if (dlUrl && typeof dlUrl === 'string' && dlUrl.startsWith('http')) {
              window.postMessage({
                type: '__EASYSSDL_RESULT__',
                downloadUrl: dlUrl,
                filename: data.filename || data.audioFilename || ''
              }, '*');
            }
          }
        }).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  // ── 2. Intercept XMLHttpRequest (fallback) ─────────────────────────────────
  const _originalXHROpen = XMLHttpRequest.prototype.open;
  const _originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this.__easyssdl_url = args[1];
    return _originalXHROpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const data = JSON.parse(this.responseText);
        if (data && typeof data === 'object') {
          const dlUrl = data.url || (data.picker && data.picker[0] && data.picker[0].url);
          if (dlUrl && typeof dlUrl === 'string' && dlUrl.startsWith('http')) {
            window.postMessage({
              type: '__EASYSSDL_RESULT__',
              downloadUrl: dlUrl,
              filename: data.filename || ''
            }, '*');
          }
        }
      } catch (_) {}
    });
    return _originalXHRSend.apply(this, args);
  };

  // ── 3. Auto-fill input and submit ─────────────────────────────────────────
  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                   Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findInput() {
    const selectors = [
      'input[type="url"]',
      'input[name="url"]',
      'input[id*="link"]',
      'input[id*="url"]',
      'input[class*="link"]',
      'input[class*="url"]',
      'input[class*="input"]',
      'input[placeholder]',
      'input[type="text"]',
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findSubmitButton() {
    // Try direct submit button
    const direct = document.querySelector('button[type="submit"], input[type="submit"]');
    if (direct && !direct.disabled) return direct;

    // Try buttons with matching text
    const allBtns = Array.from(document.querySelectorAll('button'));
    const match = allBtns.find(b => {
      if (b.disabled) return false;
      const txt = (b.textContent || b.ariaLabel || b.title || '').toLowerCase();
      return txt.match(/get|download|descarg|continue|go|start|fetch|submit|⬇|↓|▶/);
    });
    if (match) return match;

    // Fallback: first non-disabled button
    return allBtns.find(b => !b.disabled);
  }

  function fillAndSubmit() {
    const input = findInput();
    if (!input) return false;

    setNativeValue(input, targetVideoUrl);
    input.focus();

    // Small delay to let reactive framework process the input
    setTimeout(() => {
      const btn = findSubmitButton();
      if (btn) {
        btn.click();
      } else {
        // Press Enter in the input as fallback
        ['keydown', 'keypress', 'keyup'].forEach(evtType => {
          input.dispatchEvent(new KeyboardEvent(evtType, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
          }));
        });
      }
    }, 800);

    return true;
  }

  // Wait for DOM and try to fill/submit
  function init() {
    if (!fillAndSubmit()) {
      // If input not found yet, observe DOM for it
      const observer = new MutationObserver(() => {
        if (fillAndSubmit()) observer.disconnect();
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      // Give up observing after 10 seconds
      setTimeout(() => observer.disconnect(), 10000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  } else {
    setTimeout(init, 600);
  }
})();
