import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let sent;
const store = {settings: {googleTranslateKey: 'google-secret', model: '', cache: false}, translationEngine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}};
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: fn => { listener = fn; }}},
  permissions: {contains: async ({origins}) => origins[0] === 'https://translation.googleapis.com/*'},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: store[key]}), set: async data => Object.assign(store, data)}}
};
globalThis.fetch = async (url, options) => {
  sent = {url, options};
  return {ok: true, json: async () => ({data: {translations: [{translatedText: '测试译文'}]}})};
};
await import('../background.js');

test('Google 翻译经正式后台入口执行，不需要配置 AI 模型', async () => {
  const result = await new Promise(resolve => listener({type: 'CF_TRANSLATE', entries: [{id: 'cf-1', text: 'A test paragraph.'}], context: {}, engine: {provider: 'google', source: 'en', target: 'zh-CN'}}, {id: 'test', tab: {id: 1}}, resolve));
  assert.equal(result.ok, true);
  assert.equal(result.translations['cf-1'], '测试译文');
  assert.equal(sent.options.headers['x-goog-api-key'], 'google-secret');
});
