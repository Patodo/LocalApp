export interface IssueSavedReplyInsertion {
  body: string;
  selectionStart: number;
  selectionEnd: number;
}

export function insertIssueSavedReply(body: string, selectionStart: number, selectionEnd: number, reply: string): IssueSavedReplyInsertion {
  const start = Math.max(0, Math.min(selectionStart, body.length));
  const end = Math.max(start, Math.min(selectionEnd, body.length));
  const markerIndex = reply.indexOf("%cursor%");
  const inserted = markerIndex < 0 ? reply : `${reply.slice(0, markerIndex)}${reply.slice(markerIndex + 8)}`;
  const nextBody = `${body.slice(0, start)}${inserted}${body.slice(end)}`;
  const caret = start + (markerIndex < 0 ? inserted.length : markerIndex);
  return { body: nextBody, selectionStart: caret, selectionEnd: caret };
}
