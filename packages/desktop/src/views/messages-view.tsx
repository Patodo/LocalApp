import { AppWindow, CheckCheck, ExternalLink, Inbox, LayoutGrid, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDesktopGateway } from "../lib/desktop-gateway";
import type { InboxItem } from "../lib/types";

type FilterMode = "all" | "unread";
type ListRequest = { cursor?: string; append?: boolean; unreadOnly: boolean };

export function MessagesView() {
  const gateway = getDesktopGateway();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [appFilter, setAppFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string>();
  const [failedRequest, setFailedRequest] = useState<ListRequest>();
  const requestGeneration = useRef(0);
  const mutationInFlight = useRef(false);
  const filterModeRef = useRef<FilterMode>("all");

  const appSources = useMemo(() => {
    const sources = new Map<string, { key: string; owner: string; name: string; total: number; unread: number }>();
    for (const item of items) {
      const key = `${item.appOwner}/${item.appName}`;
      const source = sources.get(key) ?? {
        key,
        owner: item.appOwner,
        name: item.appName,
        total: 0,
        unread: 0,
      };
      source.total += 1;
      if (!item.read) source.unread += 1;
      sources.set(key, source);
    }
    return [...sources.values()];
  }, [items]);
  const selectedSource = appSources.find((source) => source.key === appFilter);
  const unreadCount = items.filter((item) => !item.read).length;
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (filterMode === "all" || !item.read) &&
          (appFilter === "all" || `${item.appOwner}/${item.appName}` === appFilter),
      ),
    [appFilter, filterMode, items],
  );

  const load = useCallback(async ({ cursor, append = false, unreadOnly }: ListRequest) => {
    const generation = ++requestGeneration.current;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(undefined);
    setFailedRequest(undefined);

    try {
      const page = await gateway.listInbox(cursor ? { cursor, unreadOnly } : { unreadOnly });
      if (generation !== requestGeneration.current) return;
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch {
      if (generation !== requestGeneration.current) return;
      setError("无法加载消息，请检查连接后重试。");
      setFailedRequest({ cursor, append, unreadOnly });
    } finally {
      if (generation !== requestGeneration.current) return;
      if (append) setIsLoadingMore(false);
      else setIsLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let registrationComplete = false;
    let registrationEventPending = false;

    void (async () => {
      try {
        const registered = await gateway.listen((event) => {
          if (
            disposed ||
            (event.type !== "notification:received" && event.type !== "inbox:missed")
          ) {
            return;
          }
          if (!registrationComplete) {
            registrationEventPending = true;
            return;
          }
          void load({ unreadOnly: filterModeRef.current === "unread" });
        });
        if (disposed) {
          registered();
          return;
        }
        unlisten = registered;
        registrationComplete = true;
        await load({ unreadOnly: false });
        if (registrationEventPending && !disposed) {
          await load({ unreadOnly: filterModeRef.current === "unread" });
        }
      } catch {
        if (
          !disposed &&
          !registrationComplete
        ) {
          await load({ unreadOnly: false });
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [gateway, load]);

  function invalidateListResponses() {
    requestGeneration.current += 1;
    setIsLoading(false);
    setIsLoadingMore(false);
    setFailedRequest(undefined);
  }

  async function runMutation<T>(
    operation: () => Promise<T>,
    onSuccess: (result: T) => void,
    failureMessage: string,
  ): Promise<boolean> {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setIsMutating(true);
    setError(undefined);
    setFailedRequest(undefined);

    try {
      const result = await operation();
      invalidateListResponses();
      onSuccess(result);
      return true;
    } catch {
      setError(failureMessage);
      return false;
    } finally {
      mutationInFlight.current = false;
      setIsMutating(false);
    }
  }

  function changeFilterMode(nextMode: FilterMode) {
    if (nextMode === filterMode) return;
    filterModeRef.current = nextMode;
    setFilterMode(nextMode);
    setItems([]);
    setNextCursor(undefined);
    void load({ unreadOnly: nextMode === "unread" });
  }

  async function markAllRead() {
    await runMutation(
      () => gateway.markAllRead(),
      () => {
        if (filterMode === "unread") {
          setItems([]);
          setNextCursor(undefined);
          return;
        }
        setItems((current) => current.map((item) => ({ ...item, read: true })));
      },
      "无法标记全部已读，请重试。",
    );
  }

  async function openMessage(item: InboxItem) {
    if (!item.url) return;
    await runMutation(
      () => gateway.openNotification(item.id, item.url!),
      (updated) => {
        if (!updated) return;
        if (filterMode === "unread") {
          setItems((current) => current.filter((entry) => entry.id !== item.id));
          return;
        }
        setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      },
      "无法打开消息链接，请重试。",
    );
  }

  async function deleteMessage(item: InboxItem) {
    await runMutation(
      () => gateway.deleteNotification(item.id),
      () => setItems((current) => current.filter((entry) => entry.id !== item.id)),
      "无法删除消息，请重试。",
    );
  }

  return (
    <div className="messages-view">
      <aside aria-label="应用消息源" className="message-sources">
        <header className="message-sources-header">
          <h1>消息</h1>
          <span>{items.length} 条消息</span>
        </header>
        <nav aria-label="按应用筛选消息" className="message-source-list">
          <button
            aria-current={appFilter === "all" ? "page" : undefined}
            aria-label={`全部应用，${items.length} 条消息，${unreadCount} 条未读`}
            className={`message-source${appFilter === "all" ? " is-selected" : ""}`}
            onClick={() => setAppFilter("all")}
            type="button"
          >
            <span className="message-source-icon"><LayoutGrid aria-hidden="true" size={17} /></span>
            <span className="message-source-copy">
              <strong>全部应用</strong>
              <small>{items.length} 条消息</small>
            </span>
            {unreadCount > 0 ? <span className="source-unread-count">{unreadCount}</span> : null}
          </button>
          {appSources.map((source) => (
            <button
              aria-current={appFilter === source.key ? "page" : undefined}
              aria-label={`${source.key}，${source.unread > 0 ? `${source.unread} 条未读` : "无未读消息"}`}
              className={`message-source${appFilter === source.key ? " is-selected" : ""}`}
              key={source.key}
              onClick={() => setAppFilter(source.key)}
              type="button"
            >
              <span className="message-source-icon"><AppWindow aria-hidden="true" size={17} /></span>
              <span className="message-source-copy">
                <strong>{source.name}</strong>
                <small>{source.owner}/{source.name}</small>
              </span>
              {source.unread > 0 ? <span className="source-unread-count">{source.unread}</span> : null}
            </button>
          ))}
        </nav>
      </aside>

      <section className="messages-main">
        <div className="messages-heading">
          <h1>{selectedSource?.name ?? "全部消息"}</h1>
          <div className="messages-actions">
            <div aria-label="消息状态" className="segmented-control" role="group">
              <button
                aria-pressed={filterMode === "all"}
                className={filterMode === "all" ? "is-selected" : ""}
                disabled={isLoading || isLoadingMore || isMutating}
                onClick={() => changeFilterMode("all")}
                type="button"
              >
                全部
              </button>
              <button
                aria-pressed={filterMode === "unread"}
                className={filterMode === "unread" ? "is-selected" : ""}
                disabled={isLoading || isLoadingMore || isMutating}
                onClick={() => changeFilterMode("unread")}
                type="button"
              >
                未读
              </button>
            </div>
            <button
              aria-label="刷新通知"
              className="icon-button"
              disabled={isLoading || isLoadingMore || isMutating}
              onClick={() => void load({ unreadOnly: filterMode === "unread" })}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={18} />
            </button>
            <button
              aria-label="标记全部已读"
              className="secondary-button"
              disabled={!items.some((item) => !item.read) || isMutating}
              onClick={() => void markAllRead()}
              type="button"
            >
              <CheckCheck aria-hidden="true" size={18} />
              <span>标记全部已读</span>
            </button>
          </div>
        </div>

        {error ? (
        <div className="message-error" role="alert">
          <span>{error}</span>
          {failedRequest ? (
            <button className="text-button" onClick={() => void load(failedRequest)} type="button">
              重试
            </button>
          ) : null}
        </div>
        ) : null}

        {isLoading && items.length === 0 ? <MessagesLoading /> : null}
        {!isLoading && items.length === 0 && !error ? <MessagesEmpty /> : null}
        {items.length > 0 && visibleItems.length === 0 ? (
        <section className="empty-state" aria-label="筛选结果为空">
          <Inbox aria-hidden="true" size={26} strokeWidth={1.6} />
          <h2>没有符合当前筛选的消息</h2>
          <p>切换筛选条件以查看其他消息。</p>
        </section>
        ) : null}
        {visibleItems.length > 0 ? (
        <section aria-label="消息列表" className="message-list">
          {visibleItems.map((item) => (
            <article className={`message-row${item.read ? "" : " is-unread"}`} key={item.id}>
              <div className="message-content">
                <div className="message-title-row">
                  <h2>{item.title}</h2>
                  {!item.read ? <span aria-label="未读" className="unread-indicator" /> : null}
                </div>
                {item.body ? <p>{item.body}</p> : null}
                <div className="message-meta">
                  <span>{item.appOwner}/{item.appName}</span>
                  <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
                </div>
              </div>
              <div className="message-row-actions">
                {item.url ? (
                  <button
                    aria-label={`打开 ${item.title}`}
                    className="icon-button"
                    disabled={isMutating}
                    onClick={() => void openMessage(item)}
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" size={18} />
                  </button>
                ) : null}
                <button
                  aria-label={`删除 ${item.title}`}
                  className="icon-button"
                  disabled={isMutating}
                  onClick={() => void deleteMessage(item)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={18} />
                </button>
              </div>
            </article>
          ))}
        </section>
        ) : null}

        {nextCursor ? (
        <button
          className="load-more-button"
          disabled={isLoading || isLoadingMore || isMutating}
          onClick={() => void load({ cursor: nextCursor, append: true, unreadOnly: filterMode === "unread" })}
          type="button"
        >
          {isLoadingMore ? "正在加载..." : "加载更多"}
        </button>
        ) : null}
      </section>
    </div>
  );
}

function MessagesLoading() {
  return (
    <section aria-label="正在加载消息" className="message-list message-list-loading">
      {[0, 1, 2].map((item) => <div className="message-skeleton" key={item} />)}
    </section>
  );
}

function MessagesEmpty() {
  return (
    <section className="empty-state" aria-label="消息为空">
      <Inbox aria-hidden="true" size={26} strokeWidth={1.6} />
      <h2>暂时没有消息</h2>
      <p>应用通知和重要动态会在这里显示。</p>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
