export const FREE_ORIGIN = 'https://api.mymemory.translated.net/*';
export const DEFAULT_ENGINE = Object.freeze({provider: 'mymemory', source: 'en', target: 'zh-CN'});
export const LANGUAGE_CODES = Object.freeze(['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'hi', 'id', 'vi', 'th', 'tr', 'nl', 'pl', 'uk', 'sv', 'el', 'he', 'fa', 'bn', 'ms', 'ro', 'cs', 'da', 'fi']);
export const supportsAutoSource = provider => ['google-web', 'google', 'youdao', 'microsoft', 'libre-local', 'baidu', 'ai'].includes(provider);
export const isValidMyMemoryEmail = value => !value || (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

export function normalizeEngine(engine, hasModel = false) {
  const input = engine && typeof engine === 'object' ? engine : {};
  const provider = ['mymemory', 'google-web', 'google', 'youdao', 'microsoft', 'libre-local', 'baidu', 'ai'].includes(input.provider) ? input.provider : (hasModel ? 'ai' : 'mymemory');
  return {
    provider,
    source: LANGUAGE_CODES.includes(input.source) || (input.source === 'auto' && supportsAutoSource(provider)) ? input.source : DEFAULT_ENGINE.source,
    target: LANGUAGE_CODES.includes(input.target) ? input.target : DEFAULT_ENGINE.target
  };
}

// MyMemory accepts a maximum of 500 UTF-8 bytes per segment.
export function splitSegments(text, maxBytes = 500) {
  const encoder = new TextEncoder();
  const result = [];
  let chunk = '';
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (size > maxBytes) throw new Error('Segment byte limit is too small.');
    while (bytes + size > maxBytes) {
      const boundary = Math.max(chunk.lastIndexOf(' '), chunk.lastIndexOf('。'), chunk.lastIndexOf('！'), chunk.lastIndexOf('？'), chunk.lastIndexOf('.')) + 1;
      const cut = boundary > chunk.length / 2 ? boundary : chunk.length;
      result.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
      bytes = encoder.encode(chunk).length;
    }
    chunk += char;
    bytes += size;
  }
  if (chunk) result.push(chunk);
  return result;
}

export function decodeEntities(text) {
  const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'"};
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    if (entity[0] !== '#') return match;
    const value = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : match;
  });
}

export async function translateFree(entries, engine, fetcher = fetch, {email = ''} = {}) {
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const contact = String(email || '').trim();
  if (!isValidMyMemoryEmail(contact)) throw new Error('Invalid MyMemory email. Check the address in Settings.');
  const translations = {};
  for (const entry of entries) {
    const results = [];
    for (const segment of splitSegments(entry.text)) {
      if (!segment.trim()) { results.push(segment); continue; }
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', segment);
      url.searchParams.set('langpair', `${engine.source}|${engine.target}`);
      if (contact) url.searchParams.set('de', contact);
      const response = await fetcher(url.href, {signal: AbortSignal.timeout(27000)});
      if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
      const data = await response.json();
      if (data.quotaFinished || Number(data.responseStatus) !== 200) {
        throw new Error(`MyMemory: ${String(data.responseDetails || 'translation unavailable or quota exceeded').slice(0, 200)}`);
      }
      if (typeof data.responseData?.translatedText !== 'string' || !data.responseData.translatedText.trim()) {
        throw new Error('MyMemory returned an empty translation.');
      }
      results.push(decodeEntities(data.responseData.translatedText));
    }
    translations[entry.id] = results.join(['zh-CN', 'zh-TW', 'ja'].includes(engine.target) ? '' : ' ');
  }
  return translations;
}
