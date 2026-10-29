(() => {
  if (globalThis.__contextFlowDiscussionInstalled) return;
  globalThis.__contextFlowDiscussionInstalled = true;

  function fail(key, values = {}) {
    const error = new Error(key);
    error.i18nKey = key;
    error.values = values;
    throw error;
  }

  async function readKaggle() {
    const match = location.pathname.match(/\/(\d+)(?:\/)?$/);
    if (!match) fail("kagglePage");
    const url = new URL("/api/i/discussions.DiscussionsService/GetForumTopicById", location.origin);
    url.searchParams.set("forumTopicId", match[1]);
    url.searchParams.set("includeComments", "true");
    const response = await fetch(url.href, {credentials: "same-origin"});
    if (!response.ok) fail("kaggleHttp", {status: response.status});
    const data = await response.json();
    const topic = data.forumTopic;
    if (!topic || !topic.firstMessage || (!Array.isArray(topic.comments) && Number(topic.totalMessages) > 0)) {
      fail("kaggleData");
    }
    if (!Array.isArray(topic.comments)) topic.comments = [];
    const count = comments => comments.reduce((sum, comment) => sum + 1 + count(Array.isArray(comment.replies) ? comment.replies : []), 0);
    const actual = count(topic.comments);
    const expected = Number(topic.totalMessages);
    const warningKey = Number.isFinite(expected) && expected > actual ? "incomplete" : "";
    return {topic, warningKey, warningValues: {expected, actual}};
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
    if (!page) fail("unsupported");
    function normalize(comment) {
      const author = typeof comment.author === "string" ? comment.author : comment.author?.name;
      const replies = comment.comment ? (Array.isArray(comment.comment) ? comment.comment : [comment.comment]) : [];
      return {authorName: author, text: comment.text, replies: replies.map(normalize)};
    }
    const comments = Array.isArray(page.comment) ? page.comment : [page.comment];
    const body = page.articleBody || page.text;
    const firstMessage = body ? normalize({author: page.author, text: body}) : null;
    return {topic: {firstMessage, comments: comments.map(normalize)}, warningKey: "structuredWarning"};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CF_COPY_DISCUSSION") return;
    Promise.resolve().then(() => location.hostname === "kaggle.com" || location.hostname === "www.kaggle.com"
      ? readKaggle() : readStructuredPage())
      .then(result => sendResponse({ok: true, ...result}))
      .catch(error => sendResponse({ok: false, errorKey: error?.i18nKey, values: error?.values, error: String(error?.message || error)}));
    return true;
  });
})();
