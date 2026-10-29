import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

test('Notebook 正文框架提取标题、正文和短表头，跳过代码及纯数字', async () => {
  const script=await readFile(new URL('../content.js',import.meta.url),'utf8');
  const requests=[]; let listener,toast;
  const make=(tag,text,inCode=false) => ({tagName:tag,textContent:text,isConnected:true,closest:()=>inCode?{}:null,querySelector:()=>null,getClientRects:()=>[1],insertAdjacentElement(_pos,node){this.translated=node;},appendChild(node){this.translated=node;}});
  const nodes=[make('H1','Quantum Circuits | 889-Qubit DQI'),make('P','This circuit uses an official verifier.'),make('TH','Task'),make('TH','Mean Toffolis'),make('TD','1,329.5'),make('TD','4.14212e+11'),make('P','print("do not translate")',true)];
  const body={querySelectorAll:()=>nodes,appendChild(node){toast=node;}};
  const document={title:'Notebook',body,querySelector:() => ({querySelectorAll:()=>[]}),querySelectorAll:()=>[],getElementById:()=>toast,
    createElement:()=>({dataset:{},classList:{add() {}},children:[],setAttribute() {},append(...items){this.children.push(...items);},addEventListener() {}})};
  const chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>{requests.push(message);return {ok:true,translations:Object.fromEntries(message.entries.map(entry=>[entry.id,'译文']))};}}};
  vm.runInNewContext(script,{document,chrome,location:{hostname:'www.kaggleusercontent.com',pathname:'/kf/123/__results__.html'},getComputedStyle:()=>({display:'block',visibility:'visible'})});
  let start;
  listener({type:'CF_START',preferences:{engine:{provider:'google-web',source:'en',target:'zh-CN'},maxBlocks:50,messages:contentMessages('zh-CN'),documentTitle:'Quantum Circuits | Kaggle'}},{},result=>{start=result;});
  await new Promise(resolve=>setImmediate(resolve));
  const texts=requests.flatMap(request=>request.entries.map(entry=>entry.text));
  assert.equal(start.found,4);
  for (const text of ['Quantum Circuits | 889-Qubit DQI','This circuit uses an official verifier.','Task','Mean Toffoli gates']) assert.ok(texts.includes(text));
  assert.ok(!texts.includes('1,329.5'));
  assert.ok(!texts.includes('4.14212e+11'));
  assert.ok(!texts.some(text=>text.startsWith('print')));
  assert.equal(requests[0].context.title,'Quantum Circuits | Kaggle');
});

test('Notebook 框架按外层网页可见区域优先，而不是按框架整个高度', async () => {
  const script=await readFile(new URL('../content.js',import.meta.url),'utf8');
  let listener,toast;const requests=[];
  const nodes=[100,800,1600].map((top,i)=>({tagName:'P',textContent:`Paragraph ${i} contains text.`,isConnected:true,closest:()=>null,querySelector:()=>null,getClientRects:()=>[1],getBoundingClientRect:()=>({top,bottom:top+50}),insertAdjacentElement(){}}));
  const body={querySelectorAll:()=>nodes,appendChild(node){toast=node;}};
  const document={body,title:'Notebook',querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>toast,createElement:()=>({dataset:{},classList:{add(){}},setAttribute(){},append(){},addEventListener(){}})};
  const chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>{requests.push(message);return {ok:true,translations:Object.fromEntries(message.entries.map(e=>[e.id,'译文']))};}}};
  vm.runInNewContext(script,{document,chrome,location:{hostname:'www.kaggleusercontent.com',pathname:'/kf/123/__results__.html'},innerHeight:5000,getComputedStyle:()=>({display:'block',visibility:'visible'})});
  listener({type:'CF_START',preferences:{engine:{provider:'google-web',source:'en',target:'zh-CN'},maxBlocks:1,viewport:{top:700,bottom:1200},messages:contentMessages('en')}},{},()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests[0].entries[0].text,'Paragraph 1 contains text.');
});
