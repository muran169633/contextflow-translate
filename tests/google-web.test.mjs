import test from 'node:test';
import assert from 'node:assert/strict';
import {translateGoogleWeb} from '../google-web-translate.mjs';

test('免密钥 Google 网页接口发送选定语种并合并返回的句子', async () => {
  let requested;
  const result = await translateGoogleWeb([{id: 'cf-1', text: 'Hello. How are you?'}], {source: 'en', target: 'zh-CN'}, async url => {
    requested = new URL(url);
    return {ok: true, json: async () => [[['你好。', 'Hello.'], ['你好吗？', 'How are you?']]]};
  });
  assert.equal(requested.origin, 'https://translate.googleapis.com');
  assert.equal(requested.searchParams.get('sl'), 'en');
  assert.equal(requested.searchParams.get('tl'), 'zh-CN');
  assert.equal(requested.searchParams.get('q'), 'Hello. How are you?');
  assert.equal(result['cf-1'], '你好。你好吗？');
});

test('免密钥接口被限流或返回异常时明确失败，不切换其他服务', async () => {
  const entries = [{id: 'cf-1', text: 'Hello.'}];
  const engine = {source: 'en', target: 'zh-CN'};
  await assert.rejects(translateGoogleWeb(entries, engine, async () => ({ok: false, status: 429})), /429.*rate-limited/);
  await assert.rejects(translateGoogleWeb(entries, engine, async () => ({ok: true, json: async () => [null]})), /incomplete/);
  await assert.rejects(translateGoogleWeb(entries, engine, async () => { throw new Error('network unavailable'); }), /connection failed.*network unavailable/);
});

test('短段落合并请求且核对原文和译文边界后再映射', async () => {
  const entries = [{id:'cf-1',text:'First paragraph.'},{id:'cf-2',text:'Second paragraph.'},{id:'cf-3',text:'Third paragraph.'}];
  const requests=[];
  const result=await translateGoogleWeb(entries,{source:'en',target:'zh-CN'},async url => {
    const text=new URL(url).searchParams.get('q'); requests.push(text);
    return {ok:true,json:async () => [[['第一段。\n\n第二段。\n\n第三段。',text]]]};
  });
  assert.deepEqual(requests, ['First paragraph.\n\nSecond paragraph.\n\nThird paragraph.']);
  assert.deepEqual(result, {'cf-1':'第一段。','cf-2':'第二段。','cf-3':'第三段。'});
});

test('批量边界不完整时按原段重试，不将译文错贴', async () => {
  const entries=[{id:'cf-1',text:'First.'},{id:'cf-2',text:'Second.'}];
  const requests=[];
  const result=await translateGoogleWeb(entries,{source:'en',target:'zh-CN'},async url => {
    const text=new URL(url).searchParams.get('q');requests.push(text);
    if (text.includes('\n')) return {ok:true,json:async () => [[['边界丢失',text]]]};
    return {ok:true,json:async () => [[[text==='First.'?'第一段':'第二段',text]]]};
  });
  assert.deepEqual(requests,['First.\n\nSecond.','First.','Second.']);
  assert.deepEqual(result,{'cf-1':'第一段','cf-2':'第二段'});
});

test('批量请求限流时直接报告，不继续重试或切换服务', async () => {
  let calls=0;
  await assert.rejects(translateGoogleWeb([{id:'cf-1',text:'First.'},{id:'cf-2',text:'Second.'}],{source:'en',target:'zh-CN'},async () => {calls++;return {ok:false,status:429};}),/429/);
  assert.equal(calls,1);
});

test('原文无法核对时不能仅凭译文的分隔符映射段落', async () => {
  const seen=[];
  const result=await translateGoogleWeb([{id:'cf-1',text:'First.'},{id:'cf-2',text:'Second.'}],{source:'en',target:'zh-CN'},async url => {
    const text=new URL(url).searchParams.get('q'); seen.push(text);
    return {ok:true,json:async () => [[text.includes('\n')?['第一段\n\n第二段', 'different source']:[text, text]]]};
  });
  assert.equal(seen.length,3);
  assert.deepEqual(result,{'cf-1':'First.','cf-2':'Second.'});
});

test('批量边界不匹配时最多三个单段请求并行，结果按原段映射', async () => {
  const items=Array.from({length:5},(_,i)=>({id:`cf-${i}`,text:`paragraph ${i}`}));
  const pending=[];
  const run=translateGoogleWeb(items,{source:'en',target:'zh-CN'},async url=>{
    const text=new URL(url).searchParams.get('q');
    if (text.includes('\n')) return {ok:true,json:async()=>[[['边界丢失',text]]]};
    return await new Promise(resolve=>pending.push({text,resolve}));
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,3);
  const finish=item=>item.resolve({ok:true,json:async()=>[[[`译:${item.text}`,item.text]]]});
  finish(pending[1]); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,4);
  finish(pending[0]); finish(pending[2]); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,5);
  finish(pending[3]); finish(pending[4]);
  const result=await run;
  for (const item of items) assert.equal(result[item.id],`译:${item.text}`);
});

test('多个页面共用 Google 请求并发上限，失败后不继续启动该批请求', async () => {
  const pending=[];
  let active=0, maximum=0;
  const fetcher=url=>new Promise(resolve=>{
    active++; maximum=Math.max(maximum,active);
    const text=new URL(url).searchParams.get('q');
    pending.push({text,finish(response){active--;resolve(response);}});
  });
  const engine={source:'auto',target:'zh-CN'};
  const runs=Array.from({length:4},(_,i)=>translateGoogleWeb([{id:`cf-${i}`,text:`hello ${i}`}],engine,fetcher));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,3);
  pending[1].finish({ok:true,json:async()=>[[['你好',pending[1].text]]]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,4);
  for(const index of [0,2,3]) pending[index].finish({ok:true,json:async()=>[[['你好',pending[index].text]]]});
  await Promise.all(runs);
  assert.equal(maximum,3);

  pending.length=0; active=0;
  const items=Array.from({length:6},(_,i)=>({id:`cf-${i}`,text:`text ${i}`}));
  const failed=translateGoogleWeb(items,engine,fetcher);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,3);
  pending[0].finish({ok:false,status:429});
  await new Promise(resolve=>setImmediate(resolve));
  for(const index of [1,2]) pending[index].finish({ok:true,json:async()=>[[['你好',pending[index].text]]]});
  await assert.rejects(failed,/429/);
  assert.equal(pending.length,3);
});

test('长段落分片并发返回后仍按原始顺序拼接', async () => {
  const pending=[];
  const text='甲'.repeat(400)+'乙'.repeat(400)+'丙'.repeat(400);
  const run=translateGoogleWeb([{id:'cf-1',text}],{source:'zh-CN',target:'en'},url=>new Promise(resolve=>pending.push({url:new URL(url),resolve})));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,3);
  const result=(index,value)=>pending[index].resolve({ok:true,json:async()=>[[[value,pending[index].url.searchParams.get('q')]]]});
  result(2,'third'); result(0,'first'); result(1,'second');
  assert.equal((await run)['cf-1'],'first second third');
});

test('共享并发槽中的请求遇到限流后，不启动同批尚在排队的分片', async () => {
  const pending=[];
  const fetcher=url=>new Promise(resolve=>pending.push({url,resolve}));
  const engine={source:'auto',target:'zh-CN'};
  const other=translateGoogleWeb([{id:'cf-100',text:'Other page'}],engine,fetcher);
  await new Promise(resolve=>setImmediate(resolve));
  const failed=translateGoogleWeb([{id:'cf-1',text:'One'},{id:'cf-2',text:'Two'},{id:'cf-3',text:'Three'}],engine,fetcher);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,3);
  pending[1].resolve({ok:false,status:429});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,3);
  for (const i of [0,2]) {
    const text=new URL(pending[i].url).searchParams.get('q');
    pending[i].resolve({ok:true,json:async()=>[[['译文',text]]]});
  }
  await assert.rejects(failed,/429/);
  await other;
});
