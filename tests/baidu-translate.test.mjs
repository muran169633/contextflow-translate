import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {md5} from '../md5.mjs';
import {translateBaidu, createBaiduGate} from '../baidu-translate.mjs';
import {normalizeEngine} from '../free-translate.mjs';

const engine={provider:'baidu',source:'en',target:'zh-CN'};
const entries=[{id:'cf-1',text:'First paragraph.'},{id:'cf-2',text:'Second paragraph.'}];
const instant = fn => fn();

test('MD5 签名与百度示例及标准实现一致，支持中文和边界长度',()=>{
  assert.equal(md5('2015063000000001apple143566028812345678'),'f89f9594663708c1605f3d736d01d2d4');
  for (const text of ['', 'abc', '你好 🌏', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), '量子'.repeat(600)]) {
    assert.equal(md5(text),createHash('md5').update(text).digest('hex'));
  }
});

test('百度批量请求签名、语言编码、段落对齐和密钥保护',async()=>{
  const requests=[];
  const result=await translateBaidu(entries,engine,'id','secret',{gate:instant,salt:()=> '42',fetcher:async(url,options)=>{
    const form=options.body; requests.push({url,form});
    assert.equal(form.get('sign'),createHash('md5').update('id'+form.get('q')+'42secret').digest('hex'));
    assert.equal(form.get('from'),'en'); assert.equal(form.get('to'),'zh');
    assert.equal(url,'https://fanyi-api.baidu.com/api/trans/vip/translate');
    return {ok:true,json:async()=>({trans_result:[{src:entries[0].text,dst:'第一段'},{src:entries[1].text,dst:'第二段'}]})};
  }});
  assert.equal(requests.length,1);
  assert.deepEqual(result,{'cf-1':'第一段','cf-2':'第二段'});
  assert.equal(JSON.stringify([...requests[0].form]).includes('secret'),false);
  assert.equal(normalizeEngine(engine).provider,'baidu');
});

test('自动检测逐段发送，超长文本按标准版限制拆分',async()=>{
  const seen=[];
  const values=[{id:'cf-1',text:'Bonjour.'},{id:'cf-2',text:'日本語'},{id:'cf-3',text:'量'.repeat(700)}];
  const result=await translateBaidu(values,{...engine,source:'auto'},'id','secret',{gate:instant,salt:()=> '1',fetcher:async(_url,{body})=>{
    const q=body.get('q');seen.push(q);assert.equal(body.get('from'),'auto');assert.ok(Buffer.byteLength(q)<=900);
    return {ok:true,json:async()=>({trans_result:[{src:q,dst:'译'}]})};
  }});
  assert.equal(seen.length,5);
  assert.equal(result['cf-2'],'译');
});

test('批次边界错误不会错贴译文，服务错误明确报告',async()=>{
  const mismatch=()=>({ok:true,json:async()=>({trans_result:[{src:'unmatched',dst:'译文'}]})});
  await assert.rejects(translateBaidu(entries,engine,'id','secret',{gate:instant,salt:()=> '1',fetcher:async()=>mismatch()}),error=>error.fatal===false && /boundaries/.test(error.message));
  await assert.rejects(translateBaidu(entries,engine,'id','secret',{gate:instant,salt:()=> '1',fetcher:async()=>({ok:true,json:async()=>({error_code:'54003',error_msg:'frequency limited'})})}),/54003/);
});

test('同一后台队列跨请求限制发起频率，即使上一次失败',async()=>{
  let clock=0;
  const starts=[];
  const gate=createBaiduGate({now:()=>clock,sleep:async ms=>{clock+=ms;},interval:1100});
  const jobs=[gate(async()=>{starts.push(clock);throw new Error('fail');}),gate(async()=>{starts.push(clock);}),gate(async()=>{starts.push(clock);})];
  await Promise.allSettled(jobs);
  assert.deepEqual(starts,[0,1100,2200]);
});
