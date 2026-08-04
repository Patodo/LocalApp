import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { IssueAttachment } from "./issue-types";

interface AttachmentReferenceNode {
  type?: string;
  url?: string;
  children?: AttachmentReferenceNode[];
}

function attachmentIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://localapp.local");
    const match = /^\/api\/issues\/attachments\/([^/]+)$/.exec(url.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function collectReferencedIssueAttachmentIds(markdown: string): Set<string> {
  if (!markdown.includes("/api/issues/attachments/")) return new Set();
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as AttachmentReferenceNode;
  const referenced = new Set<string>();
  const visit = (node: AttachmentReferenceNode) => {
    if ((node.type === "image" || node.type === "link") && typeof node.url === "string") {
      const attachmentId = attachmentIdFromUrl(node.url);
      if (attachmentId) referenced.add(attachmentId);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return referenced;
}

export function filterUnreferencedIssueAttachments(markdown: string, attachments: readonly IssueAttachment[]): IssueAttachment[] {
  const referenced = collectReferencedIssueAttachmentIds(markdown);
  return referenced.size === 0 ? [...attachments] : attachments.filter((attachment) => !referenced.has(attachment.id));
}
