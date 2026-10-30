import test from 'node:test';
import assert from 'node:assert/strict';

test('弹窗说明已设置邮箱，但不向网页脚本传递邮箱', async()=>{
  const nodes=new Map();
  for (const id of ['message','model','detail','start','continue','stop','clear','copy-discussion','settings','uiLanguage','provider','freeSource','freeTarget','free-controls','ai-controls','mymemory-info','google-info','google-web-info','youdao-info','microsoft-info','dynamicInfo','mode-bilingual','mode-original','kaggleInfo','autoSourceInfo','swapLanguages','libre-info','baidu-info','freeNote']) {
    nodes.set(id,{value:'',textContent:'',className:'',setAttribute(){},replaceChildren(){},addEventListener(_type,fn){this.handler=fn;}});
  }
  const store={settings:{model:'',mymemoryEmail:'reader@example.com'},translationEngine:{provider:'mymemory',source:'en',target:'zh-CN'},uiLanguage:'zh-CN'};
  let start;
  globalThis.document={documentElement:{},createElement:()=>({}),getElementById:id=>nodes.get(id),querySelectorAll:()=>[]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'zh-CN'}});
  globalThis.chrome={storage:{local:{get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data)}},
    permissions:{request:async()=>true},tabs:{query:async()=>[{id:1,url:'https://example.com/'}],sendMessage:async(_tab,message)=>{
      if(message.type==='CF_PING')return {ok:true,protocol:22};
      if(message.type==='CF_START'){start=message;return {ok:true,started:true,found:1};}
      return {ok:true};
    }},scripting:{},runtime:{sendMessage:async()=>({ok:true,protocol:22})}};
  try{
    await import('../popup.js?mymemory-email-test');
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(nodes.get('freeNote').textContent,/邮箱会发送给 MyMemory/);
    nodes.get('start').handler();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(start.type,'CF_START');
    assert.equal(JSON.stringify(start).includes('reader@example.com'),false);
  }finally{delete globalThis.document;delete globalThis.navigator;delete globalThis.chrome;}
});
