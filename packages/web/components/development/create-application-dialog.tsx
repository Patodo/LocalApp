"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Sparkles, Square, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { DshMessages, DshMarkdown } from "./dsh-view";
interface Creation {
  projectId: string;
  sessionId: string;
  providerId: string;
  proposal?: { name: string; description: string };
  url?: string;
}
async function request(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    credentials: "include",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error || "请求失败");
  return json.data;
}
export function CreateApplicationDialog({
  open,
  onOpenChange,
  onCreated = (url) => window.location.assign(url),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (url: string) => void;
}) {
  const [providers, setProviders] = useState<
      { id: string; name: string; model: string }[]
    >([]),
    [provider, setProvider] = useState(""),
    [creation, setCreation] = useState<Creation | null>(null),
    [prompt, setPrompt] = useState(""),
    [messages, setMessages] = useState<any[]>([]),
    [live, setLive] = useState(""),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [error, setError] = useState("");
  const [interaction, setInteraction] = useState<any>(null),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const returnFocus = useRef<HTMLElement | null>(null);
  const controller = useRef<AbortController | null>(null),
    transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open)
      void request("/api/agent/settings")
        .then((settings) => {
          setProviders(settings.providers);
          setProvider(
            (current) =>
              current ||
              settings.defaultProviderId ||
              settings.providers[0]?.id ||
              "",
          );
        })
        .catch((error) => setError(error.message));
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages, live]);
  async function send() {
    if (busy || confirming || !prompt.trim() || !provider) return;
    setBusy(true);
    setError("");
    setLive("");
    setInteraction(null);
    setAnswers({});
    const text = prompt.trim();
    setPrompt("");
    const abort = new AbortController();
    controller.current = abort;
    let draft = creation;
    try {
      if (!draft) {
        draft = await request("/api/development/creations", {
          providerId: provider,
        });
        setCreation(draft);
      }
      setCreation((current) =>
        current ? { ...current, proposal: undefined } : current,
      );
      const response = await fetch(
        `/api/development/projects/${draft!.projectId}/agent/run`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            providerId: draft!.providerId,
            sessionId: draft!.sessionId,
          }),
          signal: abort.signal,
        },
      );
      if (!response.ok)
        throw new Error((await response.json()).error || "对话失败");
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === "messages") setMessages(event.messages);
            if (event.type === "text_delta")
              setLive((s) => s + (event.delta ?? event.text ?? ""));
            if (event.type === "interaction") setInteraction(event);
            if (event.type === "error") setError(event.message);
            if (event.type === "creation") setCreation(event.creation);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setError((error as Error).message);
    } finally {
      setInteraction(null);
      setBusy(false);
      setLive("");
      if (draft) {
        try {
          setCreation(
            await request(`/api/development/creations/${draft.projectId}`),
          );
          setMessages(
            await request(
              `/api/development/projects/${draft.projectId}/agent/history?sessionId=${encodeURIComponent(draft.sessionId)}`,
            ),
          );
        } catch {
          /* Keep visible messages on a transient read failure. */
        }
      }
    }
  }
  async function confirm() {
    if (!creation?.proposal || busy || confirming) return;
    setConfirming(true);
    setError("");
    try {
      const result = await request(
        `/api/development/creations/${creation.projectId}/confirm`,
        { name: creation.proposal.name },
      );
      onCreated(result.url);
    } catch (error) {
      setError((error as Error).message);
      setConfirming(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!confirming) {
          if (!value) controller.current?.abort();
          onOpenChange(value);
        }
      }}
    >
      <DialogContent
        onOpenAutoFocus={() => {returnFocus.current = document.activeElement as HTMLElement;}}
        onCloseAutoFocus={event => {event.preventDefault(); returnFocus.current?.focus();}}
        className="dsh-development flex h-[min(720px,85dvh)] flex-col p-0"
        onEscapeKeyDown={(event) => {
          if (confirming) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (confirming) event.preventDefault();
        }}
      >
        <div className="px-7 pt-6">
          <DialogTitle className="text-sm font-medium text-muted-foreground">
            创建应用
          </DialogTitle>
          <DialogDescription className="sr-only">
            先与 Agent 讨论需求，确认名称后进入应用继续开发。
          </DialogDescription>
        </div>
        <div
          ref={transcript}
          className="min-h-0 flex-1 overflow-y-auto px-7 py-5"
        >
          {!messages.length && !busy ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-5">
              <Sparkles className="size-10 text-muted-foreground/40" />
              <h2 className="text-3xl font-medium tracking-tight">
                我们要构建什么？
              </h2>
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                说说你的想法，先聊清需求，再一起确定应用名称。
              </p>
            </div>
          ) : (
            <>
              <DshMessages messages={messages} />
              {live && <DshMarkdown text={live} />}
            </>
          )}
        </div>
        {creation?.proposal && !busy && (
          <div className="mx-7 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
            <div className="min-w-0">
              <p className="font-medium">{creation.proposal.name}</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                {creation.proposal.description}
              </p>
            </div>
            <Button disabled={confirming || busy} onClick={confirm}>
              {confirming ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Check />
              )}
              {confirming ? "正在创建…" : "确认名称并创建"}
            </Button>
          </div>
        )}
        {interaction && (
          <div className="mx-7 mb-3 space-y-3 rounded-xl border p-4">
            {interaction.kind === "approval" ? (
              <>
                <p>
                  {interaction.toolName}：{interaction.reason}
                </p>
                <Button
                  onClick={() =>
                    void request(
                      `/api/development/projects/${creation!.projectId}/agent/respond`,
                      { token: interaction.token, result: "rejected" },
                    )
                      .then(() => setInteraction(null))
                      .catch((e) => setError(e.message))
                  }
                >
                  拒绝
                </Button>
              </>
            ) : (
              <>
                {interaction.questions?.map((q: any) => (
                  <label key={q.id} className="block space-y-2">
                    <span>{q.question}</span>
                    <Input
                      value={answers[q.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((previous) => ({
                          ...previous,
                          [q.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
                <Button
                  onClick={() =>
                    void request(
                      `/api/development/projects/${creation!.projectId}/agent/respond`,
                      { token: interaction.token, result: answers },
                    )
                      .then(() => setInteraction(null))
                      .catch((e) => setError(e.message))
                  }
                >
                  回答 Agent
                </Button>
              </>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="px-7 pb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {!providers.length && (
          <a className="px-7 pb-3 text-sm underline" href="/my/models">
            先配置模型供应商
          </a>
        )}
        <form
          className="m-5 mt-0 rounded-2xl border bg-background p-3 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            aria-label="创建应用需求"
            placeholder="描述你想创建的应用…"
            className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            value={prompt}
            disabled={busy || confirming}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <ChoiceSelect
              label="创建应用模型"
              value={provider}
              disabled={busy || confirming || !!creation}
              onValueChange={setProvider}
              options={providers.map((p) => ({
                value: p.id,
                label: `${p.name} · ${p.model}`,
              }))}
              className="max-w-64 border-0 shadow-none"
            />
            {busy ? (
              <Button
                type="button"
                size="icon"
                className="rounded-full"
                aria-label="停止需求讨论"
                onClick={() => controller.current?.abort()}
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="rounded-full"
                aria-label="发送创建需求"
                disabled={!prompt.trim() || !provider || confirming}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
