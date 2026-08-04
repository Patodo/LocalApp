"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { Bold, CircleCheck, Code, FileText, Heading2, Italic, Link, List, ListOrdered, ListTodo, LoaderCircle, Quote, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IssueDiscardDraftControl } from "./issue-discard-draft-control";
import { Textarea } from "@/components/ui/textarea";
import { IssueMarkdown } from "./issue-markdown";
import { applyMarkdownCommand, type MarkdownCommand } from "./issue-markdown-command";
import { formatFileSize, isSafeImage, type ComposerSubmit, type IssueAttachment, type IssueStateReason, type IssueStatus, type IssueUserIdentity, type PendingAttachment } from "./issue-types";
import { uploadIssueAttachment } from "./issue-api";
import { applyIssueMention, findIssueMentionQuery } from "./issue-mention";
import { insertIssueSavedReply } from "./issue-saved-reply";
import { IssueSavedRepliesPicker, type IssueSavedReply } from "./issue-saved-replies-picker";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_DRAFT_ATTACHMENTS = 20;
const VISIBLE_UPLOADED_ATTACHMENTS = 4;
const MARKDOWN_PUNCTUATION = new Set(Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"));

interface IssueComposerProps {
  pagePath: string;
  draftId: string;
  initialBody?: string;
  textareaLabel: string;
  placeholder?: string;
  submitLabel: string;
  status?: IssueStatus;
  closeReason?: IssueStateReason;
  attachments?: boolean;
  persistenceKey?: string;
  preferPersistedDraft?: boolean;
  showRestoredDraftNotice?: boolean;
  restoredDraft?: boolean;
  autoFocus?: boolean;
  allowEmpty?: boolean;
  submitDisabled?: boolean;
  insertRequest?: { id: number; text: string } | null;
  removeTextRequest?: { id: string; url: string } | null;
  mentionCandidates?: readonly IssueUserIdentity[];
  savedReplies?: boolean;
  onInsertRequestApplied?: (id: number) => void;
  onDiscardRestoredDraft?: () => void;
  onBodyChange?: (body: string) => void;
  onCancel?: () => void;
  onSubmit: (input: ComposerSubmit) => Promise<void>;
}

export function issueAttachmentMarkdown(attachment?: IssueAttachment): string {
  if (!attachment) return "";
  const displayName = Array.from(attachment.file_name, (character) => (
    MARKDOWN_PUNCTUATION.has(character) ? `\\${character}` : character
  )).join("");
  return isSafeImage(attachment.mime_type)
    ? `![${displayName}](${attachment.url})`
    : `[${displayName}](${attachment.url})`;
}

function readSessionDraft(key?: string): string {
  if (!key || typeof window === "undefined") return "";
  try { return window.sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

function writeSessionDraft(key: string | undefined, value: string) {
  if (!key || typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Browsers may disable session storage; editing must remain usable.
  }
}

interface PersistedAttachmentDraft { draftId: string; attachments: IssueAttachment[]; }

function attachmentDraftKey(persistenceKey?: string): string | undefined {
  return persistenceKey ? `${persistenceKey}:attachments` : undefined;
}

export function clearIssueAttachmentDraft(persistenceKey?: string) {
  const key = attachmentDraftKey(persistenceKey);
  if (!key || typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(key); } catch { /* Ignore unavailable storage. */ }
}

function releaseIssueAttachment(pagePath: string, attachment: IssueAttachment) {
  const query = new URLSearchParams({ pagePath, draftId: attachment.draft_id });
  void fetch(`/api/issues/attachments/${encodeURIComponent(attachment.id)}?${query}`, {
    method: "DELETE",
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);
}

export function discardIssueAttachmentDraft(pagePath: string, persistenceKey?: string) {
  const persisted = readAttachmentDraft(persistenceKey, pagePath);
  clearIssueAttachmentDraft(persistenceKey);
  persisted?.attachments.forEach((attachment) => releaseIssueAttachment(pagePath, attachment));
}

function isPersistedAttachment(value: unknown, pagePath: string): value is IssueAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<IssueAttachment>;
  const validUrl = typeof attachment.url === "string" && attachment.url.startsWith("/api/issues/attachments/")
    && new URL(attachment.url, window.location.origin).searchParams.get("pagePath") === pagePath;
  return typeof attachment.id === "string" && attachment.id.length > 0 && validUrl
    && attachment.issue_id === null && attachment.comment_id === null
    && typeof attachment.draft_id === "string" && attachment.draft_id.length > 0
    && typeof attachment.uploader_id === "string"
    && typeof attachment.file_name === "string" && attachment.file_name.length > 0
    && typeof attachment.mime_type === "string"
    && typeof attachment.size_bytes === "number" && Number.isFinite(attachment.size_bytes) && attachment.size_bytes > 0 && attachment.size_bytes <= MAX_ATTACHMENT_BYTES
    && typeof attachment.created_at === "string";
}

function readAttachmentDraft(persistenceKey: string | undefined, pagePath: string): PersistedAttachmentDraft | null {
  const key = attachmentDraftKey(persistenceKey);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAttachmentDraft>;
    if (typeof parsed.draftId !== "string" || !parsed.draftId || !Array.isArray(parsed.attachments) || parsed.attachments.length > 20 || parsed.attachments.some((attachment) => !isPersistedAttachment(attachment, pagePath) || attachment.draft_id !== parsed.draftId)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return { draftId: parsed.draftId, attachments: parsed.attachments };
  } catch {
    try { window.sessionStorage.removeItem(key); } catch { /* Ignore unavailable storage. */ }
    return null;
  }
}

function writeAttachmentDraft(persistenceKey: string | undefined, draftId: string, attachments: PendingAttachment[]) {
  const key = attachmentDraftKey(persistenceKey);
  if (!key || typeof window === "undefined") return;
  const uploaded = attachments.flatMap((item) => item.status === "uploaded" && item.attachment ? [item.attachment] : []);
  try {
    if (uploaded.length > 0) window.sessionStorage.setItem(key, JSON.stringify({ draftId, attachments: uploaded } satisfies PersistedAttachmentDraft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Browsers may disable session storage; attachment upload remains usable.
  }
}

function filePreview(file: File): string | null {
  if (!isSafeImage(file.type) || typeof URL === "undefined" || !URL.createObjectURL) return null;
  return URL.createObjectURL(file);
}

export function IssueComposer({
  pagePath,
  draftId,
  initialBody = "",
  textareaLabel,
  placeholder,
  submitLabel,
  status,
  closeReason = "completed",
  attachments: attachmentsEnabled = true,
  persistenceKey,
  preferPersistedDraft = false,
  showRestoredDraftNotice = false,
  restoredDraft: restoredDraftSignal = false,
  autoFocus = submitLabel.startsWith("保存"),
  allowEmpty = false,
  submitDisabled = false,
  insertRequest,
  removeTextRequest,
  mentionCandidates = [],
  savedReplies = false,
  onInsertRequestApplied,
  onDiscardRestoredDraft,
  onBodyChange,
  onCancel,
  onSubmit,
}: IssueComposerProps) {
  const resolvedPlaceholder = placeholder ?? (textareaLabel.includes("评论") ? "留下评论" : "详细描述问题、复现步骤或期望结果");
  const [initialAttachmentDraft] = useState(() => readAttachmentDraft(persistenceKey, pagePath));
  const [body, setBody] = useState(() => {
    const persisted = readSessionDraft(persistenceKey);
    return preferPersistedDraft && persisted ? persisted : initialBody || persisted;
  });
  const [restoredDraft, setRestoredDraft] = useState(() => showRestoredDraftNotice && Boolean(restoredDraftSignal || readSessionDraft(persistenceKey) || initialAttachmentDraft?.attachments.length));
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [activeDraftId, setActiveDraftId] = useState(initialAttachmentDraft?.draftId ?? draftId);
  const [attachments, setAttachments] = useState<PendingAttachment[]>(() => initialAttachmentDraft?.attachments.map((attachment) => ({
    clientId: attachment.id,
    fileName: attachment.file_name,
    fileSize: attachment.size_bytes,
    previewUrl: isSafeImage(attachment.mime_type) ? attachment.url : null,
    attachment,
    markdown: issueAttachmentMarkdown(attachment),
    status: "uploaded" as const,
  })) ?? []);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<"submit" | IssueStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitAnnouncement, setSubmitAnnouncement] = useState("");
  const [attachmentLimitError, setAttachmentLimitError] = useState<string | null>(null);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const [caret, setCaret] = useState(body.length);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const composerId = `issue-composer-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const mentionListId = `${composerId}-mentions`;
  const editTabId = `${composerId}-edit-tab`;
  const previewTabId = `${composerId}-preview-tab`;
  const panelId = `${composerId}-panel`;
  const attachmentListId = `${composerId}-attachments`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addAttachmentButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { onBodyChange?.(body); }, [body, onBodyChange]);
  const attachmentRemoveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolbarButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [toolbarFocusIndex, setToolbarFocusIndex] = useState(0);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectionRef = useRef({ start: body.length, end: body.length });
  const selectionRestorePendingRef = useRef(false);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const uploadGenerationsRef = useRef(new Map<string, number>());
  const dragDepthRef = useRef(0);
  const appliedInsertRequestRef = useRef<number | null>(null);
  const appliedRemoveTextRequestRef = useRef<string | null>(null);
  const mentionQuery = mentionOpen ? findIssueMentionQuery(body, caret) : null;
  const normalizedMentionQuery = mentionQuery?.query.toLocaleLowerCase() ?? "";
  const mentionOptions = mentionQuery ? Array.from(new Map(mentionCandidates.map((candidate) => [candidate.id, candidate])).values()).filter((candidate) => {
    const displayName = candidate.displayName?.trim() || candidate.name?.trim() || candidate.id;
    return candidate.id.toLocaleLowerCase().includes(normalizedMentionQuery) || displayName.toLocaleLowerCase().includes(normalizedMentionQuery);
  }).slice(0, 8) : [];

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (submitAnnouncement && (body || attachments.length > 0)) setSubmitAnnouncement("");
  }, [attachments.length, body, submitAnnouncement]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  useEffect(() => {
    writeSessionDraft(persistenceKey, body);
  }, [body, persistenceKey]);

  useEffect(() => {
    writeAttachmentDraft(persistenceKey, activeDraftId, attachments);
    if (attachments.length === 0) setActiveDraftId(draftId);
  }, [activeDraftId, attachments, draftId, persistenceKey]);

  useEffect(() => {
    if (!insertRequest || appliedInsertRequestRef.current === insertRequest.id) return;
    appliedInsertRequestRef.current = insertRequest.id;
    setBody((current) => {
      const next = current.trim() ? `${current}\n\n${insertRequest.text}` : insertRequest.text;
      selectionRef.current = { start: next.length, end: next.length };
      return next;
    });
    setMode("edit");
    selectionRestorePendingRef.current = true;
    onInsertRequestApplied?.(insertRequest.id);
  }, [insertRequest, onInsertRequestApplied]);

  useEffect(() => {
    if (!removeTextRequest || appliedRemoveTextRequestRef.current === removeTextRequest.id) return;
    appliedRemoveTextRequestRef.current = removeTextRequest.id;
    const escapedUrl = removeTextRequest.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setBody((current) => current.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${escapedUrl}\\)`, "g"), "").replace(/\n{3,}/g, "\n\n").trim());
  }, [removeTextRequest]);

  useEffect(() => () => {
    uploadGenerationsRef.current.clear();
    attachmentsRef.current.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL?.(attachment.previewUrl);
    });
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !selectionRestorePendingRef.current) return;
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      selectionRestorePendingRef.current = false;
      textarea.focus();
      textarea.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [body, mode]);

  useEffect(() => { setActiveMentionIndex(0); }, [mentionQuery?.start, normalizedMentionQuery]);

  const updateAttachments = (updater: (current: PendingAttachment[]) => PendingAttachment[]) => {
    setAttachments((current) => {
      const next = updater(current);
      attachmentsRef.current = next;
      return next;
    });
  };

  const nextGeneration = (clientId: string): number => {
    const generation = (uploadGenerationsRef.current.get(clientId) ?? 0) + 1;
    uploadGenerationsRef.current.set(clientId, generation);
    return generation;
  };

  const removeMarkdown = (current: string, markdown: string): string => {
    if (!markdown) return current;
    return current.replace(markdown, "").replace(/\n{3,}/g, "\n\n").trim();
  };

  const upload = async (pending: PendingAttachment, generation: number) => {
    if (!pending.file) return;
    try {
      const attachment = await uploadIssueAttachment(pagePath, activeDraftId, pending.file);
      if (uploadGenerationsRef.current.get(pending.clientId) !== generation) {
        releaseIssueAttachment(pagePath, attachment);
        return;
      }
      const markdown = issueAttachmentMarkdown(attachment);
      const uploaded = { ...pending, attachment, markdown, status: "uploaded" as const, error: undefined };
      updateAttachments((current) => current.map((item) => item.clientId === pending.clientId ? uploaded : item));
      setBody((current) => current.trim() ? `${current}\n\n${markdown}` : markdown);
    } catch (error) {
      if (uploadGenerationsRef.current.get(pending.clientId) !== generation) return;
      updateAttachments((current) => current.map((item) => item.clientId === pending.clientId ? {
        ...item,
        status: "error" as const,
        error: error instanceof Error ? error.message : "附件上传失败",
      } : item));
    }
  };

  const addFiles = (files: File[]) => {
    const remainingCapacity = Math.max(0, MAX_DRAFT_ATTACHMENTS - attachmentsRef.current.length);
    const acceptedFiles = files.slice(0, remainingCapacity);
    const ignoredCount = files.length - acceptedFiles.length;
    setAttachmentLimitError(ignoredCount > 0 ? `每个草稿最多添加 20 个附件；已忽略 ${ignoredCount} 个文件` : null);
    acceptedFiles.forEach((file) => {
      const clientId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}-${Math.random()}`;
      const pending: PendingAttachment = {
        clientId,
        file,
        fileName: file.name,
        fileSize: file.size,
        previewUrl: filePreview(file),
        status: file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES ? "uploading" : "error",
        error: file.size === 0 ? "不能上传空文件" : file.size > MAX_ATTACHMENT_BYTES ? "单个附件不能超过 25 MiB" : undefined,
      };
      updateAttachments((current) => [...current, pending]);
      if (pending.status === "uploading") void upload(pending, nextGeneration(clientId));
    });
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  };

  const retry = (attachment: PendingAttachment) => {
    const next = { ...attachment, status: "uploading" as const, error: undefined };
    updateAttachments((current) => current.map((item) => item.clientId === attachment.clientId ? next : item));
    void upload(next, nextGeneration(attachment.clientId));
  };

  const remove = (attachment: PendingAttachment) => {
    const visibleIndex = visibleAttachments.findIndex((item) => item.clientId === attachment.clientId);
    const nextAttachmentId = visibleAttachments[visibleIndex + 1]?.clientId;
    const previousAttachmentId = visibleAttachments[visibleIndex - 1]?.clientId;
    setAttachmentLimitError(null);
    nextGeneration(attachment.clientId);
    if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL?.(attachment.previewUrl);
    updateAttachments((current) => current.filter((item) => item.clientId !== attachment.clientId));
    setBody((current) => removeMarkdown(current, attachment.markdown ?? issueAttachmentMarkdown(attachment.attachment)));
    if (attachment.attachment) releaseIssueAttachment(pagePath, attachment.attachment);
    window.requestAnimationFrame(() => {
      const target = (nextAttachmentId && attachmentRemoveButtonRefs.current.get(nextAttachmentId))
        || (previousAttachmentId && attachmentRemoveButtonRefs.current.get(previousAttachmentId))
        || addAttachmentButtonRef.current;
      target?.focus();
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>, statusAction?: IssueStatus) => {
    event.preventDefault();
    const currentAttachments = attachmentsRef.current;
    if (currentAttachments.some((attachment) => attachment.status !== "uploaded")) return;
    if (!allowEmpty && !body.trim() && !currentAttachments.some((attachment) => attachment.status === "uploaded")) return;
    setSubmitError(null);
    setSubmitAnnouncement("");
    setSubmitting(true);
    setSubmittingAction(statusAction ?? "submit");
    try {
      await onSubmit({
        body: body.trim(),
        attachmentIds: currentAttachments.flatMap((attachment) => attachment.status === "uploaded" && attachment.attachment ? [attachment.attachment.id] : []),
        draftId: activeDraftId,
        statusAction,
        stateReason: statusAction === "closed" ? closeReason : undefined,
      });
      setSubmitAnnouncement(statusAction === "closed" ? "评论并关闭成功" : statusAction === "open" ? "重新打开并评论成功" : `${submitLabel}成功`);
      uploadGenerationsRef.current.clear();
      currentAttachments.forEach((attachment) => {
        if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL?.(attachment.previewUrl);
      });
      setBody("");
      setRestoredDraft(false);
      writeSessionDraft(persistenceKey, "");
      attachmentsRef.current = [];
      setAttachments([]);
      setAttachmentLimitError(null);
      setAttachmentsExpanded(false);
      selectionRef.current = { start: 0, end: 0 };
      setCaret(0);
      setMentionOpen(false);
      setActiveMentionIndex(0);
      setMode("edit");
      if (!statusAction) window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
      setSubmittingAction(null);
    }
  };

  const attachmentsUploading = attachments.some((attachment) => attachment.status === "uploading");
  const attachmentsPending = attachments.some((attachment) => attachment.status !== "uploaded");
  const attachmentSubmitError = attachments.some((attachment) => attachment.status === "error")
    ? "请移除或重试上传失败的附件"
    : null;
  const contentMissing = !allowEmpty && !body.trim() && !attachments.some((attachment) => attachment.status === "uploaded");
  const actionDisabled = submitting || attachmentsPending || contentMissing || submitDisabled;
  const attachmentStatus = attachments.length === 0 ? "没有附件" : [
    `${attachments.filter((attachment) => attachment.status === "uploading").length} 个上传中`,
    `${attachments.filter((attachment) => attachment.status === "uploaded").length} 个已就绪`,
    `${attachments.filter((attachment) => attachment.status === "error").length} 个失败`,
  ].join("，");
  const uploadedAttachmentCount = attachments.filter((attachment) => attachment.status === "uploaded").length;
  const hiddenUploadedAttachmentCount = Math.max(0, uploadedAttachmentCount - VISIBLE_UPLOADED_ATTACHMENTS);
  let visibleUploadedAttachmentCount = 0;
  const visibleAttachments = attachments.filter((attachment) => {
    if (attachmentsExpanded || attachment.status !== "uploaded") return true;
    visibleUploadedAttachmentCount += 1;
    return visibleUploadedAttachmentCount <= VISIBLE_UPLOADED_ATTACHMENTS;
  });

  const restoreSelection = () => {
    selectionRestorePendingRef.current = true;
  };

  const discardRestoredDraft = () => {
    attachmentsRef.current.forEach((attachment) => { if (attachment.attachment) releaseIssueAttachment(pagePath, attachment.attachment); });
    setBody(initialBody);
    writeSessionDraft(persistenceKey, "");
    writeAttachmentDraft(persistenceKey, activeDraftId, []);
    updateAttachments(() => []);
    setAttachmentLimitError(null);
    setAttachmentsExpanded(false);
    setRestoredDraft(false);
    setMode("edit");
    onDiscardRestoredDraft?.();
  };

  const rememberSelection = () => {
    if (selectionRestorePendingRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
  };

  const runMarkdownCommand = (command: MarkdownCommand) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selectionRef.current.start;
    const end = textarea?.selectionEnd ?? selectionRef.current.end;
    const result = applyMarkdownCommand(body, start, end, command);
    selectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
    setBody(result.value);
    setMode("edit");
    restoreSelection();
  };

  const insertSavedReply = (reply: IssueSavedReply) => {
    const textarea = textareaRef.current;
    const result = insertIssueSavedReply(body, textarea?.selectionStart ?? selectionRef.current.start, textarea?.selectionEnd ?? selectionRef.current.end, reply.body);
    selectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
    setBody(result.body);
    setMode("edit");
    restoreSelection();
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (mentionQuery && mentionOptions.length > 0 && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionOpen(false); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveMentionIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + mentionOptions.length) % mentionOptions.length);
        return;
      }
      event.preventDefault();
      selectMention(mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
      return;
    }
    if (savedReplies && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === ".") {
      event.preventDefault();
      toolbarButtonRefs.current[toolbar.length]?.click();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const command = event.key.toLowerCase() === "b" ? "bold"
      : event.key.toLowerCase() === "i" ? "italic"
        : event.key.toLowerCase() === "k" ? "link"
          : null;
    if (!command) return;
    event.preventDefault();
    runMarkdownCommand(command);
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const submitShortcut = event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey;
    if (submitShortcut) {
      if (event.defaultPrevented || actionDisabled) return;
      event.preventDefault();
      event.currentTarget.requestSubmit();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "p") return;
    event.preventDefault();
    if (mode === "edit") {
      rememberSelection();
      setMode("preview");
      window.requestAnimationFrame(() => previewButtonRef.current?.focus());
    } else {
      setMode("edit");
      restoreSelection();
    }
  };

  const handleModeTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "ArrowLeft" || event.key === "Home" ? "edit" : "preview";
    if (nextMode === "preview" && mode === "edit") rememberSelection();
    setMode(nextMode);
    window.requestAnimationFrame(() => (nextMode === "edit" ? editButtonRef.current : previewButtonRef.current)?.focus());
  };

  const selectMention = (candidate: IssueUserIdentity) => {
    if (!mentionQuery) return;
    const result = applyIssueMention(body, mentionQuery, candidate.id);
    setBody(result.value);
    setCaret(result.caret);
    selectionRef.current = { start: result.caret, end: result.caret };
    selectionRestorePendingRef.current = true;
    setMentionOpen(false);
  };

  const handleBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setSubmitError(null);
    setBody(event.target.value);
    setCaret(event.target.selectionStart);
    selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
    setMentionOpen(true);
  };

  const toolbar: Array<{ command: MarkdownCommand; label: string; icon: typeof Bold }> = [
    { command: "heading", label: "标题格式", icon: Heading2 },
    { command: "bold", label: "粗体", icon: Bold },
    { command: "italic", label: "斜体", icon: Italic },
    { command: "quote", label: "引用", icon: Quote },
    { command: "code", label: "行内代码", icon: Code },
    { command: "link", label: "链接", icon: Link },
    { command: "bullet-list", label: "无序列表", icon: List },
    { command: "ordered-list", label: "有序列表", icon: ListOrdered },
    { command: "task-list", label: "任务列表", icon: ListTodo },
  ];

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const toolbarLength = toolbar.length + (savedReplies ? 1 : 0);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = toolbarLength - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + toolbarLength) % toolbarLength;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % toolbarLength;
    else return;
    event.preventDefault();
    setToolbarFocusIndex(nextIndex);
    toolbarButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <form onSubmit={(event) => void submit(event)} onKeyDown={handleComposerKeyDown} className="space-y-3">
      <span role="status" aria-live="polite" aria-atomic="true" aria-label="提交状态" className="sr-only">{submitAnnouncement}</span>
      {restoredDraft && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"><span>已恢复未提交的草稿</span><IssueDiscardDraftControl triggerLabel="丢弃草稿" onConfirm={discardRestoredDraft} focusAfterConfirm={() => textareaRef.current?.focus()} /></div>}
      <div data-localapp-issue-editor className="overflow-visible rounded-md border bg-background">
        <div role="tablist" aria-label="Markdown 模式" className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
          <button ref={editButtonRef} id={editTabId} type="button" role="tab" aria-selected={mode === "edit"} aria-controls={panelId} tabIndex={mode === "edit" ? 0 : -1} onKeyDown={handleModeTabKeyDown} onClick={() => { setMode("edit"); restoreSelection(); }} className={`h-11 rounded px-3 text-xs font-medium sm:h-7 sm:px-2 ${mode === "edit" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>编辑</button>
          <button ref={previewButtonRef} id={previewTabId} type="button" role="tab" aria-selected={mode === "preview"} aria-controls={panelId} tabIndex={mode === "preview" ? 0 : -1} aria-keyshortcuts="Meta+Shift+P Control+Shift+P" onKeyDown={handleModeTabKeyDown} onClick={() => { rememberSelection(); setMode("preview"); }} className={`h-11 rounded px-3 text-xs font-medium sm:h-7 sm:px-2 ${mode === "preview" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>预览</button>
        </div>
        {mode === "edit" ? <div id={panelId} role="tabpanel" aria-labelledby={editTabId}><div data-localapp-issue-toolbar role="toolbar" aria-label="Markdown 工具栏" className="flex min-h-10 flex-wrap items-center gap-0.5 overflow-x-hidden border-b bg-muted/20 px-2 py-1 sm:flex-nowrap sm:overflow-x-auto">
          {toolbar.map(({ command, label, icon: Icon }, index) => <Button key={command} ref={(element) => { toolbarButtonRefs.current[index] = element; }} type="button" variant="ghost" size="icon" tabIndex={toolbarFocusIndex === index ? 0 : -1} aria-label={label} title={label} className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" onFocus={() => setToolbarFocusIndex(index)} onKeyDown={(event) => handleToolbarKeyDown(event, index)} onMouseDown={(event) => event.preventDefault()} onClick={() => runMarkdownCommand(command)}><Icon className="h-4 w-4" /></Button>)}
          {savedReplies && <IssueSavedRepliesPicker ref={(element) => { toolbarButtonRefs.current[toolbar.length] = element; }} tabIndex={toolbarFocusIndex === toolbar.length ? 0 : -1} onFocus={() => setToolbarFocusIndex(toolbar.length)} onKeyDown={(event) => handleToolbarKeyDown(event, toolbar.length)} onInsert={insertSavedReply} />}
        </div>
          <div className="relative"><Textarea ref={textareaRef} aria-label={textareaLabel} placeholder={resolvedPlaceholder} aria-autocomplete="list" aria-expanded={mentionOptions.length > 0} aria-controls={mentionOptions.length > 0 ? mentionListId : undefined} aria-activedescendant={mentionOptions.length > 0 ? `${mentionListId}-${activeMentionIndex}` : undefined} value={body} onChange={handleBodyChange} onSelect={(event) => { rememberSelection(); setCaret(event.currentTarget.selectionStart); }} onKeyUp={(event) => { rememberSelection(); setCaret(event.currentTarget.selectionStart); }} onKeyDown={handleEditorKeyDown} onPaste={attachmentsEnabled ? handlePaste : undefined} rows={6} className="min-h-28 resize-y border-0 focus-visible:ring-0" />{mentionOptions.length > 0 && <div id={mentionListId} role="listbox" aria-label="提及用户建议" className="absolute left-2 right-2 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-[6px] border bg-popover p-1 shadow-lg">{mentionOptions.map((candidate, index) => { const displayName = candidate.displayName?.trim() || candidate.name?.trim() || candidate.id; return <button id={`${mentionListId}-${index}`} key={candidate.id} type="button" role="option" aria-label={`${displayName}，账号 @${candidate.id}`} aria-selected={index === activeMentionIndex} className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-sm sm:min-h-10 ${index === activeMentionIndex ? "bg-accent" : "hover:bg-muted"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(candidate)}><span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{Array.from(displayName)[0]?.toLocaleUpperCase() || "?"}</span><span className="min-w-0 flex-1 truncate"><strong>{displayName}</strong><span className="ml-2 text-muted-foreground">@{candidate.id}</span></span></button>; })}</div>}{mentionQuery && mentionOptions.length === 0 && <div role="status" aria-label="提及用户建议状态" className="absolute left-2 right-2 top-full z-30 mt-1 rounded-[6px] border bg-popover px-3 py-3 text-sm text-muted-foreground shadow-lg">没有匹配的用户</div>}</div>
        </div> : <div id={panelId} role="tabpanel" aria-labelledby={previewTabId} className="min-h-28 px-3 py-2">{body ? <IssueMarkdown>{body}</IssueMarkdown> : <p className="text-sm text-muted-foreground">暂无内容</p>}</div>}
      </div>

      {attachmentsEnabled && <div data-localapp-issue-attachment-queue tabIndex={-1} data-drag-active={dragActive ? "true" : undefined} aria-label="拖拽附件到此处" aria-busy={attachmentsUploading || undefined} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }} onDrop={handleDrop} className={`rounded-md border border-dashed px-3 py-2 transition-colors motion-reduce:transition-none ${dragActive ? "border-primary bg-primary/5 ring-2 ring-primary/20" : ""}`}>
        {dragActive && <span role="status" aria-label="附件拖拽状态" className="sr-only">松开以上传文件</span>}
        <span role="status" aria-label="附件队列状态" aria-live="polite" aria-atomic="true" className="sr-only">{attachmentStatus}</span>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} data-testid="issue-attachment-input" hidden type="file" multiple onChange={handleFiles} />
          <Button ref={addAttachmentButtonRef} type="button" variant="outline" size="sm" className="h-11 gap-1.5 sm:h-8" onClick={() => inputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />添加附件
          </Button>
          <span className={`text-xs ${dragActive ? "font-medium text-primary" : "text-muted-foreground"}`}>{dragActive ? "松开以上传文件" : "拖拽文件或粘贴截图"}</span>
        </div>
        {attachments.length > 0 && (
          <><ul id={attachmentListId} className="mt-2 grid gap-2 sm:grid-cols-2">
            {visibleAttachments.map((attachment) => (
              <li key={attachment.clientId} className="flex min-w-0 items-center gap-2 rounded border bg-card p-2 text-xs">
                {attachment.previewUrl ? <img src={attachment.previewUrl} alt={`${attachment.fileName} 预览`} className="h-10 w-10 shrink-0 rounded object-cover" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{attachment.fileName}</p>
                  <p role={attachment.status === "uploaded" ? "status" : undefined} aria-label={attachment.status === "uploaded" ? `${attachment.fileName} 已上传` : undefined} className={`inline-flex items-center gap-1 ${attachment.error ? "text-destructive" : attachment.status === "uploaded" ? "text-emerald-700" : "text-muted-foreground"}`}>{attachment.status === "uploaded" && <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}{attachment.error ?? (attachment.status === "uploading" ? "上传中..." : `已上传 · ${formatFileSize(attachment.fileSize)}`)}</p>
                </div>
                {attachment.status === "uploading" && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {attachment.status === "error" && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-7 sm:w-7" aria-label={`重试 ${attachment.fileName}`} onClick={() => retry(attachment)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                <Button ref={(element) => { if (element) attachmentRemoveButtonRefs.current.set(attachment.clientId, element); else attachmentRemoveButtonRefs.current.delete(attachment.clientId); }} type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-7 sm:w-7" aria-label={`移除 ${attachment.fileName}`} onClick={() => remove(attachment)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
          {hiddenUploadedAttachmentCount > 0 && <Button type="button" variant="ghost" size="sm" className="mt-2 h-11 sm:h-8" aria-expanded={attachmentsExpanded} aria-controls={attachmentListId} onClick={() => setAttachmentsExpanded((expanded) => !expanded)}>{attachmentsExpanded ? "收起已上传附件" : `显示其余 ${hiddenUploadedAttachmentCount} 个已上传附件`}</Button>}</>
        )}
      </div>}

      {attachmentLimitError && <p role="alert" data-localapp-issue-attachment-limit-error className="text-sm text-destructive">{attachmentLimitError}</p>}
      {(attachmentSubmitError || submitError) && <p role="alert" data-localapp-issue-submit-error className="text-sm text-destructive">{attachmentSubmitError || submitError}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={submitting} onClick={onCancel}>取消</Button>}
        <Button type="submit" size="sm" className="h-11 min-w-[5.5rem] gap-1.5 sm:h-8" aria-keyshortcuts="Meta+Enter Control+Enter" aria-busy={submittingAction === "submit" || undefined} disabled={actionDisabled}>{submittingAction === "submit" && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{submitLabel}</Button>
        {status === "open" && <Button type="button" variant="outline" size="sm" className="h-11 min-w-[7.5rem] gap-1.5 sm:h-8" aria-busy={submittingAction === "closed" || undefined} disabled={actionDisabled} onClick={(event) => void submit(event as unknown as FormEvent<HTMLFormElement>, "closed")}>{submittingAction === "closed" && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}评论并关闭</Button>}
        {status === "closed" && <Button type="button" variant="outline" size="sm" className="h-11 min-w-[9rem] gap-1.5 sm:h-8" aria-busy={submittingAction === "open" || undefined} disabled={actionDisabled} onClick={(event) => void submit(event as unknown as FormEvent<HTMLFormElement>, "open")}>{submittingAction === "open" && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}重新打开并评论</Button>}
      </div>
    </form>
  );
}
