export interface IssueMentionQuery {
  start: number;
  end: number;
  query: string;
}

const MENTION_QUERY_PATTERN = /(?:^|[^A-Za-z0-9_.+@/-])@([A-Za-z0-9_-]{0,64})$/;

export function findIssueMentionQuery(value: string, caret: number): IssueMentionQuery | null {
  const beforeCaret = value.slice(0, Math.max(0, caret));
  const match = beforeCaret.match(MENTION_QUERY_PATTERN);
  if (!match) return null;
  const start = beforeCaret.length - match[1].length - 1;
  return { start, end: caret, query: match[1] };
}

export function applyIssueMention(value: string, mention: IssueMentionQuery, userId: string): { value: string; caret: number } {
  const inserted = `@${userId} `;
  return {
    value: value.slice(0, mention.start) + inserted + value.slice(mention.end),
    caret: mention.start + inserted.length,
  };
}
