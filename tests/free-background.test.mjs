import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let fetchCount = 0;
const store = {translationEngine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}, settings: {model: '', cache: true}};
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: callback => { listener = callback; }}},
  permissions: {contains: async ({origins}) => origins[0] === 'https://api.mymemory.translated.net/*'},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: store[key]}), set: async data => Object.assign(store, data)}}
};
globalThis.fetch = async url => {
  fetchCount++;
  assert.equal(new URL(url).searchParams.get('langpair'), 'en|zh-CN');
  return {ok: true, json: async () => ({responseStatus: 200, responseData: {translatedText: '无需模型的翻译'}})};
};
await import('../background.js');
const run = () => new Promise(resolve => listener({type: 'CF_TRANSLATE', entries: [{id: 'cf-1', text: 'A short test paragraph.'}], context: {}}, {id: 'test', tab: {id: 1}}, resolve));

test('无需模型的免费翻译走正式后台入口并缓存', async () => {
  const first = await run();
  assert.equal(first.ok, true);
  assert.equal(first.translations['cf-1'], '无需模型的翻译');
  const second = await run();
  assert.equal(second.cacheHit, true);
  assert.equal(fetchCount, 1);
});
