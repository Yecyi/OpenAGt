/* OpenAGt Desktop — main app */

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { SESSIONS, PROVIDERS, TRANSCRIPTS } = window.AGT;

/* ---------- Title bar ---------- */
function TitleBar({ activeSession, online, theme, onTheme, onPalette, onMission, onPermissions, pendingApprovals, onSystem }) {
  return (
    <div className="titlebar">
      <div className="lights">
        <span className="light r"></span>
        <span className="light y"></span>
        <span className="light g"></span>
      </div>
      <div className="title-center">
        <span>OpenAGt</span>
        <span className="tb-ver">v1.17.0-rc.3</span>
      </div>
      <div className="title-right">
        <button className="tb-btn" onClick={onMission} title="Mission Control">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="5.5" /><line x1="8" y1="2.5" x2="8" y2="5" /><line x1="8" y1="11" x2="8" y2="13.5" />
            <line x1="2.5" y1="8" x2="5" y2="8" /><line x1="11" y1="8" x2="13.5" y2="8" />
          </svg>
          <span>Mission</span>
        </button>
        <button className="tb-btn" onClick={onPermissions} title="Permission Center">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M8 2 L13 4 V8 C13 11 8 14 8 14 C8 14 3 11 3 8 V4 Z" />
          </svg>
          <span>Permissions</span>
          {pendingApprovals > 0 && <span className="tb-badge">{pendingApprovals}</span>}
        </button>
        <button className="icon-btn" title="Command palette (⌘K)" onClick={onPalette}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2" y="2" width="4" height="4" /><rect x="10" y="2" width="4" height="4" />
            <rect x="2" y="10" width="4" height="4" /><rect x="10" y="10" width="4" height="4" />
          </svg>
        </button>
        <span className="ind"><span className="live-dot"></span>{online ? "Live" : "Offline"}</span>
        <button className="tb-btn" onClick={onSystem} title="System settings">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="2.4" />
            <path d="M8 2v1.6 M8 12.4v1.6 M2 8h1.6 M12.4 8h1.6 M3.5 3.5l1.1 1.1 M11.4 11.4l1.1 1.1 M3.5 12.5l1.1-1.1 M11.4 4.6l1.1-1.1" />
          </svg>
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

/* ---------- Status bar ---------- */
function StatusBar({ session, tokens }) {
  return (
    <div className="statusbar">
      <div className="left">
        <span>Vol. I · No. 17</span>
        <span>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
      </div>
      <div className="right">
        <span>Model · {session.model}</span>
        <span>Tokens · {tokens.toLocaleString()}</span>
        <span style={{ color: "var(--ink)" }}>All Systems Operational</span>
      </div>
    </div>
  );
}

/* ---------- Sidebar ---------- */
function Sidebar({ sessions, activeId, onSelect, onPalette }) {
  const [q, setQ] = useState("");
  const filtered = q ? sessions.filter(s => (s.name + s.project + s.branch).toLowerCase().includes(q.toLowerCase())) : sessions;
  const active = filtered.filter(s => s.section === "active");
  const archive = filtered.filter(s => s.section === "archive");
  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <svg className="ss-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search sessions…"
          onFocus={() => {}}
        />
        <button className="ss-kbd" onClick={onPalette} title="Open command palette">⌘K</button>
      </div>
      <div className="sessions">
        <div className="section-label">Active Sessions <span className="count">{String(active.length).padStart(2,"0")}</span></div>
        {active.map(s => <SessionRow key={s.id} s={s} active={s.id === activeId} onSelect={onSelect} />)}
        <div className="section-label">Archive <span className="count">{String(archive.length).padStart(2,"0")}</span></div>
        {archive.map(s => <SessionRow key={s.id} s={s} active={s.id === activeId} onSelect={onSelect} />)}
      </div>
      <div className="sidebar-foot">
        <div className="avatar">SC</div>
        <div className="who"><b>User</b><span>S. CYI · LOCAL</span></div>
        <button className="icon-btn" title="Settings">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.5" /><circle cx="8" cy="8" r="6" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
function SessionRow({ s, active, onSelect }) {
  return (
    <div className={`session ${active ? "active" : ""}`} onClick={() => onSelect(s.id)}>
      <div className="glyph">{s.glyph}</div>
      <div>
        <div className="name">{s.name}</div>
        <div className="sub">
          {s.status === "live" && <span className="dot live"></span>}
          {s.status === "idle" && <span className="dot"></span>}
          <span>{s.when}</span>
          <span style={{ color: "var(--ink-4)" }}>·</span>
          <span className="pill">{s.pill}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Combined topbar removed — handled in sidebar + feed ---------- */

/* ---------- Turn renderers ---------- */
function UserTurn({ t }) {
  return (
    <div className="turn">
      <div className="byline user">
        <div className="mark">SC</div>
        <div className="who">User<small>{t.sub}</small></div>
        <div className="ts">{t.ts}</div>
      </div>
      <div className="user-msg">{t.text}</div>
    </div>
  );
}
function MonologueTurn({ t }) {
  return (
    <div className="turn">
      <div className="byline">
        <div className="mark" style={{ background: "transparent" }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="3" y="3" width="10" height="10" /><line x1="3" y1="6" x2="13" y2="6" /><line x1="3" y1="10" x2="13" y2="10" />
          </svg>
        </div>
        <div className="who">Reasoning<small>private to the agent</small></div>
        <div className="ts">{t.ts}</div>
      </div>
      <div className="monologue">{t.text}</div>
    </div>
  );
}
function AgentTurn({ t, streaming, streamLen }) {
  return (
    <div className="turn">
      <div className="byline">
        <div className="mark">A</div>
        <div className="who">{t.who}<small>{t.sub}</small></div>
        <div className="ts">{t.ts}</div>
      </div>
      <div className="agent-msg">
        {t.blocks.map((b, i) => {
          if (b.type === "p") return <p key={i}>{b.text}{streaming && i === t.blocks.length - 1 ? <span className="caret"></span> : null}</p>;
          if (b.type === "h3") return <h3 key={i}>{b.text}</h3>;
          if (b.type === "ul") return (
            <ul key={i}>{b.items.map(([k, v], j) => <li key={j}><b>{k}.</b> {v}</li>)}</ul>
          );
          return null;
        })}
      </div>
    </div>
  );
}
function ToolTurn({ t }) {
  return (
    <div className="turn">
      <div className="byline">
        <div className="mark" style={{ background: "var(--paper-2)" }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <polyline points="3,5 6,8 3,11" /><line x1="8" y1="12" x2="13" y2="12" />
          </svg>
        </div>
        <div className="who">Tool Call<small>permission · auto</small></div>
        <div className="ts">{t.ts}</div>
      </div>
      <div className="toolcall">
        <div className="tc-head">
          <div>
            <span className="label">{t.label}</span>
            <span className="name">{t.name}()</span>
          </div>
          <span className={`status ${t.status}`}>{t.statusLabel}</span>
        </div>
        <pre dangerouslySetInnerHTML={{ __html: t.body }} />
      </div>
    </div>
  );
}
function ApprovalTurn({ t, onResolve, resolved }) {
  return (
    <div className="turn">
      <div className="byline">
        <div className="mark" style={{ background: "var(--ink)", color: "var(--paper)" }}>!</div>
        <div className="who">Approval Required<small>shell_safety · confirm</small></div>
        <div className="ts">{t.ts}</div>
      </div>
      <div className="approval">
        <div>
          <div className="lab">The agent requests permission</div>
          <div className="ask">{t.ask}</div>
        </div>
        <div className="acts">
          {!resolved ? (
            <>
              <button className="btn-block" onClick={() => onResolve("block")}>Block</button>
              <button className="btn-allow" onClick={() => onResolve("allow")}>Allow Once</button>
            </>
          ) : (
            <span className="lab" style={{ color: "var(--ink)" }}>{resolved === "allow" ? "✓ Allowed" : "✗ Blocked"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Composer ---------- */
function Composer({ value, onChange, onSend, mode, setMode, effort, setEffort, model, setModel, settings, setSettings, onMission }) {
  const ref = useRef(null);
  const [effortOpen, setEffortOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const effortRef = useRef(null);
  const modeRef = useRef(null);
  const modelRef = useRef(null);
  const settingsRef = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(140, ref.current.scrollHeight) + "px";
    }
  }, [value]);
  useEffect(() => {
    const onDoc = (e) => {
      if (effortRef.current && !effortRef.current.contains(e.target)) setEffortOpen(false);
      if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false);
      if (modelRef.current && !modelRef.current.contains(e.target)) setModelOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const efforts = ["Low", "Medium", "High", "Deep"];
  const models = [
    { id: "auto",              name: "Auto",              desc: "Route per turn — Haiku for cheap, Sonnet for code, Opus for hard reasoning" },
    { id: "claude-opus-4",     name: "Claude Opus 4",     desc: "Strongest reasoning · slow, expensive" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", desc: "Balanced default for agentic work" },
    { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5",  desc: "Fast + cheap · short turns" },
    { id: "gpt-5.1",           name: "GPT-5.1",           desc: "OpenAI tier 1 · strong general" },
    { id: "gpt-4o",            name: "GPT-4o",            desc: "Multimodal · vision-friendly" },
    { id: "gemini-2.5-pro",    name: "Gemini 2.5 Pro",    desc: "Long context · Google tier 1" },
  ];
  const activeModel = models.find(m => m.id === model) || models[0];
  const modes = ["Build", "Plan", "Ask"];
  const modeIcon = (m) => {
    if (m === "Build") return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="2.5" width="4.5" height="4.5"/><rect x="2.5" y="9" width="4.5" height="4.5"/><rect x="9" y="9" width="4.5" height="4.5"/></svg>;
    if (m === "Plan") return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="12" x2="9" y2="12"/></svg>;
    return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5"/><line x1="8" y1="11" x2="8" y2="11.01" strokeWidth="2"/><path d="M6 6.5a2 2 0 1 1 2.5 2c-.5.2-.7.5-.7 1"/></svg>;
  };
  const modeDesc = {
    Build: "Edit code, run tools, ship changes",
    Plan: "Outline approach without executing",
    Ask: "Conversation, no file edits",
  };
  return (
    <div className="composer-wrap">
      <div className="composer-row">
        <div className="composer">
          <div className="comp-row comp-top">
            <button className="icon-btn comp-icon" title="Attach">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M11 5l-5 5a2 2 0 1 0 3 3l5-5a4 4 0 1 0-6-6l-5 5" />
              </svg>
            </button>
            <button className="icon-btn comp-icon" title="Slash command">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <line x1="11" y1="3" x2="5" y2="13" />
              </svg>
            </button>
            <button className="icon-btn comp-icon" title="Mission Control" onClick={onMission}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="8" cy="8" r="5.5" /><line x1="8" y1="2.5" x2="8" y2="5" /><line x1="8" y1="11" x2="8" y2="13.5" />
                <line x1="2.5" y1="8" x2="5" y2="8" /><line x1="11" y1="8" x2="13.5" y2="8" />
              </svg>
            </button>
            <textarea
              ref={ref}
              rows={1}
              value={value}
              placeholder="Instruct the agent…  ⌘↩ to send"
              onChange={e => onChange(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onSend(); }
              }}
            />
            <button className="btn-send btn-send-inline" onClick={onSend} disabled={!value.trim()} title="Send (⌘↩)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="13" x2="8" y2="3" /><polyline points="4,7 8,3 12,7" />
              </svg>
            </button>
          </div>
          <div className="comp-row comp-bottom">
            <div className="effort-wrap" ref={modeRef}>
              <button className={`effort-btn mode-btn`} onClick={() => setModeOpen(o => !o)} title="Mode">
                {modeIcon(mode)}
                <span className="ev">{mode}</span>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <polyline points="3,5 6,8 9,5" />
                </svg>
              </button>
              {modeOpen && (
                <div className="effort-menu mode-menu mode-menu-rich">
                  {modes.map(m => (
                    <div key={m} className={`em-item em-mode ${mode === m ? "active" : ""}`} onClick={() => { setMode(m); setModeOpen(false); }}>
                      <span className="em-mode-icon">{modeIcon(m)}</span>
                      <div className="em-mode-text">
                        <div className="em-mode-name">{m}</div>
                        <div className="em-mode-desc">{modeDesc[m]}</div>
                      </div>
                      {mode === m && <span className="em-check">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="effort-wrap" ref={modelRef}>
              <button className={`effort-btn model-btn ${model === "auto" ? "is-auto" : ""}`} onClick={() => setModelOpen(o => !o)} title="Model">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="2.2" /><circle cx="8" cy="8" r="6" opacity="0.45" />
                </svg>
                <span className="ev">{activeModel.name}</span>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <polyline points="3,5 6,8 9,5" />
                </svg>
              </button>
              {modelOpen && (
                <div className="effort-menu mode-menu mode-menu-rich model-menu">
                  {models.map(m => (
                    <div key={m.id} className={`em-item em-mode ${model === m.id ? "active" : ""}`} onClick={() => { setModel(m.id); setModelOpen(false); }}>
                      <span className="em-mode-icon">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <circle cx="8" cy="8" r="2.2" /><circle cx="8" cy="8" r="6" opacity="0.45" />
                        </svg>
                      </span>
                      <div className="em-mode-text">
                        <div className="em-mode-name">{m.name}{m.id === "auto" && <span className="em-mode-pill">Default</span>}</div>
                        <div className="em-mode-desc">{m.desc}</div>
                      </div>
                      {model === m.id && <span className="em-check">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="effort-wrap" ref={effortRef}>
              <button className="effort-btn" onClick={() => setEffortOpen(o => !o)} title="Reasoning effort">
                <span className="el">Effort</span>
                <span className="ev">{effort}</span>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <polyline points="3,5 6,8 9,5" />
                </svg>
              </button>
              {effortOpen && (
                <div className="effort-menu">
                  {efforts.map(e => (
                    <div key={e} className={`em-item ${effort === e ? "active" : ""}`} onClick={() => { setEffort(e); setEffortOpen(false); }}>
                      <span>{e}</span>
                      {effort === e && <span className="em-check">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="effort-wrap" ref={settingsRef}>
              <button className="effort-btn settings-btn" onClick={() => setSettingsOpen(o => !o)} title="Composer settings">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <circle cx="8" cy="8" r="2.4" />
                  <path d="M8 2v1.6 M8 12.4v1.6 M2 8h1.6 M12.4 8h1.6 M3.5 3.5l1.1 1.1 M11.4 11.4l1.1 1.1 M3.5 12.5l1.1-1.1 M11.4 4.6l1.1-1.1" />
                </svg>
                <span className="ev">Settings</span>
              </button>
              {settingsOpen && typeof ComposerSettings === "function" && (
                <ComposerSettings open={true} settings={settings} setSettings={setSettings} onClose={() => setSettingsOpen(false)} />
              )}
            </div>
            <div className="comp-spacer" />
            <div className="comp-hint"><kbd>⌘</kbd><kbd>↩</kbd> send</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Right context pane ---------- */
function ContextPane({ session, tokens }) {
  return (
    <aside className="context">
      <div className="ctx-section">
        <h4>Current Task <span className="ct">{session.task.step}</span></h4>
        <div className="task-card">
          <div className="step">In Progress</div>
          <div className="name">{session.task.name}</div>
          <div className="progress-track"><div className="progress-fill" style={{ width: session.task.pct + "%" }} /></div>
          <div className="progress-meta"><span>{session.task.pct}%</span><span>ETA · 2 min</span></div>
        </div>
      </div>
      <div className="ctx-section">
        <h4>Referenced Files <span className="ct">{String(session.files.length).padStart(2, "0")}</span></h4>
        <div className="files-list">
          {session.files.length ? session.files.map((f, i) => (
            <div className={`file ${f.dim ? "dim" : ""}`} key={i}>
              <div className="glyph">{f.glyph}</div>
              <div className="path">{f.path}</div>
              {f.tag === "active" && <div className="tag active">Active</div>}
              {f.tag === "diff" && <div className="tag diff">+ Diff</div>}
            </div>
          )) : <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-3)", fontSize: 14 }}>No files referenced.</div>}
        </div>
      </div>
      <div className="ctx-section">
        <h4>Environment</h4>
        {session.env.length ? session.env.map(([k, v]) => (
          <div className="env-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
        )) : <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-3)", fontSize: 14 }}>—</div>}
      </div>
      <div className="ctx-section">
        <h4>Providers</h4>
        {PROVIDERS.map(p => (
          <div className="provider" key={p.name}>
            <span className={`dot ${p.status === "live" ? "live" : ""}`}></span>
            <span className="nm">{p.name}</span>
            <span className="lat">{p.lat}</span>
          </div>
        ))}
      </div>
      <div className="ctx-section" style={{ borderBottom: 0 }}>
        <h4>Session Telemetry</h4>
        <div className="env-row"><span className="k">Tokens</span><span className="v">{tokens.toLocaleString()}</span></div>
        <div className="env-row"><span className="k">Tool calls</span><span className="v">12</span></div>
        <div className="env-row"><span className="k">Approvals</span><span className="v">2 / 2</span></div>
        <div className="env-row"><span className="k">Latency p50</span><span className="v">1.4 s</span></div>
      </div>
    </aside>
  );
}

/* ---------- Command palette ---------- */
function Palette({ open, onClose, onAction, sessions, onSelect }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);
  const items = useMemo(() => {
    const cmds = [
      { kind: "cmd", id: "new",     ic: "+",  nm: "New Session", sub: "Start a fresh editorial draft", kbd: "⌘ N" },
      { kind: "cmd", id: "plan",    ic: "▢",  nm: "Plan Mode",   sub: "Coordinator drafts before any tool runs", kbd: "⌘ ⇧ P" },
      { kind: "cmd", id: "doctor",  ic: "✚",  nm: "Run Doctor",  sub: "Diagnose runtime + provider health", kbd: "" },
      { kind: "cmd", id: "mcp",     ic: "≡",  nm: "MCP List",    sub: "Inspect connected MCP servers", kbd: "" },
      { kind: "cmd", id: "providers", ic: "◇", nm: "Provider Login", sub: "Refresh credentials", kbd: "" },
    ];
    const ses = sessions.map(s => ({ kind: "ses", id: s.id, ic: s.glyph, nm: s.name, sub: `${s.project} · ${s.branch}`, kbd: "" }));
    const all = [...cmds, ...ses];
    if (!q) return all;
    const lq = q.toLowerCase();
    return all.filter(i => (i.nm + i.sub).toLowerCase().includes(lq));
  }, [q, sessions]);
  useEffect(() => { setSel(0); }, [q]);
  if (!open) return null;
  const fire = (it) => {
    if (it.kind === "ses") onSelect(it.id);
    else onAction(it.id);
    onClose();
  };
  const cmds = items.filter(i => i.kind === "cmd");
  const ses = items.filter(i => i.kind === "ses");
  let idx = -1;
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal>
        <div className="p-head">
          <span className="lab">⌘ K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Type a command, search a session…"
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); }
              if (e.key === "ArrowUp")   { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
              if (e.key === "Enter")     { e.preventDefault(); items[sel] && fire(items[sel]); }
              if (e.key === "Escape")    { onClose(); }
            }}
          />
        </div>
        <div className="p-list">
          {cmds.length > 0 && <div className="p-section">Commands</div>}
          {cmds.map(it => { idx++; const i = idx; return (
            <div key={it.id} className={`p-item ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => fire(it)}>
              <div className="ic">{it.ic}</div>
              <div className="nm">{it.nm}<small>{it.sub}</small></div>
              <div className="kbd">{it.kbd || "↵"}</div>
            </div>
          ); })}
          {ses.length > 0 && <div className="p-section">Sessions</div>}
          {ses.map(it => { idx++; const i = idx; return (
            <div key={it.id} className={`p-item ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => fire(it)}>
              <div className="ic">{it.ic}</div>
              <div className="nm">{it.nm}<small>{it.sub}</small></div>
              <div className="kbd">↵</div>
            </div>
          ); })}
        </div>
      </div>
    </div>
  );
}

/* ---------- App root ---------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "regular",
  "fontScale": 1,
  "showMonologue": true,
  "showProviders": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = (typeof useTweaks === "function") ? useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const [activeId, setActiveId] = useState("react-auth");
  const [tab, setTab] = useState("Terminal");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("Build");
  const [effort, setEffort] = useState("Medium");
  const [model, setModel] = useState("auto");
  const [composerSettings, setComposerSettings] = useState(window.DEFAULT_COMPOSER_SETTINGS || {});
  const [missionOpen, setMissionOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [extraTurns, setExtraTurns] = useState({}); // { sessionId: [turn, ...] }
  const [streaming, setStreaming] = useState(null);
  const [approvals, setApprovals] = useState({}); // ts -> "allow"/"block"
  const [tokens, setTokens] = useState(8243);

  const [leftW, setLeftW] = useState(280);
  const [rightW, setRightW] = useState(320);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const session = SESSIONS.find(s => s.id === activeId);
  const baseTurns = TRANSCRIPTS[activeId] || [];
  const turns = [...baseTurns, ...(extraTurns[activeId] || [])];

  // Apply tweaks
  useEffect(() => {
    document.documentElement.classList.toggle("dark", tweaks.theme === "dark");
    document.documentElement.style.setProperty("--type-scale", tweaks.fontScale);
  }, [tweaks.theme, tweaks.fontScale]);

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaletteOpen(o => !o);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setMissionOpen(false);
        setPermissionsOpen(false);
        setSystemOpen(false);
        setAdvancedOpen(false);
      }
      // ⌘⇧, opens Advanced Developer Settings
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ",") {
        e.preventDefault(); setAdvancedOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll feed
  const feedRef = useRef(null);
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [turns.length, streaming]);

  const sendMessage = useCallback(() => {
    if (!draft.trim()) return;
    const text = draft;
    setDraft("");
    const ts = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setExtraTurns(prev => ({
      ...prev,
      [activeId]: [...(prev[activeId] || []), { kind: "user", who: "User", sub: "S. Cyi", ts, text }],
    }));
    setTokens(t => t + Math.round(text.length / 3) + 28);
    // simulate agent reasoning + reply
    setTimeout(() => {
      setExtraTurns(prev => ({
        ...prev,
        [activeId]: [...(prev[activeId] || []), {
          kind: "monologue", ts,
          text: "Parsing request. I'll keep the response tight: confirm intent, propose the next concrete step, and offer to run the relevant tool when permission allows.",
        }],
      }));
    }, 350);
    const stream = "Acknowledged. I will treat that as the next directive on this session — drafting the change set now and surfacing any shell commands for your approval before they run.";
    let i = 0;
    const block = { type: "p", text: "" };
    const turnSkeleton = {
      kind: "agent",
      who: `OpenAGt · ${session.model.split("-").slice(1, 3).join("-")}`,
      sub: "Streaming reply",
      ts,
      blocks: [block],
    };
    setTimeout(() => {
      setStreaming(activeId);
      setExtraTurns(prev => ({
        ...prev,
        [activeId]: [...(prev[activeId] || []), turnSkeleton],
      }));
      const interval = setInterval(() => {
        i += 2;
        setExtraTurns(prev => {
          const list = [...(prev[activeId] || [])];
          const last = list[list.length - 1];
          if (last && last.kind === "agent") {
            last.blocks = [{ type: "p", text: stream.slice(0, i) }];
          }
          return { ...prev, [activeId]: list };
        });
        setTokens(t => t + 1);
        if (i >= stream.length) {
          clearInterval(interval);
          setStreaming(null);
        }
      }, 28);
    }, 900);
  }, [draft, activeId, session]);

  const resolveApproval = (ts, decision) => setApprovals(a => ({ ...a, [ts]: decision }));

  const handleAction = (id) => {
    if (id === "new") alert("New session — wired in the demo.");
    if (id === "plan") setMode("Plan");
  };

  const compactClass = tweaks.density === "compact" ? "compact" : "";

  return (
    <>
      <div className="os-stage">
        <div className="os-window">
          <TitleBar
            activeSession={session}
            online={true}
            theme={tweaks.theme}
            onTheme={(v) => setTweak("theme", v)}
            onPalette={() => setPaletteOpen(true)}
            onMission={() => setMissionOpen(true)}
            onPermissions={() => setPermissionsOpen(true)}
            onSystem={() => setSystemOpen(true)}
            pendingApprovals={(window.AGT.PERMISSIONS || []).length}
          />
          <main
            className={`app ${compactClass} ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}
            style={{
              gridTemplateColumns: `${leftCollapsed ? 28 : leftW}px 6px minmax(0,1fr) 6px ${rightCollapsed ? 28 : rightW}px`,
            }}
          >
            <Sidebar sessions={SESSIONS} activeId={activeId} onSelect={setActiveId} onPalette={() => setPaletteOpen(true)} />
            <ResizeHandle
              side="left"
              value={leftW}
              onChange={setLeftW}
              min={220}
              max={420}
              collapsed={leftCollapsed}
              onToggle={() => setLeftCollapsed(c => !c)}
            />
            <section className="center">
              <div className="feed" ref={feedRef}>
                <div className="feed-inner" key={activeId}>
                  {turns.map((t, i) => {
                    if (t.kind === "user")      return <UserTurn key={i} t={t} />;
                    if (t.kind === "monologue") return tweaks.showMonologue ? <MonologueTurn key={i} t={t} /> : null;
                    if (t.kind === "agent")     return <AgentTurn key={i} t={t} streaming={streaming === activeId && i === turns.length - 1} />;
                    if (t.kind === "tool")      return <ToolTurn key={i} t={t} />;
                    if (t.kind === "approval")  return <ApprovalTurn key={i} t={t} resolved={approvals[t.ts]} onResolve={d => resolveApproval(t.ts, d)} />;
                    return null;
                  })}
                </div>
              </div>
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={sendMessage}
                mode={mode}
                setMode={setMode}
                effort={effort}
                setEffort={setEffort}
                model={model}
                setModel={setModel}
                settings={composerSettings}
                setSettings={setComposerSettings}
                onMission={() => setMissionOpen(true)}
              />
            </section>
            <ResizeHandle
              side="right"
              value={rightW}
              onChange={setRightW}
              min={240}
              max={460}
              collapsed={rightCollapsed}
              onToggle={() => setRightCollapsed(c => !c)}
            />
            <ContextPane session={session} tokens={tokens} />
          </main>
        </div>
      </div>
      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessions={SESSIONS}
        onSelect={setActiveId}
        onAction={handleAction}
      />
      {typeof MissionControl === "function" && <MissionControl open={missionOpen} onClose={() => setMissionOpen(false)} />}
      {typeof PermissionCenter === "function" && <PermissionCenter open={permissionsOpen} onClose={() => setPermissionsOpen(false)} />}
      {typeof SystemSettings === "function" && <SystemSettings open={systemOpen} onClose={() => setSystemOpen(false)} theme={tweaks.theme || "light"} onTheme={(v) => setTweak("theme", v)} tweaks={tweaks} setTweak={setTweak} onAdvanced={() => { setSystemOpen(false); setAdvancedOpen(true); }} />}
      {typeof AdvancedSettings === "function" && <AdvancedSettings open={advancedOpen} onClose={() => setAdvancedOpen(false)} theme={tweaks.theme || "light"} onTheme={(v) => setTweak("theme", v)} />}
      <AGTTweaks tweaks={tweaks} setTweak={setTweak} />
    </>
  );
}

/* ---------- Tweaks ---------- */
function AGTTweaks({ tweaks, setTweak }) {
  if (typeof TweaksPanel !== "function") return null;
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" value={tweaks.theme} onChange={v => setTweak("theme", v)} options={["light","dark"]} />
      <TweakSection label="Density" />
      <TweakRadio label="Layout" value={tweaks.density} onChange={v => setTweak("density", v)} options={["regular","compact"]} />
      <TweakSlider label="Type scale" value={Math.round(tweaks.fontScale * 100)} onChange={v => setTweak("fontScale", v / 100)} min={90} max={115} step={1} unit="%" />
      <TweakSection label="Display" />
      <TweakToggle label="Internal monologue" value={tweaks.showMonologue} onChange={v => setTweak("showMonologue", v)} />
      <TweakToggle label="Provider list" value={tweaks.showProviders} onChange={v => setTweak("showProviders", v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
