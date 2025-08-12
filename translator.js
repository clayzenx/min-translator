// ==UserScript==
// @name         Min Translator with Anki and Unsplash
// @match        *://*/*
// @run-at       document-end
// ==/UserScript==

(function () {
  const LIBRE_TRANSLATE_URL = 'http://127.0.0.1:5000/translate';
  const UNSPLASH_API_URL = 'https://api.unsplash.com';
  const ANKI_API_URL = 'http://127.0.0.1:8765';

  // TODO: Change to your own Unsplash API key here
  const UNSPLASH_API_KEY = '';
  // TODO: Change to your target language here
  const TARGET_LANG = 'ru';

  let ankiAvailable = false;

  // Minimal compact flat design for popup
  const popupStyles = {
    container: {
      position: 'absolute',
      background: '#222',
      color: '#eee',
      padding: '8px',
      border: '1px solid #444',
      borderRadius: '4px',
      zIndex: 99999,
      maxWidth: '260px',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,0.7)',
      pointerEvents: 'auto',
    },
    title: {
      margin: '0 0 4px',
      fontSize: '13px',
      fontWeight: '600',
      color: '#fff',
    },
    // unused: replaced by divider
    altTitle: {},
    altItem: {
      padding: '2px 0',
      fontSize: '12px',
      color: '#ddd',
      cursor: 'pointer',
    },
    button: {
      display: 'block',
      width: '100%',
      margin: '0',
      padding: '6px 0',
      background: 'transparent',
      color: '#1e90ff',
      border: 'none',
      borderRadius: '0',
      cursor: 'pointer',
      fontSize: '12px',
      textAlign: 'center',
    },
    divider: {
      border: 'none',
      height: '1px',
      background: '#444',
      margin: '6px 0',
    },
  };

  // track current popup timeout and click handler for cleanup
  let popupTimeoutId = null;
  let clickHandler = null;

  const applyStyles = (el, styles) => Object.assign(el.style, styles);

  const fetchJSON = async (url, options) => {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return res.json();
  };

  async function checkAnkiConnection() {
    try {
      const data = await fetchJSON(ANKI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'version' }),
      });
      const version = Number(data);
      ankiAvailable = Number.isInteger(version) && version > 0;
    } catch {
      console.warn('AnkiConnect not available');
      ankiAvailable = false;
    }
  }

  async function translateText(text) {
    try {
      const data = await fetchJSON(LIBRE_TRANSLATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: 'auto',
          target: TARGET_LANG,
          format: 'text',
          alternatives: 4,
        }),
      });
      return { translated: data.translatedText || 'Translation error', alternatives: data.alternatives || [] };
    } catch {
      return { translated: 'Translation request error', alternatives: [] };
    }
  }

  async function fetchUnsplashImage(query) {
    try {
      const data = await fetchJSON(
        `${UNSPLASH_API_URL}/search/photos?query=${encodeURIComponent(query)}&client_id=${UNSPLASH_API_KEY}&per_page=1&orientation=squarish&content_filter=high`
      );
      return data.results[0]?.urls?.regular || '';
    } catch {
      return '';
    }
  }

  function closePopup() {
    const popup = document.getElementById('min-translate-popup');
    if (popup) popup.remove();
    if (popupTimeoutId) {
      clearTimeout(popupTimeoutId);
      popupTimeoutId = null;
    }
    if (clickHandler) {
      document.removeEventListener('click', clickHandler);
      clickHandler = null;
    }
  }

  function createElement(tag, text, styles = {}) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    applyStyles(el, styles);
    return el;
  }

  async function createPopup(original, translated, alternatives, x, y) {
    closePopup();
    await checkAnkiConnection();

    const popup = createElement('div', null, popupStyles.container);
    popup.id = 'min-translate-popup';
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    const mainText = createElement('div', `[${TARGET_LANG}] ${translated}`, popupStyles.title);
    popup.appendChild(mainText);
    if (ankiAvailable) {
      mainText.style.cursor = 'pointer';
      mainText.addEventListener('click', () => {
        addToAnki(original, translated, alternatives);
        closePopup();
      });
    }

    if (alternatives.length) {
      // insert a divider line before alternatives
      const divider = document.createElement('hr');
      applyStyles(divider, popupStyles.divider);
      popup.appendChild(divider);

      alternatives.forEach((alt) => {
        const altItem = createElement('div', alt, popupStyles.altItem);
        if (ankiAvailable) {
          altItem.style.cursor = 'pointer';
          altItem.addEventListener('click', () => {
            addToAnki(original, alt, alternatives.filter((a) => a !== alt));
            closePopup();
          });
        }
        popup.appendChild(altItem);
      });
    }

    if (ankiAvailable) {
      // divider before the action button
      const hr = document.createElement('hr');
      applyStyles(hr, popupStyles.divider);
      popup.appendChild(hr);
      const btn = createElement('button', 'Add to Anki', popupStyles.button);
      btn.addEventListener('click', () => {
        addToAnki(original, translated, alternatives);
        closePopup();
      });
      popup.appendChild(btn);
    }

    document.body.appendChild(popup);

    // click outside to close
    clickHandler = (e) => {
      if (!popup.contains(e.target)) {
        closePopup();
      }
    };
    document.addEventListener('click', clickHandler);
    // auto close after 15s
    popupTimeoutId = setTimeout(closePopup, 15000);
  }

  async function addToAnki(original, mainTranslation, alternatives) {
    const altHtml = alternatives.length
      ? `<br>Альтернативы:<br><ul>${alternatives.map((alt) => `<li>${alt}</li>`).join('')}</ul>`
      : '';
    const back = `Превод: <strong>${mainTranslation}</strong>${altHtml}`;
    const imageURL = await fetchUnsplashImage(original);

    try {
      const data = await fetchJSON(ANKI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addNote',
          version: 6,
          params: {
            note: {
              deckName: 'Default',
              modelName: 'Basic',
              fields: { Front: original, Back: back, Description: altHtml, IMGurl: imageURL },
              options: { allowDuplicate: false, duplicateScope: 'deck' },
              tags: ['min-translator'],
            },
          },
        }),
      });
      if (data.error) console.error('Anki error:', data.error);
      else {
        console.info('Card added to Anki');
        closePopup();
      }
    } catch (e) {
      console.error('Anki error:', e.message);
    }
  }

  function getSelectionPosition() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY };
  }

  function handleTranslateEvent(e) {
    const selection = window.getSelection().toString().trim();
    if (!selection) return;
    let pos = null;
    if (e.type === 'dblclick') pos = { x: e.pageX + 10, y: e.pageY + 20 };
    else if (e.type === 'mouseup' && e.altKey) {
      const p = getSelectionPosition();
      if (p) pos = { x: p.x + 10, y: p.y + 20 };
    }
    if (!pos) return;
    translateText(selection).then(({ translated, alternatives }) => {
      createPopup(selection, translated, alternatives, pos.x, pos.y);
    });
  }

  document.addEventListener('dblclick', handleTranslateEvent);
  document.addEventListener('mouseup', handleTranslateEvent);
})();
