interface IssueTimeProps {
  timestamp: string;
  href?: string;
  precise?: boolean;
  now?: number;
  className?: string;
}

export function formatIssueRelativeTime(timestamp: string, now = Date.now()): string {
  const milliseconds = new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return timestamp;
  const minutes = Math.floor(Math.max(0, now - milliseconds) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}天前` : new Date(milliseconds).toLocaleDateString();
}

export function IssueTime({ timestamp, href, precise = false, now, className }: IssueTimeProps) {
  const date = new Date(timestamp);
  const exact = Number.isFinite(date.getTime()) ? date.toLocaleString() : timestamp;
  const label = precise ? exact : formatIssueRelativeTime(timestamp, now);
  const time = <time dateTime={timestamp} title={exact} className={href ? undefined : className}>{label}</time>;
  return href ? <a href={href} className={`-my-2 inline-flex h-11 items-center px-1 sm:-my-0 sm:h-6 ${className ?? ""}`}>{time}</a> : time;
}
