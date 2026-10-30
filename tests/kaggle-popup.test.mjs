import test from 'node:test';
import assert from 'node:assert/strict';

test('Kaggle 弹窗请求内容域权限并分别启动主页面和正文框架', async () => {
  const nodes=new Map();
  for (const id of ['message','model','detail','start','continue','stop','clear','copy-discussion','settings','uiLanguage','provider','freeSource','freeTarget','free-controls','ai-controls','mymemory-info','google-info','google-web-info','youdao-info','microsoft-info','dynamicInfo','mode-bilingual','mode-original', 'kaggleInfo', 'autoSourceInfo', 'swapLanguages', 'libre-info', 'baidu-info']) {
    nodes.set(id,{value:'',textContent:'',className:'',setAttribute(key,value){this[key]=value;},replaceChildren(){},addEventListener(_type,fn){this.handler=fn;}});
  }
  const store={settings:{model:''},translationEngine:{provider:'google-web',source:'en',target:'zh-CN'}};
  const tab={id:1,url:'https://www.kaggle.com/code/somejoint/example/notebook',title:'Quantum Circuits | Kaggle'};
  let installed=false,requested, requestedPermissions, childPreferences, frameAvailable=true, rejectPermission=false;
  let loadedManifest={permissions:['activeTab'],optional_permissions:[]}; const sent=[];
  globalThis.document={documentElement:{},createElement:()=>({}),getElementById:id=>nodes.get(id),querySelectorAll:()=>[]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'zh-CN'}});
  globalThis.chrome={storage:{local:{get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data)}},
    permissions:{request:({origins,permissions})=>{requested=origins;requestedPermissions=permissions;return rejectPermission?Promise.reject(new Error('Only permissions specified in the manifest may be requested.')):Promise.resolve(true);},contains:async()=>true},
    webNavigation:{getAllFrames:async()=>frameAvailable?[{frameId:0,url:tab.url},{frameId:5,url:'https://www.kaggleusercontent.com/kf/123/__results__.html'},{frameId:9,url:'https://unrelated.example/frame'}]:[{frameId:0,url:tab.url}]},
    tabs:{query:async()=>[tab],sendMessage:async (_id,message,options)=>{
      const frame=options?.frameId ?? 0;sent.push({type:message.type,frame});
      if(message.type==='CF_PING') {if(frame===5&&!installed)throw Error('not injected');return {ok:true,protocol:20,displayMode:'bilingual'};}
      if(message.type==='CF_QUICK_SHOW')return {ok:true};
      if(message.type==='CF_NOTEBOOK_VIEWPORT')return {ok:true,viewport:{top:400,bottom:1000}};
      if(message.type==='CF_START') {if(frame===5)childPreferences=message.preferences;return {ok:true,started:true,found:frame===5?4:1};}
      if(message.type==='CF_STOP') return {ok:true};
      throw Error('unexpected message');
    }},scripting:{insertCSS:async()=>{},executeScript:async()=>{installed=true;}},runtime:{getManifest:()=>loadedManifest,sendMessage:async()=>({ok:true,protocol:20})}};
  try {
    await import('../popup.js?kaggle-test');await new Promise(resolve=>setImmediate(resolve));
    nodes.get('start').handler();
    assert.equal(requested,undefined);
    assert.match(nodes.get('message').textContent,/重新加载 ContextFlow/);
    loadedManifest={permissions:['activeTab'],optional_permissions:['webNavigation']};
    nodes.get('start').handler();
    assert.deepEqual(requested,['https://translate.googleapis.com/*','https://www.kaggleusercontent.com/*']);
    assert.deepEqual(requestedPermissions,['webNavigation']);
    assert.equal(nodes.get('kaggleInfo').hidden,false);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(childPreferences.documentTitle,'Quantum Circuits | Kaggle');
    assert.deepEqual(childPreferences.viewport,{top:400,bottom:1000});
    assert.match(nodes.get('message').textContent,/5/);
    assert.equal(sent.some(item=>item.frame===9),false);
    nodes.get('stop').handler();await new Promise(resolve=>setImmediate(resolve));
    assert.ok(sent.some(item=>item.type==='CF_STOP' && item.frame===0));
    assert.ok(sent.some(item=>item.type==='CF_STOP' && item.frame===5));
    frameAvailable=false;
    nodes.get('start').handler();await new Promise(resolve=>setImmediate(resolve));
    assert.match(nodes.get('message').textContent,/正文尚未连接/);
    rejectPermission=true;
    nodes.get('start').handler();await new Promise(resolve=>setImmediate(resolve));
    assert.match(nodes.get('message').textContent,/重新加载 ContextFlow/);
  } finally {delete globalThis.document;delete globalThis.navigator;delete globalThis.chrome;}
});
