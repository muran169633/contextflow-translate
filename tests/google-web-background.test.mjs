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
async function waitFor(predicate) {
  for (let attempt=0; attempt<200 && !predicate(); attempt++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(predicate(), '等待翻译请求超时');
}

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

test('段落分组改变时只请求缓存中没有的段落', async () => {
  store.settings.cache=true;
  const queries=[];
  globalThis.fetch=async value=>{
    const query=new URL(value).searchParams.get('q'); queries.push(query);
    return {ok:true,json:async()=>[[[query.split('\n\n').map(text=>`译:${text}`).join('\n\n'),query]]]};
  };
  const run=entries=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries,context:{},engine:store.translationEngine},{id:'test',tab:{id:1}},resolve));
  const first=await run([{id:'cf-1',text:'Alpha unique.'},{id:'cf-2',text:'Beta unique.'}]);
  const second=await run([{id:'cf-3',text:'Beta unique.'},{id:'cf-4',text:'Gamma unique.'}]);
  assert.equal(first.ok,true);
  assert.equal(second.ok,true);
  assert.deepEqual(queries,['Alpha unique.\n\nBeta unique.','Gamma unique.']);
  assert.deepEqual(second.translations,{'cf-3':'译:Beta unique.','cf-4':'译:Gamma unique.'});
});

test('Google 文本错误可恢复，限流错误停止后续请求', async () => {
  store.settings.cache=false;
  const run=()=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Invalid input.'}],context:{},engine:store.translationEngine},{id:'test',tab:{id:1}},resolve));
  globalThis.fetch=async()=>({ok:false,status:400});
  assert.equal((await run()).fatal,false);
  globalThis.fetch=async()=>({ok:false,status:429});
  assert.equal((await run()).fatal,true);
});

test('相同 Google 请求正在进行时跨页面复用，按各页面段落 ID 返回', async () => {
  store.settings.cache=false;
  let release, calls=0;
  globalThis.fetch=async url=>{calls++;return await new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>[[['共享译文',new URL(url).searchParams.get('q')]]]});});};
  const run=(id,engine=store.translationEngine,force=false)=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id,text:'Concurrent unique text.'}],engine,force},{id:'test',tab:{id:1}},resolve));
  const first=run('cf-1');
  const second=run('cf-88');
  await waitFor(()=>calls===1);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,1);
  release();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a.translations['cf-1'],'共享译文');
  assert.equal(b.translations['cf-88'],'共享译文');
});

test('强制重试和不同目标语言不会复用进行中的 Google 请求', async () => {
  store.settings.cache=false;
  const pending=[];
  globalThis.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));
  const run=(target,force=false)=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Retry unique text.'}],engine:{...store.translationEngine,target},force},{id:'test',tab:{id:1}},resolve));
  const first=run('zh-CN');
  const retry=run('zh-CN',true);
  const different=run('ja');
  await waitFor(()=>pending.length===3);
  assert.equal(pending.length,3);
  for (const request of pending) request.resolve({ok:true,json:async()=>[[['翻译',new URL(request.url).searchParams.get('q')]]]});
  assert.ok((await Promise.all([first,retry,different])).every(result=>result.ok));
});

test('共享 Google 请求失败后会移除进行中的记录，后续可以重试', async () => {
  store.settings.cache=false;
  let calls=0, release;
  globalThis.fetch=()=>{calls++;return calls===1?new Promise(resolve=>{release=()=>resolve({ok:false,status:429});}):Promise.resolve({ok:true,json:async()=>[[['恢复','Retry after error.']]]});};
  const run=()=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Retry after error.'}],engine:store.translationEngine},{id:'test',tab:{id:1}},resolve));
  const first=run(); const second=run();
  await waitFor(()=>calls===1);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,1);
  release();
  assert.ok((await Promise.all([first,second])).every(result=>!result.ok));
  const recovered=await run();
  assert.equal(recovered.ok,true);
  assert.equal(calls,2);
});
