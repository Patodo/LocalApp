const ISSUE_ATTACHMENT_MARKDOWN = /!?\[[^\]]*\]\((?:https?:\/\/[^)]+)?\/api\/issues\/attachments\/[^)]+\)/gi;

export function referenceIssueComment(body: string, authorId: string, issueNumber: number, commentHref: string): string {
  const cleaned = body.replace(ISSUE_ATTACHMENT_MARKDOWN, "").replace(/[ \t]+$/gm, "").trim();
  const characters = Array.from(cleaned);
  const excerpt = characters.length > 500 ? `${characters.slice(0, 499).join("")}…` : cleaned;
  const quote = (excerpt || `@${authorId} 的附件评论`).split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `${quote}\n\n来源：#${issueNumber}\n\n[查看 @${authorId} 的原评论](${commentHref})`;
}
