import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script=await readFile(new URL('../content.js',import.meta.url),'utf8');

test('横向 flex 标题译文插在整行下方，普通段落仍紧跟原文', async()=>{
  let listener, toast;const placements=[];
  const body={appendChild(node){toast=node;}};
  const article={parentElement:body,querySelectorAll:()=>[heading,normal]};
  const row={parentElement:article,layout:'flex',insertAdjacentElement(position,node){placements.push({target:'row',position,node});}};
  const heading={tagName:'H1',textContent:'Qwen3.8 or something else?',isConnected:true,parentElement:row,closest:()=>null,querySelector:()=>null,getClientRects:()=>[1],insertAdjacentElement(position,node){placements.push({target:'heading',position,node});}};
  const normal={tagName:'P',textContent:'Ordinary discussion paragraph.',isConnected:true,parentElement:article,closest:()=>null,querySelector:()=>null,getClientRects:()=>[1],insertAdjacentElement(position,node){placements.push({target:'paragraph',position,node});}};
  const document={title:'Discussion',body,querySelector:selector=>selector==='article'?article:null,querySelectorAll:()=>[],getElementById:()=>toast,createElement:()=>({dataset:{},classList:{add(){}},children:[],setAttribute(){},append(...items){this.children.push(...items);},addEventListener(){}})};
  const chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>({ok:true,translations:Object.fromEntries(message.entries.map(item=>[item.id,'译文']))})}};
  vm.runInNewContext(script,{document,chrome,getComputedStyle:node=>({display:node.layout||'block',flexDirection:'row',visibility:'visible'})});
  listener({type:'CF_START',preferences:{engine:{provider:'google-web',source:'en',target:'zh-CN'},messages:contentMessages('zh-CN')}},{},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(placements.map(item=>[item.target,item.position]),[['row','afterend'],['paragraph','afterend']]);
});

test('网格和多层横向布局中的普通文本把译文放进原文块', async()=>{
  let listener, toast; const placements=[];
  const body={appendChild(node){toast=node;}};
  const article={parentElement:body,layout:'grid',querySelectorAll:()=>[heading,paragraph]};
  const row={parentElement:article,layout:'flex'};
  const wrapper={parentElement:row,layout:'block'};
  const make=(tag,text,parent)=>({tagName:tag,textContent:text,isConnected:true,parentElement:parent,closest:()=>null,
    querySelector:()=>null,getClientRects:()=>[1],appendChild(node){placements.push({source:this,node});}});
  const heading=make('H1','Published on PyPI for Windows and Linux',wrapper);
  const paragraph=make('P','A paragraph within a grid.',article);
  const document={title:'Discussion',body,querySelector:selector=>selector==='article'?article:null,querySelectorAll:()=>[],getElementById:()=>toast,
    createElement:tag=>({tag,dataset:{},classList:{add(){}},children:[],setAttribute(){},append(...items){this.children.push(...items);},addEventListener(){}})};
  const chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>({ok:true,translations:Object.fromEntries(message.entries.map(item=>[item.id,'译文']))})}};
  vm.runInNewContext(script,{document,chrome,getComputedStyle:node=>({display:node.layout||'block',flexDirection:'row',visibility:'visible'})});
  listener({type:'CF_START',preferences:{engine:{provider:'google-web',source:'en',target:'zh-CN'},messages:contentMessages('zh-CN')}},{},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(placements.map(item=>item.source),[heading,paragraph]);
  assert.ok(placements.every(item=>item.node.tag==='span'));
});
