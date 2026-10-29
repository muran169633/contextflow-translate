import {splitSegments} from './free-translate.mjs';

// This endpoint is undocumented and can change or throttle without notice.
export const GOOGLE_WEB_ORIGIN = 'https://translate.googleapis.com/*';

export async function translateGoogleWeb(entries, engine, fetcher = fetch) {
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const translations = {};
  for (const entry of entries) {
    const output = [];
    for (const segment of splitSegments(entry.text, 1200)) {
      if (!segment.trim()) continue;
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', engine.source);
      url.searchParams.set('tl', engine.target);
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', segment);
      let response;
      try { response = await fetcher(url.href, {signal: AbortSignal.timeout(27000)}); }
      catch (error) {
        throw new Error(`Google Translate connection failed: ${String(error?.message || error).slice(0, 160)}. Check network access; this unofficial endpoint may be unavailable.`);
      }
      if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}; the unofficial endpoint may be unavailable or rate-limited.`);
      let data;
      try { data = await response.json(); }
      catch { throw new Error('Google Translate returned invalid data; the unofficial endpoint may have changed.'); }
      if (!Array.isArray(data?.[0]) || !data[0].length || data[0].some(part => !Array.isArray(part) || typeof part[0] !== 'string')) {
        throw new Error('Google Translate returned incomplete data; the unofficial endpoint may have changed.');
      }
      const text = data[0].map(part => part[0]).join('');
      if (!text.trim()) throw new Error('Google Translate returned an empty translation.');
      output.push(text.trim());
    }
    translations[entry.id] = output.join(['zh-CN', 'zh-TW', 'ja'].includes(engine.target) ? '' : ' ');
  }
  return translations;
}
