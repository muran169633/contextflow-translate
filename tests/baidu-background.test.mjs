import test from 'node:test';
import assert from 'node:assert/strict';
let listener, command;
let allowed=false;
const calls=[];
const engine={provider:'baidu',source:'en',target:'zh-CN'};
const saved={settings:{model:'',cache:false,baiduAppId:'id',baiduAppSecret:'secret'},translationEngine:engine,uiLanguage:'zh-CN'};
globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{listener=fn;}}},commands:{onCommand:{addListener:fn=>{command=fn;}}},
  storage:{local:{setAccessLevel:async()=>{},get:async key=>({[key]:saved[key]}),set:async data=>Object.assign(saved,data)}},
  permissions:{contains:async({origins})=>allowed && origins[0]==='https://fanyi-api.baidu.com/*'},
  tabs:{sendMessage:async(_id,message)=>{calls.push(message);if(message.type==='CF_PING')return {ok:true,protocol:22};return {ok:true,started:true,found:1};}},
  scripting:{}};
globalThis.fetch=async(url,{body})=>{calls.push({type:'fetch',url,form:body});return {ok:true,json:async()=>({trans_result:[{src:'Hello.',dst:'你好。'}]})};};
await import('../background.js?baidu-test');
const run=()=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Hello.'}],engine},{id:'test',tab:{id:1}},resolve));

test('后台仅授权后向百度发送签名请求，不向网页发送密钥',async()=>{
  assert.equal((await run()).ok,false);
  assert.equal(calls.length,0);
  allowed=true;
  const result=await run();
  assert.equal(result.ok,true);
  assert.equal(result.translations['cf-1'],'你好。');
  assert.equal(calls[0].url,'https://fanyi-api.baidu.com/api/trans/vip/translate');
  assert.equal(JSON.stringify([...calls[0].form]).includes('secret'),false);
  calls.length=0;
  command('quick-translate',{id:1,url:'https://example.com/'});
  await new Promise(resolve=>setImmediate(resolve));
  const start=calls.find(item=>item.type==='CF_START');
  assert.equal(start.preferences.engine.provider,'baidu');
  assert.equal(JSON.stringify(start).includes('secret'),false);
});
