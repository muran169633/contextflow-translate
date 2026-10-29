import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModelRequest, modelEndpoint, modelPermission, parseModelResponse, providerName} from '../model-adapters.mjs';

const messages = [{role: 'system', content: 'Follow the system instruction.'}, {role: 'user', content: 'Translate this text.'}];

test('Gemini 原生接口使用固定官方地址和独立密钥', () => {
  const settings = {aiProvider: 'gemini', model: 'models/gemini-example', apiKey: 'gemini-key', endpoint: 'https://wrong.example'};
  const request = buildModelRequest(messages, settings);
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-example:generateContent');
  assert.equal(request.headers['x-goog-api-key'], 'gemini-key');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(modelPermission(settings), 'https://generativelanguage.googleapis.com/*');
  assert.equal(request.body.systemInstruction.parts[0].text, messages[0].content);
  assert.equal(request.body.contents[0].parts[0].text, messages[1].content);
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(parseModelResponse({candidates: [{finishReason: 'STOP', content: {parts: [{thought: true, text: 'internal'}, {text: '{"ok":true}'}]}}]}, settings), '{"ok":true}');
  assert.throws(() => parseModelResponse({candidates: [{finishReason: 'MAX_TOKENS'}]}, settings), /MAX_TOKENS/);
  assert.throws(() => modelEndpoint({...settings, model: '../unsafe'}), /valid Gemini/);
});

test('Claude 原生接口使用官方消息协议并拒绝截断输出', () => {
  const settings = {aiProvider: 'anthropic', model: 'claude-example', apiKey: 'claude-key', endpoint: 'https://wrong.example'};
  const request = buildModelRequest(messages, settings);
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers['x-api-key'], 'claude-key');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.body.model, 'claude-example');
  assert.equal(request.body.system, messages[0].content);
  assert.equal(request.body.messages[0].content, messages[1].content);
  assert.equal(parseModelResponse({stop_reason: 'end_turn', content: [{type: 'text', text: '{"ok":true}'}]}, settings), '{"ok":true}');
  assert.throws(() => parseModelResponse({stop_reason: 'max_tokens'}, settings), /output limit/);
  assert.throws(() => buildModelRequest(messages, {...settings, apiKey: ''}), /requires an API key/);
});

test('旧配置默认使用兼容接口，非法提供商不会静默回退', () => {
  const settings = {endpoint: 'https://gateway.example/v1', model: 'model-x', apiKey: 'key'};
  const request = buildModelRequest(messages, settings);
  assert.equal(providerName(settings), 'compatible');
  assert.equal(request.url, 'https://gateway.example/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer key');
  assert.throws(() => providerName({aiProvider: 'unknown'}), /Unsupported/);
});
