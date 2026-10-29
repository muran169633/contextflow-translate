import test from 'node:test';
import assert from 'node:assert/strict';
import {isKaggleNotebook, KAGGLE_NOTEBOOK_ORIGIN, sendToKaggleNotebook} from '../kaggle-frames.mjs';

let permission=true, installed=false, frames=[], operations=[];
globalThis.chrome={
  permissions:{contains:async ({origins}) => permission && origins[0]===KAGGLE_NOTEBOOK_ORIGIN},
  webNavigation:{getAllFrames:async () => frames},
  tabs:{sendMessage:async (tabId, message, options) => {
    operations.push({action:'message',tabId,type:message.type,frameId:options.frameId,documentId:options.documentId});
    if (message.type==='CF_PING') {if (!installed) throw Error('no script'); return {ok:true,protocol:16};}
    return {ok:true,started:message.type==='CF_START',found:message.type==='CF_START'?4:0};
  }},
  scripting:{insertCSS:async payload => {operations.push({action:'css',payload});},executeScript:async payload => {operations.push({action:'script',payload});installed=true;}}
};

test('仅对 Kaggle Notebook 请求正文框架权限和脚本', async () => {
  assert.equal(isKaggleNotebook('https://www.kaggle.com/code/somejoint/notebook/notebook'),true);
  assert.equal(isKaggleNotebook('https://www.kaggle.com/competitions/a/discussion'),false);
  assert.equal(isKaggleNotebook('https://www.kaggle.com.evil.test/code/a/b'),false);
  assert.equal(isKaggleNotebook('http://www.kaggle.com/code/a/b'),false);
  permission=false;
  assert.equal((await sendToKaggleNotebook(7,{type:'CF_START'},true)).status,'permission');
  permission=true;
});

test('框架存在 documentId 时绑定具体文档，避免导航后向错误页面注入', async () => {
  frames=[{frameId:3,documentId:'document-123',url:'https://www.kaggleusercontent.com/kf/123/__results__.html'}];
  installed=false;operations=[];
  assert.equal((await sendToKaggleNotebook(7,{type:'CF_START'},true)).status,'ok');
  assert.deepEqual(operations.find(item=>item.action==='script').payload.target,{tabId:7,documentIds:['document-123']});
  assert.ok(operations.filter(item=>item.action==='message').every(item=>item.documentId==='document-123'));
});

test('只向实际 Kaggle 内容框架注入和发送翻译消息', async () => {
  frames=[{frameId:0,url:'https://www.kaggle.com/code/a/b'}, {frameId:3,url:'https://www.kaggleusercontent.com/kf/123/__results__.html?secret=example'}, {frameId:4,url:'https://other.example/widget'}, {frameId:5,url:'https://www.kaggleusercontent.com/other'}];
  operations=[]; installed=false;
  const result=await sendToKaggleNotebook(7,{type:'CF_START',preferences:{engine:{provider:'google-web'}}},true);
  assert.equal(result.status,'ok'); assert.equal(result.found,4); assert.equal(result.started,true);
  assert.deepEqual(operations.filter(item=>item.action==='message').map(item=>item.frameId),[3,3,3]);
  assert.deepEqual(operations.find(item=>item.action==='script').payload.target,{tabId:7,frameIds:[3]});
  assert.equal(JSON.stringify(result).includes('secret'),false);
  operations=[];
  await sendToKaggleNotebook(7,{type:'CF_STOP'});
  assert.equal(operations.filter(item=>item.action==='script').length,0);
  assert.equal(operations.at(-1).type,'CF_STOP');
});

test('正文框架未加载或权限不足时给出状态，不声称正文已翻译', async () => {
  frames=[{frameId:0,url:'https://www.kaggle.com/code/a/b'}];
  assert.equal((await sendToKaggleNotebook(7,{type:'CF_START'},true)).status,'missing');
  frames=[{frameId:3,url:'https://www.kaggleusercontent.com/kf/123/__results__.html'}];
  installed=false;
  assert.equal((await sendToKaggleNotebook(7,{type:'CF_CLEAR'})).status,'unavailable');
});
