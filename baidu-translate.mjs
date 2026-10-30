import {splitSegments} from './free-translate.mjs';
import {md5} from './md5.mjs';

export const BAIDU_ORIGIN = 'https://fanyi-api.baidu.com/*';
const BAIDU_ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
const MAX_BYTES = 900;
const codes = {'zh-CN':'zh','zh-TW':'cht',ja:'jp',ko:'kor',fr:'fra',es:'spa',ar:'ara',vi:'vie',sv:'swe',da:'dan',fi:'fin',ro:'rom',uk:'ukr',he:'heb',fa:'per',bn:'ben',ms:'may'};

// 全部页面共享队列，标准版每秒最多一次；仅约束请求发起间隔。
export function createBaiduGate({now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 1100} = {}) {
  let queue = Promise.resolve();
  let nextStart = 0;
  return function schedule(run) {
    const result = queue.catch(() => {}).then(async () => {
      const delay = Math.max(0, nextStart - now());
      if (delay) await sleep(delay);
      nextStart = now() + interval;
      return run();
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
const schedule = createBaiduGate();

export async function translateBaidu(entries, engine, appId, appSecret, {fetcher = fetch, gate = schedule, salt = () => crypto.randomUUID().replaceAll('-', '')} = {}) {
  if (!String(appId || '').trim() || !String(appSecret || '').trim()) throw new Error('Configure the Baidu App ID and secret in Settings first.');
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const lang = code => codes[code] || code;
  const request = async text => gate(async () => {
    const nonce = salt();
    const body = new URLSearchParams({q:text, from:lang(engine.source), to:lang(engine.target), appid:appId, salt:nonce, sign:md5(appId + text + nonce + appSecret)});
    const response = await fetcher(BAIDU_ENDPOINT, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body, signal:AbortSignal.timeout(27000)});
    if (!response.ok) throw new Error(`Baidu Translate HTTP ${response.status}.`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Baidu Translate returned invalid data.'); }
    if (data?.error_code) throw new Error(`Baidu Translate error ${String(data.error_code).slice(0, 20)}: ${String(data.error_msg || 'translation failed').slice(0, 120)}. Check credentials, language, rate limit and quota.`);
    if (!Array.isArray(data?.trans_result) || !data.trans_result.length || data.trans_result.some(item => typeof item.src !== 'string' || typeof item.dst !== 'string' || !item.dst.trim())) throw new Error('Baidu Translate returned incomplete results.');
    return data.trans_result;
  });
  const translations = {};
  const joined = entries.map(entry => entry.text).join('\n');
  if (engine.source !== 'auto' && entries.length > 1 && entries.every(entry => !/[\r\n]/.test(entry.text)) && new TextEncoder().encode(joined).length <= MAX_BYTES) {
    const result = await request(joined);
    if (result.length === entries.length && result.every((row, i) => row.src === entries[i].text)) {
      entries.forEach((entry, i) => { translations[entry.id] = result[i].dst; });
      return translations;
    }
    const error = new Error('Baidu batch boundaries did not match the source; retrying individual paragraphs.');
    error.fatal = false;
    throw error;
  }
  for (const entry of entries) {
    const parts = [];
    for (const segment of splitSegments(entry.text, MAX_BYTES)) {
      if (!segment.trim()) continue;
      const result = await request(segment);
      parts.push(result.map(row => row.dst).join('\n').trim());
    }
    translations[entry.id] = parts.join(['zh-CN','zh-TW','ja'].includes(engine.target) ? '' : ' ');
  }
  return translations;
}
