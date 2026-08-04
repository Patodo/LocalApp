import type { IssueLabelDefinition } from "./issue-types";

export function IssueLabelBadge({ label, onSelect }: { label: IssueLabelDefinition; onSelect?: (labelId: string) => void }) {
  const content = <><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${label.color}` }} />{label.name}</>;
  if (onSelect) {
    return <button type="button" aria-label={`按标签筛选 ${label.name}`} onClick={() => onSelect(label.id)} className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button>;
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">{content}</span>;
}
