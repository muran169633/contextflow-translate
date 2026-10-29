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

test('Google 批量结果缓存后按新的段落 ID 安全映射', async () => {
  store.settings.cache = true;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const text = new URL(url).searchParams.get('q');
    return {ok:true,json:async () => [[['第一段。\n\n第二段。',text]]]};
  };
  const run = entries => new Promise(resolve => listener({type:'CF_TRANSLATE', entries, context:{}, engine:store.translationEngine}, {id:'test',tab:{id:1}}, resolve));
  const first = await run([{id:'cf-1',text:'First paragraph.'},{id:'cf-2',text:'Second paragraph.'}]);
  const second = await run([{id:'cf-20',text:'First paragraph.'},{id:'cf-21',text:'Second paragraph.'}]);
  assert.equal(first.ok, true);
  assert.equal(second.cacheHit, true);
  assert.deepEqual(second.translations, {'cf-20':'第一段。','cf-21':'第二段。'});
  assert.equal(calls,1);
});

test('自动源语言经后台请求保留为 auto', async () => {
  store.settings.cache=false;
  let url;
  globalThis.fetch=async value=>{url=new URL(value);return {ok:true,json:async()=>[[['你好。','Bonjour.']]]};};
  const engine={provider:'google-web',source:'auto',target:'zh-CN'};
  const result=await new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Bonjour.'}],context:{},engine},{id:'test',tab:{id:1}},resolve));
  assert.equal(result.ok,true);
  assert.equal(url.searchParams.get('sl'),'auto');
});
