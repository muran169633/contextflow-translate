import {splitSegments} from './free-translate.mjs';

export const YOUDAO_ORIGIN = 'https://openapi.youdao.com/*';

// 遵循有道官方 JavaScript 示例的 UTF-16 截取和签名规则。
export function youdaoSignatureInput(text) {
  return text.length <= 20 ? text : text.slice(0, 10) + text.length + text.slice(-10);
}

export async function translateYoudao(entries, engine, appKey, appSecret, fetcher = fetch) {
  if (!String(appKey || '').trim() || !String(appSecret || '').trim()) throw new Error('Configure the Youdao application ID and secret in Settings first.');
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const lang = code => ({'zh-CN': 'zh-CHS', 'zh-TW': 'zh-CHT'})[code] || code;
  const translations = {};
  for (const entry of entries) {
    const parts = [];
    // 字节上限小于服务的 5000 字符上限，避免超长段落请求失败。
    for (const segment of splitSegments(entry.text, 4000)) {
      if (!segment.trim()) continue;
      const salt = crypto.randomUUID();
      const curtime = String(Math.floor(Date.now() / 1000));
      const signText = appKey + youdaoSignatureInput(segment) + salt + curtime + appSecret;
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signText));
      const sign = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      const body = new URLSearchParams({q: segment, from: lang(engine.source), to: lang(engine.target), appKey, salt, curtime, sign, signType: 'v3'});
      const response = await fetcher('https://openapi.youdao.com/api', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body, signal: AbortSignal.timeout(27000)});
      if (!response.ok) throw new Error(`Youdao HTTP ${response.status}`);
      const data = await response.json();
      if (String(data?.errorCode) !== '0') throw new Error(`Youdao error ${String(data?.errorCode || 'unknown').slice(0, 20)}. Check the application, language pair and account quota.`);
      if (!Array.isArray(data.translation) || !data.translation.length || data.translation.some(part => typeof part !== 'string') || !data.translation.join('').trim()) throw new Error('Youdao returned an empty or incomplete translation.');
      parts.push(data.translation.join('\n').trim());
    }
    translations[entry.id] = parts.join(['zh-CN', 'zh-TW', 'ja'].includes(engine.target) ? '' : ' ');
  }
  return translations;
}
