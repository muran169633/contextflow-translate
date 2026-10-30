export const KAGGLE_NOTEBOOK_ORIGIN = 'https://www.kaggleusercontent.com/*';

export function isKaggleNotebook(url) {
  try {
    const value = new URL(url);
    return value.protocol === 'https:' && value.hostname === 'www.kaggle.com' && /^\/code\/[^/]+\/[^/]+(?:\/|$)/.test(value.pathname);
  } catch { return false; }
}

// 获取具体框架 ID，避免把翻译请求广播给无关的第三方 iframe。
export async function sendToKaggleNotebook(tabId, message, inject = false) {
  if (!await chrome.permissions.contains({permissions: ['webNavigation'], origins: [KAGGLE_NOTEBOOK_ORIGIN]})) return {status:'permission', found:0, started:false};
  let frames;
  try { frames = await chrome.webNavigation.getAllFrames({tabId}); }
  catch { return {status:'unavailable', found:0, started:false}; }
  const targets = (frames || []).filter(frame => {
    if (!Number.isInteger(frame.frameId) || frame.frameId === 0) return false;
    try {
      const url = new URL(frame.url);
      return url.protocol === 'https:' && url.hostname === 'www.kaggleusercontent.com' && url.pathname.startsWith('/kf/');
    } catch { return false; }
  });
  if (!targets.length) return {status:'missing', found:0, started:false};
  const results = await Promise.all(targets.map(async frame => {
    const options = frame.documentId ? {documentId: frame.documentId} : {frameId: frame.frameId};
    try {
      let ping;
      try { ping = await chrome.tabs.sendMessage(tabId, {type:'CF_PING'}, options); } catch {}
      if (!ping?.ok && inject) {
        const target = frame.documentId ? {tabId, documentIds:[frame.documentId]} : {tabId, frameIds:[frame.frameId]};
        await chrome.scripting.insertCSS({target, files:['content.css']});
        await chrome.scripting.executeScript({target, files:['content.js']});
        ping = await chrome.tabs.sendMessage(tabId, {type:'CF_PING'}, options);
      }
      if (!ping?.ok) return {status:'unavailable'};
      if (ping.protocol !== 21) return {status:'outdated'};
      const result = await chrome.tabs.sendMessage(tabId, message, options);
      return result?.ok ? {status:'ok', ...result} : {status:'unavailable'};
    } catch { return {status:'unavailable'}; }
  }));
  const failure = results.find(result => result.status !== 'ok');
  return {status:failure?.status || 'ok', found:results.reduce((sum, result) => sum + (result.found || 0), 0),
    started:results.some(result => result.started), truncated:results.some(result => result.truncated), frames:targets.length};
}
