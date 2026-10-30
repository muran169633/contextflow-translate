import test from 'node:test';
import assert from 'node:assert/strict';

test('弹窗恢复页面显示模式并切换，无需翻译请求', async () => {
  const nodes=new Map();
  for (const id of ['message','model','detail','start','continue','stop','clear','copy-discussion','settings','uiLanguage','provider','freeSource','freeTarget','free-controls','ai-controls','mymemory-info','google-info','google-web-info','youdao-info','microsoft-info','dynamicInfo','mode-bilingual','mode-original', 'kaggleInfo', 'autoSourceInfo', 'swapLanguages', 'libre-info', 'baidu-info', 'freeNote']) {
    nodes.set(id, {value:'', textContent:'', className:'', setAttribute(key,value) {this[key]=value;}, replaceChildren() {}, addEventListener(_type,fn) {this.handler=fn;}});
  }
  const store={settings:{model:''}};
  let mode='original', starts=0, messages=0;
  globalThis.document={documentElement:{},createElement:() => ({}),getElementById:id => nodes.get(id),querySelectorAll:() => []};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'zh-CN'}});
  globalThis.chrome={storage:{local:{get:async key => ({[key]:store[key]}),set:async data => Object.assign(store,data)}},
    tabs:{query:async () => [{id:1,url:'https://example.com'}],sendMessage:async (_id,message) => {
      if (message.type==='CF_PING') return {ok:true, protocol:22, displayMode:mode};
      if (message.type==='CF_QUICK_SHOW') return {ok:true};
      if (message.type==='CF_SET_DISPLAY') {messages++; mode=message.mode; return {ok:true,displayMode:mode};}
      if (message.type==='CF_START') starts++;
      throw Error('unexpected request');
    }}, scripting:{},runtime:{}};
  try {
    await import('../popup.js?display-test');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.get('mode-original')['aria-pressed'], 'true');
    nodes.get('mode-bilingual').handler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.get('mode-bilingual')['aria-pressed'], 'true');
    assert.match(nodes.get('message').textContent, /双语/);
    assert.equal(messages,1);
    assert.equal(starts,0);
  } finally {delete globalThis.document; delete globalThis.navigator; delete globalThis.chrome;}
});
