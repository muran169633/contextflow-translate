import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let endpoint;
let allowed = false;
const engine={provider:'libre-local',source:'auto',target:'zh-CN'};
const store={settings:{model:'',cache:false},translationEngine:engine};
globalThis.chrome={
  runtime:{id:'test',onMessage:{addListener:fn=>{listener=fn;}}},
  permissions:{contains:async({origins})=>allowed && origins[0]==='http://127.0.0.1/*'},
  storage:{local:{setAccessLevel:async()=>{},get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data)}}
};
globalThis.fetch=async url=>{endpoint=url;return {ok:true,json:async()=>({translatedText:'你好'})};};
await import('../background.js?libre-local-test');
const run=()=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Hello'}],engine},{id:'test',tab:{id:1}},resolve));

test('本机服务未经授权不会发送文本，授权后通过后台翻译', async()=>{
  assert.equal((await run()).ok,false);
  assert.equal(endpoint,undefined);
  allowed=true;
  const result=await run();
  assert.equal(result.ok,true);
  assert.equal(result.translations['cf-1'],'你好');
  assert.equal(endpoint,'http://127.0.0.1:5000/translate');
});
