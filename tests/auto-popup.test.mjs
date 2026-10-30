import test from 'node:test';
import assert from 'node:assert/strict';

test('可选择自动源语言，切换 MyMemory 时清楚提示使用英语',async()=>{
  const nodes=new Map();
  for(const id of ['message','model','detail','start','continue','stop','clear','copy-discussion','settings','uiLanguage','provider','freeSource','freeTarget','free-controls','ai-controls','mymemory-info','google-info','google-web-info','youdao-info','microsoft-info','dynamicInfo','mode-bilingual','mode-original','kaggleInfo','autoSourceInfo', 'swapLanguages', 'libre-info', 'baidu-info', 'freeNote']) {
    nodes.set(id,{value:'',textContent:'',className:'',setAttribute(){},replaceChildren(...children){this.options=children;},addEventListener(_type,fn){this.handler=fn;}});
  }
  const store={settings:{model:''},translationEngine:{provider:'google-web',source:'en',target:'zh-CN'}};
  globalThis.document={documentElement:{},createElement:()=>({}),getElementById:id=>nodes.get(id),querySelectorAll:()=>[]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'zh-CN'}});
  globalThis.chrome={storage:{local:{get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data)}},
    tabs:{query:async()=>[{id:1,url:'https://example.com/article'}],sendMessage:async (_id,message)=>message.type==='CF_PING'?{ok:true,protocol:22}:{ok:true}},scripting:{},runtime:{}};
  try {
    await import('../popup.js?auto-test');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(nodes.get('freeSource').options[0].value,'auto');
    assert.ok(nodes.get('freeTarget').options.every(item=>item.value!=='auto'));
    nodes.get('freeSource').value='auto'; nodes.get('freeSource').handler();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(store.translationEngine.source,'auto');
    assert.equal(nodes.get('autoSourceInfo').hidden,false);
    nodes.get('swapLanguages').handler();
    assert.match(nodes.get('message').textContent,/自动检测无法交换/);
    assert.equal(store.translationEngine.target,'zh-CN');
    nodes.get('provider').value='mymemory';nodes.get('provider').handler();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(store.translationEngine.source,'en');
    assert.equal(nodes.get('autoSourceInfo').hidden,true);
    assert.match(nodes.get('message').textContent,/不支持自动识别/);
    nodes.get('swapLanguages').handler();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(store.translationEngine.source,'zh-CN');
    assert.equal(store.translationEngine.target,'en');
  } finally {delete globalThis.document;delete globalThis.navigator;delete globalThis.chrome;}
});
