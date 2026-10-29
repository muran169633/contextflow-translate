import test from 'node:test';
import assert from 'node:assert/strict';
let listener, request;
const store = {settings: {microsoftKey: 'secret', microsoftRegion: 'eastus', model: '', cache: false}, translationEngine: {provider: 'microsoft', source: 'en', target: 'zh-CN'}};
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: fn => { listener = fn; }}},
  permissions: {contains: async ({origins}) => origins[0] === 'https://api.cognitive.microsofttranslator.com/*'},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: store[key]}), set: async value => Object.assign(store, value)}}
};
globalThis.fetch = async (url, init) => { request = {url, init}; return {ok: true, json: async () => ([{translations:[{text:'你好。'}]}])}; };
await import('../background.js');
test('微软经正式后台入口翻译，密钥不返回网页', async () => {
  const result = await new Promise(resolve => listener({type:'CF_TRANSLATE', entries:[{id:'cf-1', text:'Hello.'}], context:{}, engine:store.translationEngine}, {id:'test', tab:{id:1}}, resolve));
  assert.equal(result.ok, true);
  assert.equal(result.translations['cf-1'], '你好。');
  assert.equal(new URL(request.url).origin, 'https://api.cognitive.microsofttranslator.com');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
