import {splitSegments} from './free-translate.mjs';

// This endpoint is undocumented and can change or throttle without notice.
export const GOOGLE_WEB_ORIGIN = 'https://translate.googleapis.com/*';
const MAX_BATCH_BYTES = 1200;
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting = [];

async function withRequestSlot(run, onFailure) {
  if (inFlight < MAX_IN_FLIGHT) inFlight++;
  else await new Promise(resolve => waiting.push(resolve));
  try { return await run(); }
  catch (error) { onFailure?.(error); throw error; }
  finally {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

function paragraphError(message) {
  const error = new Error(message);
  error.fatal = false;
  return error;
}

async function requestGoogle(text, engine, fetcher, shouldStart = () => true, onFailure) {
  return withRequestSlot(async () => {
    if (!shouldStart()) throw new Error('Translation request canceled after an earlier failure.');
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', engine.source);
    url.searchParams.set('tl', engine.target);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);
    let response;
    try { response = await fetcher(url.href, {signal: AbortSignal.timeout(27000)}); }
    catch (error) {
      throw new Error(`Google Translate connection failed: ${String(error?.message || error).slice(0, 160)}. Check network access; this unofficial endpoint may be unavailable.`);
    }
    if (!response.ok) {
      const message = `Google Translate HTTP ${response.status}; the unofficial endpoint may be unavailable or rate-limited.`;
      if ([400, 413, 414, 422].includes(response.status)) throw paragraphError(message);
      throw new Error(message);
    }
    let data;
    try { data = await response.json(); }
    catch { throw paragraphError('Google Translate returned invalid data; the unofficial endpoint may have changed.'); }
    if (!Array.isArray(data?.[0]) || !data[0].length || data[0].some(part => !Array.isArray(part) || typeof part[0] !== 'string')) {
      throw paragraphError('Google Translate returned incomplete data; the unofficial endpoint may have changed.');
    }
    const translated = data[0].map(part => part[0]).join('');
    if (!translated.trim()) throw paragraphError('Google Translate returned an empty translation.');
    const original = data[0].every(part => typeof part[1] === 'string') ? data[0].map(part => part[1]).join('') : null;
    return {translated, original};
  }, onFailure);
}

export async function translateGoogleWeb(entries, engine, fetcher = fetch) {
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const translations = {};
  const encoder = new TextEncoder();
  // 仅在原文与译文段落边界可核对时采用批量结果，避免错贴译文。
  const joined = entries.map(entry => entry.text).join('\n\n');
  if (engine.source !== 'auto' && entries.length > 1 && entries.every(entry => !/[\r\n]/.test(entry.text)) && encoder.encode(joined).length <= MAX_BATCH_BYTES) {
    const result = await requestGoogle(joined, engine, fetcher);
    const parts = result.translated.split(/\n[ \t]*\n/);
    if (result.original === joined && parts.length === entries.length && parts.every(part => part.trim())) {
      for (const [index, entry] of entries.entries()) translations[entry.id] = parts[index].trim();
      return translations;
    }
    // 非官方接口可能改写段落边界；此时只重试同一服务的单段请求。
  }
  const outputs = new Map(entries.map(entry => [entry.id, []]));
  const tasks = [];
  for (const entry of entries) {
    for (const segment of splitSegments(entry.text, MAX_BATCH_BYTES)) {
      if (!segment.trim()) continue;
      tasks.push({id: entry.id, index: outputs.get(entry.id).length, text: segment});
      outputs.get(entry.id).push('');
    }
  }
  let index = 0;
  let failure;
  async function worker() {
    while (!failure && index < tasks.length) {
      const task = tasks[index++];
      try {
        const result = await requestGoogle(task.text, engine, fetcher, () => !failure, error => { failure ||= error; });
        outputs.get(task.id)[task.index] = result.translated.trim();
      } catch (error) { failure ||= error; }
    }
  }
  await Promise.all(Array.from({length: Math.min(MAX_IN_FLIGHT, tasks.length)}, () => worker()));
  if (failure) throw failure;
  for (const entry of entries) translations[entry.id] = outputs.get(entry.id).join(['zh-CN', 'zh-TW', 'ja'].includes(engine.target) ? '' : ' ');
  return translations;
}
