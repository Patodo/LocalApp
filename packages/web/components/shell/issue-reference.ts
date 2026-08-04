export const ISSUE_REFERENCE_PREFIX = "#localapp-issue-";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

const ISSUE_REFERENCE = /(^|[^\\\w])#([1-9]\d*)\b/g;

function transformText(node: MarkdownNode, source: string): MarkdownNode[] {
  const value = node.value ?? "";
  const result: MarkdownNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(ISSUE_REFERENCE)) {
    const prefix = match[1];
    const issueNumber = match[2];
    const hashOffset = (match.index ?? 0) + prefix.length;
    const sourceStart = node.position?.start?.offset;
    const sourceEnd = node.position?.end?.offset;
    if (typeof sourceStart === "number" && typeof sourceEnd === "number") {
      const raw = source.slice(sourceStart, sourceEnd);
      const rawHashOffset = raw.indexOf(`#${issueNumber}`);
      if (rawHashOffset > 0 && raw[rawHashOffset - 1] === "\\") continue;
    }
    if (hashOffset > offset) result.push({ type: "text", value: value.slice(offset, hashOffset) });
    result.push({ type: "link", url: `${ISSUE_REFERENCE_PREFIX}${issueNumber}`, children: [{ type: "text", value: `#${issueNumber}` }] });
    offset = hashOffset + issueNumber.length + 1;
  }
  if (offset === 0) return [node];
  if (offset < value.length) result.push({ type: "text", value: value.slice(offset) });
  return result;
}

function transformChildren(node: MarkdownNode, source: string): void {
  if (!node.children || ["link", "linkReference", "code", "inlineCode", "html"].includes(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text") return transformText(child, source);
    transformChildren(child, source);
    return [child];
  });
}

export function remarkIssueReferences() {
  return (tree: MarkdownNode, file: { value?: unknown }) => transformChildren(tree, String(file.value ?? ""));
}

export function readIssueReference(href?: string): number | null {
  if (!href?.startsWith(ISSUE_REFERENCE_PREFIX)) return null;
  const value = Number(href.slice(ISSUE_REFERENCE_PREFIX.length));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
