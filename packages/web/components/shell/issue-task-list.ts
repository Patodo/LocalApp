import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

interface TaskNode {
  type?: string;
  checked?: boolean | null;
  children?: TaskNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

export interface IssueTask {
  index: number;
  checked: boolean;
  markerOffset: number;
  title: string;
  convertible: boolean;
}

const TASK_MARKER = /^(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\]/;

function taskTitle(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectIssueTasks(markdown: string): IssueTask[] {
  if (!markdown.includes("[")) return [];
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as TaskNode;
  const tasks: IssueTask[] = [];

  const visit = (node: TaskNode) => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === "number" && typeof end === "number") {
        const marker = TASK_MARKER.exec(markdown.slice(start, end));
        if (marker) {
          const firstLine = markdown.slice(start + marker[0].length, end).split(/\r?\n/, 1)[0].trimEnd();
          const title = taskTitle(firstLine);
          tasks.push({ index: tasks.length, checked: node.checked, markerOffset: start + marker[0].length - 2, title, convertible: !node.checked && Boolean(title) && !/^#\d+$/.test(title) });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return tasks;
}

export function toggleIssueTask(markdown: string, taskIndex: number, checked: boolean): string {
  const task = collectIssueTasks(markdown)[taskIndex];
  if (!task) throw new Error("Task not found");
  if (task.checked === checked) throw new Error("Task state changed");
  return `${markdown.slice(0, task.markerOffset)}${checked ? "x" : " "}${markdown.slice(task.markerOffset + 1)}`;
}
