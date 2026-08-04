import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  Copy,
  FileJson,
  FolderOpen,
  Globe2,
  Hash,
  Package,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocalTask, TaskLogs } from "../lib/types";

interface TasksViewProps {
  tasks: LocalTask[];
  onTrustAndRun: (requestId: string) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
  onPin: (requestId: string, pinned: boolean) => Promise<void>;
  onReadLogs: (requestId: string) => Promise<TaskLogs>;
  logRevisionFor: (requestId: string) => number;
}

const statusLabels: Record<LocalTask["status"], string> = {
  pending: "等待领取",
  claimed: "已领取",
  awaiting_trust: "等待信任确认",
  preparing: "准备环境",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  expired: "已过期",
  interrupted: "已中断",
};

const terminalStatuses = new Set<LocalTask["status"]>([
  "succeeded", "failed", "cancelled", "expired", "interrupted",
]);

type TaskFilter = "all" | "pending" | "recent";

export function TasksView({
  tasks,
  onTrustAndRun,
  onReject,
  onCancel,
  onPin,
  onReadLogs,
  logRevisionFor,
}: TasksViewProps) {
  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => right.updatedAt - left.updatedAt),
    [tasks],
  );
  const [selectedId, setSelectedId] = useState(sortedTasks[0]?.id);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [pending, setPending] = useState<string>();
  const [logs, setLogs] = useState<TaskLogs>();

  useEffect(() => {
    if (!tasks.some(({ id }) => id === selectedId)) setSelectedId(sortedTasks[0]?.id);
  }, [selectedId, sortedTasks, tasks]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLogs(undefined);
    const timeout = window.setTimeout(() => {
      void onReadLogs(selectedId)
        .then((loaded) => {
          if (active) setLogs(loaded);
        })
        .catch(() => {
          if (active) setLogs(undefined);
        });
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [logRevisionFor(selectedId ?? ""), onReadLogs, selectedId, tasks.find(({ id }) => id === selectedId)?.updatedAt]);

  if (tasks.length === 0) {
    return (
      <div className="view-stack tasks-view is-empty">
        <div className="page-heading"><h1>本地任务</h1></div>
        <section className="empty-state" aria-label="本地任务为空">
          <CheckCircle2 aria-hidden="true" size={26} strokeWidth={1.6} />
          <h2>尚未运行任何本地任务</h2>
          <p>可信应用发起本地操作后，运行记录会保留在这里。</p>
        </section>
      </div>
    );
  }

  const selected = tasks.find(({ id }) => id === selectedId) ?? sortedTasks[0];
  const visibleTasks = sortedTasks.filter((task) => {
    if (filter === "pending") return !terminalStatuses.has(task.status);
    if (filter === "recent") return terminalStatuses.has(task.status);
    return true;
  });
  const waitingCount = tasks.filter((task) => !terminalStatuses.has(task.status)).length;
  const recentCount = tasks.length - waitingCount;

  async function run(key: string, operation: () => Promise<void>) {
    if (pending) return;
    setPending(key);
    try {
      await operation();
    } finally {
      setPending(undefined);
    }
  }

  return (
    <div className="tasks-view">
      <aside className="task-index" aria-label="任务历史">
        <header className="task-index-header">
          <h1>本地任务</h1>
          <button className="icon-button" title="刷新任务列表" type="button">
            <RefreshCw aria-hidden="true" size={16} />
            <span className="sr-only">刷新任务列表</span>
          </button>
        </header>
        <div className="task-filter" aria-label="任务筛选" role="group">
          <FilterButton active={filter === "all"} count={tasks.length} label="全部" onClick={() => setFilter("all")} />
          <FilterButton active={filter === "pending"} count={waitingCount} label="待确认" onClick={() => setFilter("pending")} />
          <FilterButton active={filter === "recent"} count={recentCount} label="最近" onClick={() => setFilter("recent")} />
        </div>
        <div className="task-index-list" role="list">
          {visibleTasks.map((task, index) => {
            const previous = visibleTasks[index - 1];
            const currentGroup = terminalStatuses.has(task.status) ? "最近运行" : "等待确认";
            const previousGroup = previous && (terminalStatuses.has(previous.status) ? "最近运行" : "等待确认");
            return (
              <div key={task.id} role="listitem">
                {currentGroup !== previousGroup ? <div className="task-group-label">{currentGroup}</div> : null}
                <button
                  aria-current={task.id === selected.id ? "true" : undefined}
                  aria-label={task.title}
                  className={`task-index-row${task.id === selected.id ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(task.id)}
                  type="button"
                >
                  <span className={`task-status-dot is-${task.status}`} aria-hidden="true" />
                  <span className="task-index-copy">
                    <strong>{task.title}</strong>
                    <span>{task.appOwner}/{task.appName}</span>
                    <small>{task.publisherDisplayName || task.publisherUserId} · {formatTaskTime(task.updatedAt)}</small>
                  </span>
                  <span className={`task-state is-${task.status}`}>{statusLabels[task.status]}</span>
                </button>
              </div>
            );
          })}
        </div>
      </aside>
      <TaskDetail
        pending={pending}
        logs={logs}
        task={selected}
        onCancel={() => run("cancel", () => onCancel(selected.id))}
        onPin={() => run("pin", () => onPin(selected.id, !selected.pinned))}
        onReject={() => run("reject", () => onReject(selected.id))}
        onTrustAndRun={() => run("trust", () => onTrustAndRun(selected.id))}
      />
    </div>
  );
}

function FilterButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return (
    <button className={active ? "is-active" : ""} onClick={onClick} type="button">
      {label}<span>{count}</span>
    </button>
  );
}

function TaskDetail({
  task,
  pending,
  logs,
  onTrustAndRun,
  onReject,
  onCancel,
  onPin,
}: {
  task: LocalTask;
  pending?: string;
  logs?: TaskLogs;
  onTrustAndRun: () => Promise<void>;
  onReject: () => Promise<void>;
  onCancel: () => Promise<void>;
  onPin: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const dependencies = Object.entries(task.dependencies);
  const active = task.status === "preparing" || task.status === "running";
  const terminal = terminalStatuses.has(task.status);
  const source = `${task.serverOrigin.replace(/\/$/, "")}/${task.appOwner}/${task.appName}`;

  async function confirmRun() {
    setConfirming(false);
    await onTrustAndRun();
  }

  return (
    <article className="task-detail">
      <div className="task-detail-scroll">
        <header className="action-header">
          <div className="review-status-row">
            <span className={`task-state is-${task.status}`}>{statusLabels[task.status]}</span>
          </div>
          <h2>{task.title}</h2>
          {task.description ? <p className="task-description">{task.description}</p> : null}
        </header>

        <dl className="action-metadata">
          <Metadata icon={<Boxes />} label="应用" value={`${task.appOwner}/${task.appName}`} />
          <Metadata icon={<UserRound />} label="发布者" value={task.publisherDisplayName || task.publisherUserId} />
          <Metadata icon={<Globe2 />} label="来源" value={source} copyValue={source} />
          <Metadata icon={<Clock3 />} label="超时" value={`${task.timeoutSeconds} 秒`} />
          <Metadata icon={<FolderOpen />} label="工作目录" value={task.workingDirectory} copyValue={task.workingDirectory} />
          <Metadata icon={<Hash />} label="任务 ID" value={task.id} copyValue={task.id} />
        </dl>

        {task.status === "awaiting_trust" ? (
          <div className="permission-warning">
            <ShieldAlert aria-hidden="true" size={20} />
            <p><strong>此操作获准后将拥有当前用户的完整权限。</strong> 可访问该用户能够访问的文件、网络和程序。请仅信任来源可靠、操作明确的任务。</p>
          </div>
        ) : null}

        <section className="code-section" aria-labelledby="script-heading">
          <div className="section-title-row">
            <h3 id="script-heading">脚本</h3>
            <CopyButton label="复制脚本" value={task.script} />
          </div>
          <div className="code-block">
            <div className="code-block-header"><span>JavaScript</span><span>只读</span></div>
            <pre>{task.script}</pre>
          </div>
        </section>

        <CollapsibleSection icon={<Package />} title={`依赖 (${dependencies.length})`}>
          <p>{dependencies.length ? dependencies.map(([name, version]) => `${name}@${version}`).join("、") : "无"}</p>
        </CollapsibleSection>
        <CollapsibleSection icon={<FileJson />} title="输入">
          <pre>{JSON.stringify(task.input, null, 2)}</pre>
        </CollapsibleSection>
        {task.result != null ? <ReviewSection icon={<CheckCircle2 />} title="结果"><pre>{JSON.stringify(task.result, null, 2)}</pre></ReviewSection> : null}
        {task.errorSummary ? <ReviewSection icon={<AlertTriangle />} title="错误"><pre>{task.errorSummary}</pre></ReviewSection> : null}
        {logs?.stdout ? <ReviewSection icon={<TerminalSquare />} title={logs.stdoutTruncated ? "标准输出（仅显示末尾）" : "标准输出"}><pre>{logs.stdout}</pre></ReviewSection> : null}
        {logs?.stderr ? <ReviewSection icon={<TerminalSquare />} title={logs.stderrTruncated ? "错误输出（仅显示末尾）" : "错误输出"}><pre>{logs.stderr}</pre></ReviewSection> : null}
      </div>

      <div className="task-actions">
        {task.status === "awaiting_trust" ? (
          <>
            <button
              aria-label={`拒绝 ${task.title}`}
              className="danger-button"
              disabled={Boolean(pending)}
              onClick={() => void onReject()}
              type="button"
            >
              <X aria-hidden="true" size={16} />拒绝
            </button>
            <button className="primary-button" disabled={Boolean(pending)} onClick={() => setConfirming(true)} type="button">
              <Play aria-hidden="true" size={16} />信任并运行
            </button>
          </>
        ) : null}
        {active ? (
          <button className="secondary-button" disabled={Boolean(pending)} onClick={() => void onCancel()} type="button">
            <CircleStop aria-hidden="true" size={16} />取消任务
          </button>
        ) : null}
        {terminal ? (
          <button className="secondary-button" disabled={Boolean(pending)} onClick={() => void onPin()} type="button">
            {task.pinned ? <PinOff aria-hidden="true" size={16} /> : <Pin aria-hidden="true" size={16} />}
            {task.pinned ? "取消固定" : "固定记录"}
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="modal-overlay" onMouseDown={() => setConfirming(false)}>
          <section aria-labelledby="confirm-title" aria-modal="true" className="confirmation-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <header>
              <AlertTriangle aria-hidden="true" size={24} />
              <div>
                <h2 id="confirm-title">确认执行</h2>
                <p>脚本将使用当前用户的完整权限运行，包括读取和写入文件、访问网络及运行程序。</p>
              </div>
            </header>
            <dl>
              <div><dt>应用</dt><dd>{task.appOwner}/{task.appName}</dd></div>
              <div><dt>发布者</dt><dd>{task.publisherDisplayName || task.publisherUserId}</dd></div>
            </dl>
            <footer>
              <button className="secondary-button" onClick={() => setConfirming(false)} type="button">取消</button>
              <button className="primary-button" onClick={() => void confirmRun()} type="button">确认信任并运行</button>
            </footer>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function Metadata({ icon, label, value, copyValue }: { icon: React.ReactNode; label: string; value: string; copyValue?: string }) {
  return (
    <div>
      <dt>{icon}<span>{label}</span></dt>
      <dd>{value}{copyValue ? <CopyButton label={`复制${label}`} value={copyValue} /> : null}</dd>
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  return (
    <button
      aria-label={label}
      className="icon-button compact"
      onClick={() => void navigator.clipboard?.writeText(value)}
      title={label}
      type="button"
    >
      <Copy aria-hidden="true" size={14} />
    </button>
  );
}

function ReviewSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="action-detail">
      <h3>{icon}<span>{title}</span><ChevronRight aria-hidden="true" className="detail-chevron" size={16} /></h3>
      <div>{children}</div>
    </section>
  );
}

function CollapsibleSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="action-detail is-collapsible">
      <button aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} type="button">
        {icon}<span>{title}</span><ChevronRight aria-hidden="true" className="detail-chevron" size={16} />
      </button>
      {expanded ? <div>{children}</div> : null}
    </section>
  );
}

function formatTaskTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}
