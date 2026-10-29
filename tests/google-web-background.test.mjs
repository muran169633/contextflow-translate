import test from 'node:test';
import assert from 'node:assert/strict';
let listener;
let called;
const store = {settings: {model: '', cache: false}, translationEngine: {provider: 'google-web', source: 'en', target: 'zh-CN'}};
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: fn => { listener = fn; }}},
  permissions: {contains: async ({origins}) => origins[0] === 'https://translate.googleapis.com/*'},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: store[key]}), set: async value => Object.assign(store, value)}}
};
globalThis.fetch = async url => { called = url; return {ok: true, json: async () => [[['你好。', 'Hello.']]]}; };
await import('../background.js');

test('免密钥 Google 请求通过后台发送且不需要模型', async () => {
  const result = await new Promise(resolve => listener({type: 'CF_TRANSLATE', entries: [{id: 'cf-1', text: 'Hello.'}], context: {}, engine: store.translationEngine}, {id: 'test', tab: {id: 1}}, resolve));
  assert.equal(result.ok, true);
  assert.equal(result.translations['cf-1'], '你好。');
  assert.equal(new URL(called).hostname, 'translate.googleapis.com');
});
