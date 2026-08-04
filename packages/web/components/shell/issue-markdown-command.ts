export type MarkdownCommand =
  | "heading"
  | "bold"
  | "italic"
  | "quote"
  | "code"
  | "link"
  | "bullet-list"
  | "ordered-list"
  | "task-list";

export interface MarkdownSelection {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const BLOCK_COMMANDS = new Set<MarkdownCommand>([
  "heading",
  "quote",
  "bullet-list",
  "ordered-list",
  "task-list",
]);

const BLOCK_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

function inlineCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: Exclude<MarkdownCommand, "heading" | "quote" | "bullet-list" | "ordered-list" | "task-list">,
): MarkdownSelection {
  const selected = value.slice(selectionStart, selectionEnd);
  const config = {
    bold: { before: "**", after: "**", placeholder: "粗体文本" },
    italic: { before: "_", after: "_", placeholder: "斜体文本" },
    code: { before: "`", after: "`", placeholder: "代码" },
  } as const;

  if (command === "link") {
    const label = selected || "链接文字";
    const replacement = `[${label}](url)`;
    const urlStart = selectionStart + label.length + 3;
    return {
      value: value.slice(0, selectionStart) + replacement + value.slice(selectionEnd),
      selectionStart: urlStart,
      selectionEnd: urlStart + 3,
    };
  }

  const { before, after, placeholder } = config[command];
  const content = selected || placeholder;
  const replacement = before + content + after;
  const nextStart = selectionStart + before.length;
  return {
    value: value.slice(0, selectionStart) + replacement + value.slice(selectionEnd),
    selectionStart: nextStart,
    selectionEnd: nextStart + content.length,
  };
}

function blockCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: Extract<MarkdownCommand, "heading" | "quote" | "bullet-list" | "ordered-list" | "task-list">,
): MarkdownSelection {
  const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const lastSelectedOffset = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd;
  const nextNewline = value.indexOf("\n", lastSelectedOffset);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;
  const selectedBlock = value.slice(blockStart, blockEnd);
  const placeholder = command === "heading" ? "标题" : command === "quote" ? "引用" : command === "task-list" ? "任务" : "列表项";
  const lines = (selectedBlock || placeholder).split("\n").map((line) => line.replace(BLOCK_PREFIX, ""));
  const transformed = lines.map((line, index) => {
    if (command === "heading") return `## ${line}`;
    if (command === "quote") return `> ${line}`;
    if (command === "bullet-list") return `- ${line}`;
    if (command === "ordered-list") return `${index + 1}. ${line}`;
    return `- [ ] ${line}`;
  }).join("\n");

  return {
    value: value.slice(0, blockStart) + transformed + value.slice(blockEnd),
    selectionStart: blockStart,
    selectionEnd: blockStart + transformed.length,
  };
}

export function applyMarkdownCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: MarkdownCommand,
): MarkdownSelection {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
  if (BLOCK_COMMANDS.has(command)) {
    return blockCommand(value, safeStart, safeEnd, command as Extract<MarkdownCommand, "heading" | "quote" | "bullet-list" | "ordered-list" | "task-list">);
  }
  return inlineCommand(value, safeStart, safeEnd, command as Exclude<MarkdownCommand, "heading" | "quote" | "bullet-list" | "ordered-list" | "task-list">);
}
