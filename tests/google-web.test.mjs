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
