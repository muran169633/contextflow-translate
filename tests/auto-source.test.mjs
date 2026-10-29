import test from 'node:test';
import assert from 'node:assert/strict';
import {translateGoogleWeb} from '../google-web-translate.mjs';
import {translateGoogle} from '../google-translate.mjs';
import {translateMicrosoft} from '../microsoft-translate.mjs';
import {translateYoudao} from '../youdao-translate.mjs';
import {normalizeEngine} from '../free-translate.mjs';

const mixed=[{id:'cf-1',text:'Bonjour le monde.'},{id:'cf-2',text:'こんにちは世界。'}];
const auto={provider:'google-web',source:'auto',target:'zh-CN'};
test('Google 免密钥逐段自动检测，混合语言不会共用检测结果',async()=>{
  const requests=[];
  const result=await translateGoogleWeb(mixed,auto,async url=>{
    const parsed=new URL(url); requests.push(parsed);
    const q=parsed.searchParams.get('q');
    return {ok:true,json:async()=>[[[q===mixed[0].text?'你好（法语）':'你好（日语）',q]]]};
  });
  assert.equal(requests.length,2);
  assert.ok(requests.every(url=>url.searchParams.get('sl')==='auto'));
  assert.deepEqual(result,{'cf-1':'你好（法语）','cf-2':'你好（日语）'});
});

test('Google Cloud 与微软省略源语言，有道传入 auto',async()=>{
  await translateGoogle([mixed[0]],auto,'key',async (_url,init)=>{
    assert.equal(Object.hasOwn(JSON.parse(init.body),'source'),false);
    return {ok:true,json:async()=>({data:{translations:[{translatedText:'你好'}]}})};
  });
  await translateMicrosoft([mixed[0]],auto,'key','eastus',async (url)=>{
    assert.equal(new URL(url).searchParams.has('from'),false);
    return {ok:true,json:async()=>[{translations:[{text:'你好'}]}]};
  });
  await translateYoudao([mixed[0]],auto,'id','secret',async (_url,init)=>{
    assert.equal(init.body.get('from'),'auto');
    return {ok:true,json:async()=>({errorCode:'0',translation:['你好']})};
  });
});

test('自动源语言不会被当成目标语言，MyMemory 不接受自动源语言',()=>{
  assert.equal(normalizeEngine(auto).source,'auto');
  assert.equal(normalizeEngine({...auto,provider:'mymemory'}).source,'en');
  assert.equal(normalizeEngine({...auto,target:'auto'}).target,'zh-CN');
});
