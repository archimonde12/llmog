import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../lib/api";
import { streamChatCompletions } from "../lib/chatCompletionStream";

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

type PlaygroundPageProps = {
  hashModelId?: string;
  /** Full hash string so we re-apply ?model= when user navigates again. */
  hashKey: string;
};

export function PlaygroundPage(props: PlaygroundPageProps) {
  const { hashModelId, hashKey } = props;

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

  const [systemOpen, setSystemOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const [newTemplateName, setNewTemplateName] = useState("");
  const [saveHint, setSaveHint] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const templatesPopoverRef = useRef<HTMLDivElement | null>(null);
  const appliedHashRef = useRef<string | null>(null);

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
  }, [modelOptions]);

  const selectSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      abortRef.current?.abort();
      setSendErr(null);
      setInput("");
      setActiveSessionId(id);
    },
    [activeSessionId],
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

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  return (
    <div className="page playgroundPage">
      <div className="playgroundLayout">
        <aside className="playgroundSidebar panel">
          <div className="playgroundSidebarHead">
            <div className="panelTitle">Chats</div>
            <button type="button" className="btn mini" onClick={newChat}>
              New chat
            </button>
          </div>
          <div className="muted playgroundSidebarHint">History (stored in this browser)</div>
          <div className="playgroundTemplateList playgroundSessionList">
            {sortedSessions.map((s) => (
              <div key={s.id} className="playgroundTemplateRow">
                <button
                  type="button"
                  className={`listItem playgroundTemplateBtn ${s.id === activeSessionId ? "playgroundSessionActive" : ""}`}
                  onClick={() => selectSession(s.id)}
                >
                  <span className="playgroundSessionTitle">{s.title || "New chat"}</span>
                </button>
                <button
                  type="button"
                  className="btn mini btnDanger"
                  title="Delete chat"
                  onClick={() => deleteSession(s.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="playgroundMain">
          <div className="playgroundTop">
            <div className="topbar playgroundTopbar">
              <div className="topbarTitle">Playground</div>
              <div className="spacer" />
              <label className="field playgroundModelField">
                <span className="fieldLabel">Model</span>
                <select
                  className="modelPill"
                  value={modelId}
                  onChange={(e) => updateActiveSession({ modelId: e.target.value })}
                  disabled={modelsLoading || !modelOptions.length}
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {modelsErr ? <div className="alert err">{modelsErr}</div> : null}
            {!modelsLoading && !modelsErr && !modelOptions.length ? (
              <div className="alert err">No models configured. Add models in Configuration.</div>
            ) : null}

            <div className="playgroundParams">
              <label className="field">
                <span className="fieldLabel">Temperature</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  placeholder="default"
                  value={temperature}
                  onChange={(e) => updateActiveSession({ temperature: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="fieldLabel">Max tokens</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="default"
                  value={maxTokens}
                  onChange={(e) => updateActiveSession({ maxTokens: e.target.value })}
                />
              </label>
            </div>

            <div className="playgroundSystem">
              <div className="playgroundSystemHead">
                <button
                  type="button"
                  className="playgroundSystemToggle"
                  onClick={() => setSystemOpen((v) => !v)}
                  aria-expanded={systemOpen}
                >
                  System instruction {systemOpen ? "▼" : "\u25b6"}
                </button>
                <div className="playgroundTemplatesAnchor" ref={templatesPopoverRef}>
                  <button
                    type="button"
                    className={`btn mini playgroundTemplatesBtn${templatesOpen ? " modeOn" : ""}`}
                    aria-expanded={templatesOpen}
                    aria-label="Templates library"
                    title="Templates"
                    onClick={() => setTemplatesOpen((v) => !v)}
                  >
                    <span aria-hidden className="playgroundTplGlyph">
                      {String.fromCodePoint(0x1f4da)}
                    </span>{" "}
                    Templates
                  </button>
                  {templatesOpen ? (
                    <div className="playgroundTemplatesPopover panel">
                      <div className="muted playgroundSidebarHint">Templates</div>
                      {templatesLoading ? (
                        <div className="muted">Loading templates…</div>
                      ) : templatesErr ? (
                        <div className="alert err">{templatesErr}</div>
                      ) : null}
                      <div className="playgroundTemplateList">
                        {templates.map((t) => (
                          <div key={t.id} className="playgroundTemplateRow">
                            <button
                              type="button"
                              className="listItem playgroundTemplateBtn"
                              onClick={() => applyTemplate(t)}
                            >
                              <span className="mono">{t.name}</span>
                            </button>
                            <button
                              type="button"
                              className="btn mini btnDanger"
                              title="Delete template"
                              onClick={() => void deleteTemplate(t.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {!templates.length && !templatesLoading ? (
                          <div className="muted">No saved templates yet.</div>
                        ) : null}
                      </div>
                      <div className="playgroundSaveTpl">
                        <input
                          type="text"
                          placeholder="Template name"
                          value={newTemplateName}
                          onChange={(e) => setNewTemplateName(e.target.value)}
                          aria-label="New template name"
                        />
                        <button
                          type="button"
                          className="btn mini btnPrimary"
                          onClick={() => void saveAsTemplate()}
                        >
                          Save as template
                        </button>
                        {saveHint ? <div className="muted playgroundSaveHint">{saveHint}</div> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {systemOpen ? (
                <textarea
                  className="playgroundSystemText"
                  placeholder="Optional system message (sent as the first message when non-empty)"
                  value={systemPrompt}
                  onChange={(e) => updateActiveSession({ systemPrompt: e.target.value })}
                  rows={4}
                />
              ) : null}
            </div>
          </div>

          <div className="playgroundChatWrap">
            <div className="playgroundMessages">
              {!messages.length ? (
                <div className="muted playgroundEmpty">Send a message to start. Model: {modelLabel || "—"}</div>
              ) : null}
              {messages.map((m, i) => (
                <div key={i} className={`playgroundMsg playgroundMsg--${m.role}`}>
                  <div className="playgroundMsgMeta">
                    <span
                      className={`pill ${m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system"}`}
                    >
                      {m.role}
                    </span>
                  </div>
                  <pre className="playgroundMsgBody">
                    {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                  </pre>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {sendErr ? <div className="alert err playgroundSendErr">{sendErr}</div> : null}

            <div className="playgroundComposer">
              <textarea
                className="playgroundInput"
                placeholder="Message…"
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="playgroundComposerActions">
                {streaming ? (
                  <button type="button" className="btn" onClick={stop}>
                    Stop
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btnPrimary"
                  onClick={() => void send()}
                  disabled={streaming || !modelId || !input.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
