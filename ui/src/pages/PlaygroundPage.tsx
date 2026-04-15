import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Bot, Box, ChevronDown, Cloud, Cpu, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { apiGet, apiPut } from "../lib/api";
import { streamChatCompletions } from "../lib/chatCompletionStream";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

type ModelListItem = { id: string; object?: string; owned_by?: string };

type ModelsListResponse = {
  object?: string;
  data?: ModelListItem[];
};

type PlaygroundTemplate = {
  id: string;
  name: string;
  systemPrompt: string;
  temperature?: number;
  max_tokens?: number;
  defaultModelId?: string;
};

type TemplatesResponse = {
  templates: PlaygroundTemplate[];
  loadedFromPath?: string;
  usedAlternateWritePath?: boolean;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

type PlaygroundSession = {
  id: string;
  title: string;
  updatedAt: number;
  modelId: string;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
  messages: ChatMessage[];
};

const LS_SESSIONS = "llmog:playground:sessions:v1";
const LS_ACTIVE = "llmog:playground:activeSession:v1";

const COMPOSER_MAX_HEIGHT_PX = 192;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function firstUserTitle(messages: ChatMessage[]): string {
  const u = messages.find((m) => m.role === "user");
  const t = (u?.content ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

function emptySession(fallbackModelId: string): PlaygroundSession {
  return {
    id: randomId(),
    title: "New chat",
    updatedAt: Date.now(),
    modelId: fallbackModelId,
    systemPrompt: "",
    temperature: "",
    maxTokens: "",
    messages: [],
  };
}

function loadPersistedSessions(): { sessions: PlaygroundSession[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(LS_SESSIONS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessions?: PlaygroundSession[] };
    if (!parsed?.sessions || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return null;
    const sessions = parsed.sessions.map((s) => ({
      id: String(s.id ?? randomId()),
      title: String(s.title ?? "Chat"),
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
      modelId: String(s.modelId ?? ""),
      systemPrompt: String(s.systemPrompt ?? ""),
      temperature: String(s.temperature ?? ""),
      maxTokens: String(s.maxTokens ?? ""),
      messages: Array.isArray(s.messages) ? s.messages : [],
    }));
    const activeId = localStorage.getItem(LS_ACTIVE) ?? sessions[0]!.id;
    return { sessions, activeId };
  } catch {
    return null;
  }
}

function modelProviderIcon(model: ModelListItem): LucideIcon {
  const t = `${model.id} ${model.owned_by ?? ""}`.toLowerCase();
  if (t.includes("openai") || t.includes("gpt")) return Sparkles;
  if (t.includes("anthropic") || t.includes("claude")) return Bot;
  if (t.includes("google") || t.includes("gemini")) return Cloud;
  if (t.includes("meta") || t.includes("llama")) return Cpu;
  return Box;
}

type PlaygroundPageProps = {
  hashModelId?: string;
  /** Full hash string so we re-apply ?model= when user navigates again. */
  hashKey: string;
};

export function PlaygroundPage(props: PlaygroundPageProps) {
  const { hashModelId, hashKey } = props;
  const prefersReducedMotion = usePrefersReducedMotion();

  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelListItem[]>([]);

  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesErr, setTemplatesErr] = useState<string | null>(null);
  const [templates, setTemplates] = useState<PlaygroundTemplate[]>([]);

  const [sessions, setSessions] = useState<PlaygroundSession[]>(() => {
    const p = loadPersistedSessions();
    if (p) return p.sessions;
    return [emptySession("")];
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const p = loadPersistedSessions();
    if (p) return p.activeId;
    return "";
  });

  const [systemOpen, setSystemOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [messageComposerFocused, setMessageComposerFocused] = useState(false);

  const [newTemplateName, setNewTemplateName] = useState("");
  const [saveHint, setSaveHint] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const templatesPopoverRef = useRef<HTMLDivElement | null>(null);
  const appliedHashRef = useRef<string | null>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId],
  );

  const modelId = activeSession?.modelId ?? "";
  const systemPrompt = activeSession?.systemPrompt ?? "";
  const temperature = activeSession?.temperature ?? "";
  const maxTokens = activeSession?.maxTokens ?? "";
  const messages = activeSession?.messages ?? [];

  const updateActiveSession = useCallback(
    (patch: Partial<PlaygroundSession>) => {
      setSessions((prev) => {
        const id = activeSessionId || prev[0]?.id;
        if (!id) return prev;
        return prev.map((s) =>
          s.id === id
            ? {
              ...s,
              ...patch,
              updatedAt: Date.now(),
              ...(patch.messages ? { title: firstUserTitle(patch.messages) } : {}),
            }
            : s,
        );
      });
    },
    [activeSessionId],
  );

  const adjustComposerHeight = useCallback(() => {
    const el = messageTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(42, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, []);

  useLayoutEffect(() => {
    adjustComposerHeight();
  }, [input, adjustComposerHeight]);

  useEffect(() => {
    if (!sessions.length) {
      const s = emptySession("");
      setSessions([s]);
      setActiveSessionId(s.id);
      return;
    }
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0]!.id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_SESSIONS, JSON.stringify({ v: 1, sessions }));
        if (activeSessionId) localStorage.setItem(LS_ACTIVE, activeSessionId);
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(t);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    (async () => {
      try {
        setModelsErr(null);
        setModelsLoading(true);
        const res = await apiGet<ModelsListResponse>("/v1/models");
        const list = res.data ?? [];
        setModelOptions(list);
        const first = list[0]?.id ?? "";
        setSessions((prev) => {
          if (!prev.length) return [emptySession(first)];
          return prev.map((s) => (s.modelId ? s : { ...s, modelId: first }));
        });
      } catch (e: unknown) {
        setModelsErr(e instanceof Error ? e.message : String(e));
      } finally {
        setModelsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setTemplatesErr(null);
        setTemplatesLoading(true);
        const res = await apiGet<TemplatesResponse>("/admin/playground/templates");
        setTemplates(res.templates ?? []);
      } catch (e: unknown) {
        setTemplates([]);
        setTemplatesErr(e instanceof Error ? e.message : String(e));
      } finally {
        setTemplatesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hashModelId || !modelOptions.length) return;
    const key = `${hashKey}:${hashModelId}`;
    if (appliedHashRef.current === key) return;
    if (!modelOptions.some((m) => m.id === hashModelId)) return;
    appliedHashRef.current = key;
    updateActiveSession({ modelId: hashModelId });
  }, [hashModelId, hashKey, modelOptions, updateActiveSession]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = templatesPopoverRef.current;
      if (!el || !templatesOpen) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setTemplatesOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [templatesOpen]);

  const focusMessageComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      messageTextareaRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (modelsLoading || !modelId) return;
    const id = window.requestAnimationFrame(() => {
      messageTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [modelsLoading, modelId, activeSessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        focusMessageComposer();
        return;
      }
      if (e.key === "/" && !mod) {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        focusMessageComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMessageComposer]);

  const scrollToBottom = useCallback(() => {
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const persistTemplates = useCallback(async (next: PlaygroundTemplate[]) => {
    await apiPut("/admin/playground/templates", { templates: next });
    setTemplates(next);
    setSaveHint("Saved.");
    window.setTimeout(() => setSaveHint(null), 2500);
  }, []);

  const applyTemplate = useCallback(
    (t: PlaygroundTemplate) => {
      updateActiveSession({
        systemPrompt: t.systemPrompt ?? "",
        temperature: typeof t.temperature === "number" ? String(t.temperature) : "",
        maxTokens: typeof t.max_tokens === "number" ? String(t.max_tokens) : "",
        ...(t.defaultModelId && modelOptions.some((m) => m.id === t.defaultModelId)
          ? { modelId: t.defaultModelId }
          : {}),
      });
      setTemplatesOpen(false);
    },
    [modelOptions, updateActiveSession],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setSendErr(null);
    setInput("");
    const first = modelOptions[0]?.id ?? "";
    const s = emptySession(first);
    setSessions((prev) => [s, ...prev]);
    setActiveSessionId(s.id);
    focusMessageComposer();
  }, [modelOptions, focusMessageComposer]);

  const selectSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      abortRef.current?.abort();
      setSendErr(null);
      setInput("");
      setActiveSessionId(id);
      focusMessageComposer();
    },
    [activeSessionId, focusMessageComposer],
  );

  const deleteSession = useCallback(
    (id: string) => {
      abortRef.current?.abort();
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (!next.length) {
          const s = emptySession(modelOptions[0]?.id ?? "");
          setActiveSessionId(s.id);
          return [s];
        }
        if (id === activeSessionId) {
          setActiveSessionId(next[0]!.id);
        }
        return next;
      });
    },
    [activeSessionId, modelOptions],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      try {
        const next = templates.filter((t) => t.id !== id);
        await persistTemplates(next);
      } catch (e: unknown) {
        setTemplatesErr(e instanceof Error ? e.message : String(e));
      }
    },
    [templates, persistTemplates],
  );

  const saveAsTemplate = useCallback(async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      const t: PlaygroundTemplate = {
        id: randomId(),
        name,
        systemPrompt,
        ...(temperature !== "" && !Number.isNaN(Number(temperature))
          ? { temperature: Number(temperature) }
          : {}),
        ...(maxTokens !== "" && !Number.isNaN(Number(maxTokens))
          ? { max_tokens: Math.max(1, Math.floor(Number(maxTokens))) }
          : {}),
        ...(modelId ? { defaultModelId: modelId } : {}),
      };
      await persistTemplates([...templates, t]);
      setNewTemplateName("");
    } catch (e: unknown) {
      setTemplatesErr(e instanceof Error ? e.message : String(e));
    }
  }, [newTemplateName, systemPrompt, temperature, maxTokens, modelId, templates, persistTemplates]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !modelId || streaming) return;

    setSendErr(null);
    setInput("");

    const apiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: "system", content: systemPrompt.trim() });
    }
    for (const m of messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }
    apiMessages.push({ role: "user", content: text });

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    updateActiveSession({ messages: nextMessages });
    scrollToBottom();

    const body: Record<string, unknown> = {
      model: modelId,
      messages: apiMessages,
      stream: true,
    };
    if (temperature !== "" && !Number.isNaN(Number(temperature))) {
      body.temperature = Number(temperature);
    }
    if (maxTokens !== "" && !Number.isNaN(Number(maxTokens))) {
      body.max_tokens = Math.max(1, Math.floor(Number(maxTokens)));
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);

    try {
      await streamChatCompletions("/v1/chat/completions", body, {
        signal: ac.signal,
        onDelta: (t) => {
          setSessions((prev) => {
            const id = activeSessionId || prev[0]?.id;
            if (!id) return prev;
            return prev.map((s) => {
              if (s.id !== id) return s;
              const copy = [...s.messages];
              const last = copy.length - 1;
              if (last >= 0 && copy[last]!.role === "assistant") {
                copy[last] = { ...copy[last]!, content: copy[last]!.content + t };
              }
              return {
                ...s,
                messages: copy,
                title: firstUserTitle(copy),
                updatedAt: Date.now(),
              };
            });
          });
          scrollToBottom();
        },
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        // stopped by user
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setSendErr(msg);
        setSessions((prev) => {
          const id = activeSessionId || prev[0]?.id;
          if (!id) return prev;
          return prev.map((s) => {
            if (s.id !== id) return s;
            const copy = [...s.messages];
            const last = copy.length - 1;
            if (last >= 0 && copy[last]!.role === "assistant" && copy[last]!.content === "") {
              copy.pop();
            }
            if (
              copy.length &&
              copy[copy.length - 1]!.role === "user" &&
              copy[copy.length - 1]!.content === text
            ) {
              copy.pop();
            }
            return { ...s, messages: copy, title: firstUserTitle(copy), updatedAt: Date.now() };
          });
        });
        setInput(text);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [
    input,
    modelId,
    streaming,
    systemPrompt,
    messages,
    temperature,
    maxTokens,
    scrollToBottom,
    activeSessionId,
    updateActiveSession,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const modelLabel = useMemo(() => {
    const m = modelOptions.find((x) => x.id === modelId);
    return m?.id ?? modelId;
  }, [modelOptions, modelId]);

  const activeModel = useMemo(() => modelOptions.find((x) => x.id === modelId), [modelOptions, modelId]);
  const ModelGlyph = useMemo(() => modelProviderIcon(activeModel ?? { id: modelId }), [activeModel, modelId]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const systemSummary = useMemo(() => {
    const t = systemPrompt.trim().replace(/\s+/g, " ");
    if (!t) return "No system message (optional)";
    return t.length > 88 ? `${t.slice(0, 87)}…` : t;
  }, [systemPrompt]);

  const tempSlider = useMemo(() => {
    const n = Number(temperature);
    if (temperature === "" || Number.isNaN(n)) return 1;
    return Math.min(2, Math.max(0, n));
  }, [temperature]);

  const maxSlider = useMemo(() => {
    const n = Number(maxTokens);
    if (maxTokens === "" || Number.isNaN(n)) return 2048;
    return Math.min(8192, Math.max(1, Math.floor(n)));
  }, [maxTokens]);

  const sliderTone = {
    trackClassName: "bg-muted",
    rangeClassName: "bg-primary",
    thumbClassName:
      "border-2 border-primary-foreground/40 bg-primary shadow-md hover:bg-primary/90 focus-visible:ring-primary",
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="playground-page flex min-h-[calc(100vh-4rem)] flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,14rem)_1fr]">
        <aside
          className={cn(
            "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm lg:min-h-0",
            messageComposerFocused &&
            "[&_.pg-session-list]:opacity-60 hover:[&_.pg-session-list]:opacity-100",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Chats</h2>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-6 w-full justify-center gap-2 border-border/60 bg-transparent text-muted-foreground shadow-none transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground/90"
            onClick={newChat}
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            New chat
          </Button>
          <p className="text-xs text-muted-foreground">History (stored in this browser)</p>
          <div className="pg-session-list flex min-h-0 flex-1 flex-col overflow-y-auto transition-opacity duration-200 ease-out">
            {sortedSessions.map((s) => (
              <div key={s.id} className="group flex items-stretch gap-0 border-b border-border/60 py-1 last:border-b-0">
                <button
                  type="button"
                  onClick={() => selectSession(s.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left text-sm transition-colors",
                    s.id === activeSessionId
                      ? "bg-primary/40 text-foreground"
                      : "text-foreground/90 hover:bg-white/[0.04]",
                  )}
                >
                  {s.title || "New chat"}
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 text-destructive opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  title="Delete chat"
                  onClick={() => deleteSession(s.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">Playground</h1>
            </div>
            {modelsErr ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{modelsErr}</div>
            ) : null}
            {!modelsLoading && !modelsErr && !modelOptions.length ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                No models configured. Add models in Configuration.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-8">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Label htmlFor="pg-temp" className="w-[5.5rem] shrink-0 text-xs font-medium text-muted-foreground">
                  Temperature
                </Label>
                <Slider
                  id="pg-temp"
                  className="w-28 shrink-0"
                  value={[tempSlider]}
                  min={0}
                  max={2}
                  step={0.05}
                  {...sliderTone}
                  onValueChange={(v) => updateActiveSession({ temperature: String(v[0] ?? 0) })}
                />
                <Input
                  id="pg-temp-input"
                  className="h-8 max-w-[4.75rem] shrink-0 font-mono text-xs"
                  inputMode="decimal"
                  placeholder="—"
                  value={temperature}
                  onChange={(e) => updateActiveSession({ temperature: e.target.value })}
                  aria-label="Temperature exact value"
                />
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                  {temperature === "" || Number.isNaN(Number(temperature)) ? "default (not sent)" : temperature}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Label htmlFor="pg-max" className="w-[5.5rem] shrink-0 text-xs font-medium text-muted-foreground">
                  Max tokens
                </Label>
                <Slider
                  id="pg-max"
                  className="w-28 shrink-0"
                  value={[maxSlider]}
                  min={1}
                  max={8192}
                  step={64}
                  {...sliderTone}
                  onValueChange={(v) => updateActiveSession({ maxTokens: String(v[0] ?? 2048) })}
                />
                <Input
                  id="pg-max-input"
                  className="h-8 max-w-[4.75rem] shrink-0 font-mono text-xs"
                  inputMode="numeric"
                  placeholder="—"
                  value={maxTokens}
                  onChange={(e) => updateActiveSession({ maxTokens: e.target.value })}
                  aria-label="Max tokens exact value"
                />
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                  {maxTokens === "" || Number.isNaN(Number(maxTokens)) ? "default (not sent)" : maxSlider}
                </span>
              </div>
            </div>

            <Collapsible open={systemOpen} onOpenChange={setSystemOpen}>
              <div className="flex flex-wrap items-start gap-2">
                <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/10 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/20">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">System instruction</span>
                    {!systemOpen ? <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{systemSummary}</span> : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{systemOpen ? "▼" : "▶"}</span>
                </CollapsibleTrigger>
                <div className="relative shrink-0" ref={templatesPopoverRef}>
                  <Button
                    type="button"
                    size="sm"
                    variant={templatesOpen ? "secondary" : "outline"}
                    aria-expanded={templatesOpen}
                    aria-label="Templates library"
                    title="Templates"
                    onClick={() => setTemplatesOpen((v) => !v)}
                  >
                    Templates
                  </Button>
                  {templatesOpen ? (
                    <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                      <p className="text-xs text-muted-foreground">Templates</p>
                      {templatesLoading ? <div className="mt-2 text-xs text-muted-foreground">Loading templates…</div> : null}
                      {templatesErr ? (
                        <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">{templatesErr}</div>
                      ) : null}
                      <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                        {templates.map((t) => (
                          <div key={t.id} className="flex items-center gap-1">
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs font-mono hover:bg-muted"
                              onClick={() => applyTemplate(t)}
                            >
                              {t.name}
                            </button>
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-destructive" title="Delete template" onClick={() => void deleteTemplate(t.id)}>
                              ×
                            </Button>
                          </div>
                        ))}
                        {!templates.length && !templatesLoading ? <div className="text-xs text-muted-foreground">No saved templates yet.</div> : null}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                        <Input
                          type="text"
                          placeholder="Template name"
                          value={newTemplateName}
                          onChange={(e) => setNewTemplateName(e.target.value)}
                          aria-label="New template name"
                        />
                        <Button type="button" size="sm" onClick={() => void saveAsTemplate()}>
                          Save as template
                        </Button>
                        {saveHint ? <p className="text-xs text-muted-foreground">{saveHint}</p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <CollapsibleContent className="mt-2 overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <textarea
                  className="min-h-[6rem] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Optional system message (sent as the first message when non-empty)"
                  value={systemPrompt}
                  onChange={(e) => updateActiveSession({ systemPrompt: e.target.value })}
                  rows={4}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {hasMessages ? (
              <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-4">
                <div className="flex min-h-0 w-full flex-1 flex-col space-y-3 rounded-xl border border-border bg-background p-3">
                  {messages.map((m, i) => (
                    <div key={i} className={cn("flex w-full", m.role === "user" ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[min(100%,42rem)] rounded-2xl border border-border/70 bg-muted/20 px-3 py-2 text-sm text-foreground shadow-sm",
                        )}
                      >
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{m.role}</div>
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                          {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                        </pre>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>
            ) : null}

            <div
              className={cn(
                "flex min-h-0 shrink-0 flex-col px-4 pb-4 pt-2",
                !hasMessages && "flex-1 justify-center",
              )}
            >
              {!hasMessages ? (
                <p className="mb-3 text-center text-sm text-muted-foreground">Write a message to start.</p>
              ) : null}
              {sendErr ? (
                <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sendErr}</div>
              ) : null}

              <div
                className={cn(
                  "rounded-2xl border border-zinc-800 bg-black p-3 shadow-sm",
                  hasMessages && "ring-[1px] ring-zinc-800/50",
                )}
              >
                <textarea
                  ref={messageTextareaRef}
                  rows={1}
                  className={cn(
                    "pg-message-composer max-h-48 overflow-y-auto overflow-x-hidden",
                    "w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80",
                    "transition-[box-shadow,border-color,background-color] duration-200",
                    "focus-visible:border-zinc-600/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-offset-0",
                  )}
                  placeholder="Message…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setMessageComposerFocused(true)}
                  onBlur={() => setMessageComposerFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  style={{
                    minHeight: "42px !important",
                  }}
                />
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800/80 pt-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="pg-model-trigger"
                        aria-label="Model"
                        className="max-w-[min(100%,14rem)] shrink-0 gap-2 border-border bg-muted/20 hover:bg-muted/30"
                        disabled={modelsLoading || !modelOptions.length}
                      >
                        <ModelGlyph className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">{modelLabel || "—"}</span>
                        <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[12rem]">
                      {modelOptions.map((m) => {
                        const Icon = modelProviderIcon(m);
                        return (
                          <DropdownMenuItem
                            key={m.id}
                            className="gap-2 font-mono text-xs"
                            onSelect={() => updateActiveSession({ modelId: m.id })}
                          >
                            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{m.id}</span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {streaming ? (
                    <Button type="button" variant="secondary" size="sm" onClick={stop}>
                      Stop
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={streaming || !modelId || !input.trim()}
                    className="gap-2 shadow-sm"
                    onClick={() => void send()}
                  >
                    <Send className="size-4 shrink-0" aria-hidden />
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
