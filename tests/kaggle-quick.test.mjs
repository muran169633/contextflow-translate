import test from 'node:test';
import assert from 'node:assert/strict';
let listener, commandListener, allowed=false, installed=false, displayMode='bilingual';
const messages=[];
const tab={id:3,url:'https://www.kaggle.com/code/somejoint/example/notebook',title:'Quantum Circuits | Kaggle'};
const store={settings:{model:'',dynamic:true},translationEngine:{provider:'google-web',source:'en',target:'zh-CN'},uiLanguage:'zh-CN'};
globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{listener=fn;}}},
  commands:{onCommand:{addListener:fn=>{commandListener=fn;}}},
  storage:{local:{setAccessLevel:async()=>{},get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data)}},
  permissions:{contains:async ({origins,permissions})=>permissions?.includes('webNavigation')?allowed:origins[0]==='https://translate.googleapis.com/*'},
  webNavigation:{getAllFrames:async()=>[{frameId:0,url:tab.url},{frameId:6,url:'https://www.kaggleusercontent.com/kf/123/__results__.html'}]},
  tabs:{sendMessage:async (_tab,message,options)=>{const frame=options?.frameId||0;messages.push({message,frame});
    if(message.type==='CF_PING') {if(frame===6&&!installed)throw Error('not installed');return {ok:true,protocol:18,displayMode};}
    if(message.type==='CF_QUICK_SHOW')return {ok:true};
    if(message.type==='CF_QUICK_NOTICE')return {ok:true};
    if(message.type==='CF_SET_DISPLAY'){if(frame===0)displayMode=message.mode;return {ok:true};}
    if(message.type==='CF_NOTEBOOK_VIEWPORT')return {ok:true,viewport:{top:50,bottom:500}};
    if(message.type==='CF_START')return {ok:true,started:true,found:frame===6?4:1};
    if(message.type==='CF_SET_VIEWPORT')return {ok:true};
    throw Error('unexpected');}},scripting:{insertCSS:async()=>{},executeScript:async()=>{installed=true;}}};
await import('../background.js?kaggle-quick-test');
const call=(message,sender={id:'test',tab,frameId:0})=>new Promise(resolve=>listener(message,sender,resolve));

test('快捷翻译未获得 Notebook 授权时给出提示，不发送翻译请求', async()=>{
  const result=await call({type:'CF_QUICK_START'});
  assert.equal(result.ok,false);assert.match(result.error,/授权/);
  assert.equal(messages.some(item=>item.message.type==='CF_START'),false);
});

test('快捷翻译授权后启动正文并传递真实可见范围', async()=>{
  allowed=true;messages.length=0;
  const result=await call({type:'CF_QUICK_START'});
  assert.equal(result.ok,true);assert.equal(result.found,5);
  const child=messages.find(item=>item.frame===6&&item.message.type==='CF_START');
  assert.deepEqual(child.message.preferences.viewport,{top:50,bottom:500});
  assert.equal(child.message.preferences.documentTitle,tab.title);
});

test('滚动同步只接受当前 Kaggle 顶层页面消息', async()=>{
  messages.length=0;
  const rejected=await call({type:'CF_NOTEBOOK_VIEWPORT',viewport:{top:5,bottom:10}},{id:'test',tab,frameId:6});
  assert.equal(rejected.ok,false);
  const accepted=await call({type:'CF_NOTEBOOK_VIEWPORT',viewport:{top:5,bottom:10}});
  assert.equal(accepted.ok,true);
  assert.ok(messages.some(item=>item.frame===6&&item.message.type==='CF_SET_VIEWPORT'));
});

test('原文快捷键同时切换 Kaggle 外层页面和正文框架', async()=>{
  allowed=true; installed=true; displayMode='bilingual'; messages.length=0;
  commandListener('toggle-display', tab);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(messages.filter(item=>item.message.type==='CF_SET_DISPLAY').map(item=>[item.frame,item.message.mode]), [[0,'original'],[6,'original']]);
  assert.equal(messages.some(item=>item.message.type==='CF_START'),false);
});

test('正文框架权限不足时快捷键提示未能同步', async()=>{
  allowed=false; displayMode='bilingual'; messages.length=0;
  commandListener('toggle-display', tab);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.filter(item=>item.message.type==='CF_SET_DISPLAY').length,1);
  assert.ok(messages.some(item=>item.message.type==='CF_QUICK_NOTICE' && item.message.kind!=='info'));
});
