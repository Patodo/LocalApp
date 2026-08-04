import { detectBasePath } from "./client.js";

export interface CollaborationCommittedEvent {
  type: "collab:operation_committed";
  data: {
    appOwner: string;
    appName: string;
    resource: string;
    recordId: string;
    revision: number;
    actorId: string | null;
    operationId: string;
    patch?: Record<string, unknown>;
  };
}

export interface SubscribeCollaborationEventsOptions {
  resource?: string;
}

export function subscribeCollaborationEvents(
  options: SubscribeCollaborationEventsOptions,
  onEvent: (event: CollaborationCommittedEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {};

  const params = new URLSearchParams();
  if (options.resource) params.set("resource", options.resource);
  const query = params.toString();
  const source = new EventSource(`${detectBasePath()}/collaboration/events${query ? `?${query}` : ""}`);

  const listener = (event: MessageEvent) => {
    const parsed = JSON.parse(event.data) as CollaborationCommittedEvent;
    onEvent(parsed);
  };
  source.addEventListener("collab:operation_committed", listener);

  return () => {
    source.removeEventListener("collab:operation_committed", listener);
    source.close();
  };
}

export interface DraftState<TDraft extends Record<string, unknown>, TSnapshot extends Record<string, unknown>> {
  localDraft: TDraft | null;
  serverSnapshot: TSnapshot | null;
  hasRemoteUpdate?: boolean;
}

export function applyCommittedEventToDraftState<
  TDraft extends Record<string, unknown>,
  TSnapshot extends Record<string, unknown>,
>(
  state: DraftState<TDraft, TSnapshot>,
  event: CollaborationCommittedEvent,
): DraftState<TDraft, TSnapshot> {
  const patch = event.data.patch ?? {};
  return {
    ...state,
    localDraft: state.localDraft,
    serverSnapshot: state.serverSnapshot
      ? ({ ...state.serverSnapshot, ...patch } as TSnapshot)
      : ({ ...patch } as TSnapshot),
    hasRemoteUpdate: Boolean(state.localDraft),
  };
}
