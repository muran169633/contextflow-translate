import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
function setup(translate) {
  let listener, request, rendered, toast;
  const source={tagName:'P', isConnected:true, textContent:'The cost is Q²T per shot.', closest:() => null,
    querySelector:selector => selector.includes('code,') ? {} : null, getClientRects:() => [1],
    cloneNode() {
      let value='Q²T';
      const math={textContent:'Q²T', parentElement:{closest:() => null}, querySelector:() => ({textContent:'Q^2 T'}), replaceWith(node) {value=node.textContent;}};
      return {querySelectorAll:selector => selector==='.cf-translation' ? [] : [math], get textContent() {return `The cost is ${value} per shot.`;}};
    }, insertAdjacentElement(_position,node) {rendered=node;}};
  function element() {return {dataset:{},classList:{add() {}},children:[],setAttribute() {},append(...nodes) {this.children.push(...nodes);},addEventListener() {}};}
  const document={title:'Notebook', createTextNode:text => ({textContent:text}), querySelector:selector => selector==='article'?{querySelectorAll:() => [source]}:null,
    querySelectorAll:() => [],getElementById:() => toast,createElement:element,body:{appendChild(node){toast=node;}}};
  const chrome={runtime:{onMessage:{addListener:fn => {listener=fn;}},sendMessage:async message => {request=message;return {ok:true,translations:{[message.entries[0].id]:translate(message.entries[0].text)}};}}};
  vm.runInNewContext(script,{document,chrome,getComputedStyle:() => ({visibility:'visible',display:'block'})});
  listener({type:'CF_START',preferences:{engine:{provider:'google-web',source:'en',target:'zh-CN'},messages:contentMessages('en')}},{},() => {});
  return {getRequest:() => request,getRendered:() => rendered,getToast:() => toast};
}
test('Google 翻译前保护行内公式，并在译文中恢复原始 LaTeX',async () => {
  const page=setup(text => `每次运行的成本是 ${text.match(/CFKEEP\d+TOKEN/)[0]}。`);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.getRequest().entries[0].text,/CFKEEP0TOKEN/);
  assert.doesNotMatch(page.getRequest().entries[0].text,/Q²T/);
  assert.equal(page.getRendered().children[1].textContent,'每次运行的成本是 $Q^2 T$。');
});
test('翻译服务破坏公式标记时显示失败，不展示损坏的译文',async () => {
  const page=setup(() => '公式已丢失。');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.getRendered().children[1].textContent,/could not preserve inline code or formulas/);
  assert.match(page.getToast().textContent,/0 translated, 1 failed/);
});

test('量子电路页面只在相关段落中消歧 shot 和 Toffolis', async () => {
  async function run(title, text, target='zh-CN') {
    let listener, request, toast;
    const source={tagName:'P',textContent:text,isConnected:true,closest:() => null,querySelector:() => null,getClientRects:() => [1],insertAdjacentElement() {}};
    const document={title,querySelector:selector => selector==='article'?{querySelectorAll:() => [source]}:null,querySelectorAll:() => [],getElementById:() => toast,
      createElement:() => ({dataset:{},classList:{add() {}},setAttribute() {},append() {},addEventListener() {}}),body:{appendChild(node) {toast=node;}}};
    const chrome={runtime:{onMessage:{addListener:fn => {listener=fn;}},sendMessage:async message => {request=message;return {ok:true,translations:{[message.entries[0].id]:'译文'}};}}};
    vm.runInNewContext(script,{document,chrome,getComputedStyle:() => ({visibility:'visible',display:'block'})});
    listener({type:'CF_START',preferences:{engine:{provider:'google-web',source:'en',target},messages:contentMessages('en')}},{},() => {});
    await new Promise(resolve => setImmediate(resolve));
    return request.entries[0].text;
  }
  const input='One shot, stage by stage, on 4,096 shots: mean Toffolis and the peak of live qubits.';
  assert.equal(await run('Quantum Circuits | Kaggle',input),'One circuit run, stage by stage, on 4,096 circuit runs: mean Toffoli gates and the peak of live qubits.');
  assert.equal(await run('Photography',input),input);
  assert.equal(await run('Quantum Circuits | Kaggle',input,'ja'),input);
  assert.equal(await run('Quantum Circuits | Kaggle','This photo was taken in a single shot.'),'This photo was taken in a single shot.');
});
