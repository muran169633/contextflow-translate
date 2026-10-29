(() => {
  if (globalThis.__contextFlowDiscussionInstalled) return;
  globalThis.__contextFlowDiscussionInstalled = true;

  async function readKaggle() {
    const match = location.pathname.match(/\/(\d+)(?:\/)?$/);
    if (!match) throw new Error("请打开 Kaggle 的具体讨论页面，再点击复制讨论。");
    const url = new URL("/api/i/discussions.DiscussionsService/GetForumTopicById", location.origin);
    url.searchParams.set("forumTopicId", match[1]);
    url.searchParams.set("includeComments", "true");
    const response = await fetch(url.href, {credentials: "same-origin"});
    if (!response.ok) throw new Error(`Kaggle 讨论读取失败（HTTP ${response.status}）；请检查登录状态后重试。`);
    const data = await response.json();
    const topic = data.forumTopic;
    if (!topic || !topic.firstMessage || (!Array.isArray(topic.comments) && Number(topic.totalMessages) > 0)) {
      throw new Error("Kaggle 未返回完整讨论数据，请检查页面权限后重试。");
    }
    if (!Array.isArray(topic.comments)) topic.comments = [];
    const count = comments => comments.reduce((sum, comment) => sum + 1 + count(Array.isArray(comment.replies) ? comment.replies : []), 0);
    const actual = count(topic.comments);
    const expected = Number(topic.totalMessages);
    const warning = Number.isFinite(expected) && expected > actual
      ? `Kaggle 报告 ${expected} 条回复，但仅返回 ${actual} 条；复制内容可能不完整。` : "";
    return {topic, warning};
  }

  function readStructuredPage() {
    const nodes = [];
    function collect(value) {
      if (Array.isArray(value)) return value.forEach(collect);
      if (!value || typeof value !== "object") return;
      if (value["@graph"]) collect(value["@graph"]);
      if (value.comment) nodes.push(value);
    }
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { collect(JSON.parse(script.textContent)); } catch {}
    }
    const page = nodes[0];
    if (!page) throw new Error("此网站没有可识别的结构化讨论数据；目前支持 Kaggle 和提供结构化评论的网页。");
    function normalize(comment) {
      const author = typeof comment.author === "string" ? comment.author : comment.author?.name;
      const replies = comment.comment ? (Array.isArray(comment.comment) ? comment.comment : [comment.comment]) : [];
      return {authorName: author, text: comment.text, replies: replies.map(normalize)};
    }
    const comments = Array.isArray(page.comment) ? page.comment : [page.comment];
    const body = page.articleBody || page.text;
    const firstMessage = body ? normalize({author: page.author, text: body}) : null;
    return {topic: {firstMessage, comments: comments.map(normalize)}, warning: "只复制网页提供的结构化评论；未加载的回复可能缺失。"};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CF_COPY_DISCUSSION") return;
    Promise.resolve().then(() => location.hostname === "kaggle.com" || location.hostname === "www.kaggle.com"
      ? readKaggle() : readStructuredPage())
      .then(result => sendResponse({ok: true, ...result}))
      .catch(error => sendResponse({ok: false, error: String(error?.message || error)}));
    return true;
  });
})();
