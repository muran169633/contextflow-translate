// 本机自部署服务；不会将网页文本发送到第三方公共节点。
export const LIBRE_LOCAL_ORIGIN = 'http://127.0.0.1/*';
const ENDPOINT = 'http://127.0.0.1:5000/translate';

export async function translateLibreLocal(entries, engine, fetcher = fetch) {
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  if (engine.source === 'zh-TW' || engine.target === 'zh-TW') throw new Error('LibreTranslate local mode does not distinguish Traditional Chinese. Select another language.');
  const language = code => code === 'zh-CN' ? 'zh' : code;
  const translations = {};
  for (const entry of entries) {
    let response;
    try {
      response = await fetcher(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({q: entry.text, source: language(engine.source), target: language(engine.target), format: 'text'}),
        signal: AbortSignal.timeout(27000)});
    } catch (error) {
      throw new Error(`LibreTranslate local server is unavailable at 127.0.0.1:5000: ${String(error?.message || error).slice(0, 120)}`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('LibreTranslate returned invalid data.'); }
    if (!response.ok) throw new Error(`LibreTranslate HTTP ${response.status}: ${String(data?.error || 'translation failed').slice(0, 160)}`);
    if (typeof data?.translatedText !== 'string' || !data.translatedText.trim()) throw new Error('LibreTranslate returned an empty translation.');
    translations[entry.id] = data.translatedText;
  }
  return translations;
}
