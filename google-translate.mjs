import {decodeEntities} from './free-translate.mjs';

export const GOOGLE_TRANSLATE_ORIGIN = 'https://translation.googleapis.com/*';

export async function translateGoogle(entries, engine, apiKey, fetcher = fetch) {
  if (!String(apiKey || '').trim()) throw new Error('Google Cloud Translation API key is not configured.');
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const response = await fetcher('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim()},
    body: JSON.stringify({q: entries.map(entry => entry.text), ...(engine.source === 'auto' ? {} : {source: engine.source}), target: engine.target, format: 'text'}),
    signal: AbortSignal.timeout(27000)
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Google Cloud Translation returned invalid data (HTTP ${response.status}).`); }
  if (!response.ok) {
    const detail = String(data?.error?.message || '').slice(0, 180);
    throw new Error(`Google Cloud Translation HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const results = data?.data?.translations;
  if (!Array.isArray(results) || results.length !== entries.length || results.some(result => typeof result?.translatedText !== 'string' || !result.translatedText.trim())) {
    throw new Error('Google Cloud Translation returned incomplete results.');
  }
  return Object.fromEntries(entries.map((entry, index) => [entry.id, decodeEntities(results[index].translatedText)]));
}
