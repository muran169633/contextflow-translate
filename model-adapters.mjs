import {normalizeEndpoint} from './core.mjs';

export const MODEL_PROVIDERS = Object.freeze(['compatible', 'gemini', 'anthropic']);
export const MODEL_BASE_URLS = Object.freeze({
  compatible: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1'
});

export function providerName(settings) {
  const provider = settings.aiProvider || 'compatible';
  if (!MODEL_PROVIDERS.includes(provider)) throw new Error('Unsupported model API provider.');
  return provider;
}

export function providerBase(settings) {
  const provider = providerName(settings);
  return provider === 'compatible' ? normalizeEndpoint(settings.endpoint) : MODEL_BASE_URLS[provider];
}

export function modelPermission(settings) {
  const url = new URL(providerBase(settings));
  return `${url.protocol}//${url.hostname}/*`;
}

export function modelEndpoint(settings) {
  const provider = providerName(settings);
  if (provider === 'compatible') return providerBase(settings);
  if (provider === 'anthropic') return `${MODEL_BASE_URLS.anthropic}/messages`;
  const model = String(settings.model || '').trim().replace(/^models\//, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) throw new Error('Enter a valid Gemini model ID.');
  return `${MODEL_BASE_URLS.gemini}/models/${model}:generateContent`;
}

export function buildModelRequest(messages, settings) {
  const provider = providerName(settings);
  const model = String(settings.model || '').trim();
  const apiKey = String(settings.apiKey || '').trim();
  if (!model) throw new Error('Set a model ID in Settings first.');
  if (provider !== 'compatible' && !apiKey) throw new Error(`${provider === 'gemini' ? 'Gemini' : 'Claude'} requires an API key.`);
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const user = messages.filter(message => message.role !== 'system');
  const headers = {'Content-Type': 'application/json'};
  let body;
  if (provider === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
    body = {systemInstruction: {parts: [{text: system}]}, contents: user.map(message => ({role: message.role === 'assistant' ? 'model' : 'user', parts: [{text: message.content}]})), generationConfig: {temperature: 0.1, responseMimeType: 'application/json'}};
  } else if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {model, max_tokens: 8192, system, messages: user.map(message => ({role: message.role, content: message.content})), temperature: 0.1};
  } else {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = {model, messages, temperature: 0.1, stream: false};
  }
  return {url: modelEndpoint(settings), headers, body};
}

export function parseModelResponse(data, settings) {
  const provider = providerName(settings);
  if (provider === 'gemini') {
    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error(`Gemini response stopped: ${candidate.finishReason}`);
    const text = candidate?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    if (!text) throw new Error('Gemini returned no text; check model access and safety settings.');
    return text;
  }
  if (provider === 'anthropic') {
    if (data?.stop_reason === 'max_tokens') throw new Error('Claude response exceeded its output limit.');
    const text = data?.content?.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('');
    if (!text) throw new Error('Claude returned no text.');
    return text;
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text) throw new Error('API response is missing choices[0].message.content.');
  return text;
}
