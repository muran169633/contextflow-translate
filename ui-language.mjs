import {applyTranslations, resolveLanguage, translate} from './i18n.mjs';

export async function setupLanguage(onChange) {
  const select = document.getElementById('uiLanguage');
  const data = await chrome.storage.local.get('uiLanguage');
  let language = resolveLanguage(data.uiLanguage || navigator.language);
  function render(next) {
    language = resolveLanguage(next);
    select.value = language;
    applyTranslations(document, language);
    onChange?.(language);
  }
  select.addEventListener('change', async () => {
    const next = resolveLanguage(select.value);
    try {
      await chrome.storage.local.set({uiLanguage: next});
      render(next);
    } catch (error) {
      render(language);
      const message = document.getElementById('message');
      message.textContent = String(error?.message || error);
      message.className = 'message error';
    }
  });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.uiLanguage) render(changes.uiLanguage.newValue || navigator.language);
  });
  render(language);
  return () => language;
}

export {translate};
