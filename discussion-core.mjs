// The input is normalized data, not HTML; Markdown and code remain intact.
export function formatDiscussion(topic, {emptyMessage = "没有找到可复制的讨论内容。"} = {}) {
  if (!topic || (!topic.firstMessage && !Array.isArray(topic.comments))) {
    throw new Error(emptyMessage);
  }
  const sections = [];
  const authorOf = (item, fallback = "") =>
    String(item?.author?.displayName || item?.author?.name || item?.authorName || fallback || "未知用户").trim();
  function append(item, parent, fallback) {
    const author = authorOf(item, fallback);
    const body = String(item?.rawMarkdown ?? item?.text ?? "").trim() || "[内容不可用或已删除]";
    sections.push(`${parent ? `${author} 回复 ${parent}` : author}：\n${body}`);
    for (const reply of Array.isArray(item?.replies) ? item.replies : []) append(reply, author);
  }
  if (topic.firstMessage) append(topic.firstMessage, "", topic.authorUserDisplayName || topic.authorUserName);
  const rootAuthor = topic.firstMessage ? authorOf(topic.firstMessage, topic.authorUserDisplayName || topic.authorUserName) : "";
  for (const comment of Array.isArray(topic.comments) ? topic.comments : []) append(comment, rootAuthor);
  if (!sections.length) throw new Error(emptyMessage);
  return {text: sections.join("\n\n"), count: sections.length};
}
