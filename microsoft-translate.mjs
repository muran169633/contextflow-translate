export const MICROSOFT_ORIGIN = 'https://api.cognitive.microsofttranslator.com/*';

export async function translateMicrosoft(entries, engine, apiKey, region, fetcher = fetch) {
  if (!String(apiKey || '').trim()) throw new Error('Configure the Microsoft Translator key in Settings first.');
  if (engine.source === engine.target) throw new Error('Choose different source and target languages.');
  const lang = code => ({'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant'})[code] || code;
  const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
  url.searchParams.set('api-version', '3.0');
  if (engine.source !== 'auto') url.searchParams.set('from', lang(engine.source));
  url.searchParams.set('to', lang(engine.target));
  const headers = {'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': apiKey.trim()};
  if (String(region || '').trim()) headers['Ocp-Apim-Subscription-Region'] = region.trim();
  const response = await fetcher(url.href, {
    method: 'POST', headers, body: JSON.stringify(entries.map(entry => ({Text: entry.text}))), signal: AbortSignal.timeout(27000)
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Microsoft Translator returned invalid data (HTTP ${response.status}).`); }
  if (!response.ok) {
    const code = String(data?.error?.code || '').slice(0, 30);
    throw new Error(`Microsoft Translator HTTP ${response.status}${code ? ` (${code})` : ''}. Check the key, region and account quota.`);
  }
  if (!Array.isArray(data) || data.length !== entries.length || data.some(item => typeof item?.translations?.[0]?.text !== 'string' || !item.translations[0].text.trim())) {
    throw new Error('Microsoft Translator returned incomplete results.');
  }
  return Object.fromEntries(entries.map((entry, index) => [entry.id, data[index].translations[0].text]));
}
