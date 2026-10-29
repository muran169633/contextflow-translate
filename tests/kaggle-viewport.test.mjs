import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

test('Kaggle 外层滚动后将正文框架的可见范围同步到后台', async () => {
  const script=await readFile(new URL('../content.js',import.meta.url),'utf8');
  const timers=new Map(),listeners=new Map(),messages=[];let listener,toast,id=0;
  const source={tagName:'P',textContent:'Outside sidebar text.',isConnected:true,closest:()=>null,querySelector:()=>null,getClientRects:()=>[1],insertAdjacentElement(){}};
  const iframe={getBoundingClientRect:()=>({top:-450,bottom:3000})};
  const body={appendChild(node){toast=node;}};
  const document={title:'Kaggle',body,querySelector:selector=>selector==='article'?{querySelectorAll:()=>[source]}:selector==='iframe#rendered-kernel-content'?iframe:null,
    querySelectorAll:()=>[],getElementById:()=>toast,createElement:()=>({dataset:{},classList:{add(){}},setAttribute(){},append(){},addEventListener(){}})};
  const chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>{messages.push(message);return message.type==='CF_TRANSLATE'?{ok:true,translations:{[message.entries[0].id]:'译文'}}:{ok:true};}}};
  class Observer {observe(){} disconnect(){}}
  const context={document,chrome,MutationObserver:Observer,location:{hostname:'www.kaggle.com',pathname:'/code/somejoint/notebook/notebook'},innerHeight:600,
    getComputedStyle:()=>({display:'block',visibility:'visible'}),addEventListener:(type,fn)=>{listeners.set(type,fn);},removeEventListener:()=>{},
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)};
  vm.runInNewContext(script,context);
  listener({type:'CF_START',preferences:{engine:{provider:'mymemory',source:'en',target:'zh-CN'},dynamic:true,messages:contentMessages('en')}},{},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  listeners.get('scroll')({type:'scroll'});
  for(const fn of [...timers.values()]) fn();
  const viewport=messages.find(message=>message.type==='CF_NOTEBOOK_VIEWPORT').viewport;
  assert.equal(viewport.top,450);assert.equal(viewport.bottom,1050);
});
