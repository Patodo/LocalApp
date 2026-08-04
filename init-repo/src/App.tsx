import { useEffect, useMemo, useState } from "react";
import {
  Can,
  useMe,
  useMutation,
  useTransitions,
  useQuery,
  type BusinessMetadata,
} from "@localapp/sdk-react";
import { useRegisterTools } from "@localapp/sdk-agent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WorkItem {
  id: number;
  title: string;
  status: "todo" | "doing" | "done";
  created_by?: string | null;
}

interface WorkItemsResult {
  rows: WorkItem[];
}

interface DashboardResult {
  rows: Array<{ status: WorkItem["status"]; count: number }>;
}

const WORK_ITEM_BUSINESS: BusinessMetadata = {
  statusField: "status",
  recordAccess: {
    create: { mode: "authenticated" },
    update: { mode: "ownerField", field: "created_by" },
    delete: { mode: "ownerField", field: "created_by" },
  },
  transitions: [
    { name: "start", label: "开始", from: ["todo"], to: "doing" },
    { name: "complete", label: "完成", from: ["doing"], to: "done" },
  ],
};

const WORK_ITEM_SCHEMA = {
  business: {
    ...WORK_ITEM_BUSINESS,
  },
};

function WorkItemRow({
  item,
  onDone,
}: {
  item: WorkItem;
  onDone: () => Promise<void>;
}) {
  const done = item.status === "done";
  const { transitions, transition, loading: transitioning } = useTransitions("work_items", item, WORK_ITEM_BUSINESS, {
    onSuccess: () => {
      void onDone();
    },
  });

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="font-medium">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          ID: {item.id}
          {item.created_by ? ` · 创建者: ${item.created_by}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={done ? "default" : "outline"}>
          {done ? "已完成" : item.status === "doing" ? "进行中" : "待处理"}
        </Badge>
        {transitions.map((itemTransition) => (
          <Button
            key={itemTransition.name}
            variant="outline"
            size="sm"
            disabled={transitioning}
            onClick={() => void transition(itemTransition.name)}
          >
            {itemTransition.label ?? itemTransition.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const { me, loading: loadingMe } = useMe();
  const listQuery = useQuery<WorkItemsResult>();
  const dashboardQuery = useQuery<DashboardResult>();
  const { mutate, loading: mutating, error: mutationError } = useMutation();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [dashboard, setDashboard] = useState<DashboardResult["rows"]>([]);
  const [title, setTitle] = useState("");

  async function refresh() {
    const [list, stats] = await Promise.all([
      listQuery.query("work_items.mine", { limit: 50, offset: 0 }),
      dashboardQuery.query("work_items.dashboard"),
    ]);
    setItems(list.rows);
    setDashboard(stats.rows);
  }

  async function createWorkItem(nextTitle = title) {
    const trimmed = nextTitle.trim();
    if (!trimmed) return "请输入工作项标题";

    await mutate("$work_items.create", {
      title: trimmed,
      status: "todo",
    });
    setTitle("");
    await refresh();
    return `已创建工作项: ${trimmed}`;
  }

  async function completeWorkItem(id: number) {
    await mutate("$work_items.complete", { id });
    await refresh();
    return `已完成工作项 #${id}`;
  }

  useEffect(() => {
    void refresh();
  }, []);

  useRegisterTools({
    tools: {
      createWorkItem: {
        description: "创建一个工作项",
        parameters: {
          title: { type: "string", required: true, description: "工作项标题" },
        },
        execute: async (args) => createWorkItem(String(args.title ?? "")),
      },
      completeWorkItem: {
        description: "完成一个工作项",
        parameters: {
          id: { type: "number", required: true, description: "工作项 ID" },
        },
        execute: async (args) => completeWorkItem(Number(args.id)),
      },
    },
    systemHint: "这是一个工作项示例应用。创建和完成都使用 named SQL mutation。",
  });

  const counts = useMemo(() => {
    const map = new Map(dashboard.map((row) => [row.status, Number(row.count)]));
    return {
      todo: map.get("todo") ?? 0,
      doing: map.get("doing") ?? 0,
      done: map.get("done") ?? 0,
    };
  }, [dashboard]);

  const querying = listQuery.loading || dashboardQuery.loading;
  const error = listQuery.error ?? dashboardQuery.error ?? mutationError;

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">LocalApp App</p>
            <h1 className="text-3xl font-semibold tracking-tight">工作项</h1>
          </div>
          <Badge variant="secondary">
            {loadingMe ? "正在识别用户" : me ? `你好，${me.name}` : "未登录访客"}
          </Badge>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>待处理</CardDescription>
              <CardTitle className="text-3xl">{counts.todo}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>进行中</CardDescription>
              <CardTitle className="text-3xl">{counts.doing}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>已完成</CardDescription>
              <CardTitle className="text-3xl">{counts.done}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>新建工作项</CardTitle>
              <CardDescription>当前用户会作为创建者写入。</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await createWorkItem();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="work-title">标题</Label>
                  <Input
                    id="work-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="例如：整理审批规则"
                    required
                  />
                </div>
                <Can action="create" schema={WORK_ITEM_SCHEMA}>
                  <Button type="submit" disabled={mutating || !title.trim()} className="w-full">
                    {mutating ? "创建中..." : "创建"}
                  </Button>
                </Can>
              </form>
              {error ? (
                <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>我的工作项</CardTitle>
                <CardDescription>只显示当前用户创建的记录。</CardDescription>
              </div>
              <Button variant="outline" onClick={() => refresh()} disabled={querying}>
                刷新
              </Button>
            </CardHeader>
            <CardContent>
              {querying && items.length === 0 ? (
                <p className="text-sm text-muted-foreground">正在加载...</p>
              ) : items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  暂无工作项。
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <WorkItemRow
                      key={item.id}
                      item={item}
                      onDone={refresh}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
