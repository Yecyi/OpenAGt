/* Composer Settings — drawer with workflow, budget, auto-continue, reviewer, max parallel/wallclock/rounds */

const WORKFLOWS = [
  { id: "coding",          name: "Coding",                desc: "Implement, refactor, debug" },
  { id: "research",        name: "Research",              desc: "Gather + synthesize evidence" },
  { id: "writing",         name: "Writing",               desc: "Long-form prose + edits" },
  { id: "data-analysis",   name: "Data Analysis",         desc: "Profile, transform, summarize" },
  { id: "planning",        name: "Planning",              desc: "Decompose goals into stages" },
  { id: "personal-admin",  name: "Personal Admin",        desc: "Inbox, email, scheduling" },
  { id: "automation",      name: "Automation",            desc: "Recurring scripted tasks" },
  { id: "documentation",   name: "Documentation",         desc: "API + repo docs" },
  { id: "environment",     name: "Environment Audit",     desc: "Inspect runtimes + configs" },
  { id: "organization",    name: "File / Data Org",       desc: "Organize, dedupe, rename" },
  { id: "general",         name: "General",               desc: "Mixed or unspecified" },
];

const BUDGETS = [
  { id: "tight",   name: "Tight",   desc: "8 calls · 5 min · 8k tokens" },
  { id: "default", name: "Default", desc: "40 calls · 25 min · 30k tokens" },
  { id: "ample",   name: "Ample",   desc: "120 calls · 60 min · 80k tokens" },
  { id: "deep",    name: "Deep",    desc: "240 calls · 120 min · 200k tokens" },
];

const REVIEWERS = [
  "claude-haiku-4-5",
  "claude-sonnet-4.5",
  "claude-opus-4",
  "gpt-4o-mini",
  "off",
];

function ComposerSettings({ open, settings, setSettings, onClose }) {
  if (!open) return null;
  const update = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const wf = WORKFLOWS.find(w => w.id === settings.workflow) || WORKFLOWS[0];
  const bd = BUDGETS.find(b => b.id === settings.budget) || BUDGETS[1];

  return (
    <div className="cs-pop" onMouseDown={e => e.stopPropagation()}>
      <header className="cs-head">
        <div className="cs-eyebrow">Composer · Advanced</div>
        <button className="mc-close" onClick={onClose} title="Close">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      </header>
      <div className="cs-body">
        <div className="cs-row">
          <label className="cs-k">Workflow</label>
          <div className="cs-v">
            <select value={settings.workflow} onChange={e => update("workflow", e.target.value)}>
              {WORKFLOWS.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <div className="cs-hint">{wf.desc}</div>
          </div>
        </div>
        <div className="cs-row">
          <label className="cs-k">Budget</label>
          <div className="cs-v">
            <div className="cs-segs">
              {BUDGETS.map(b => (
                <button key={b.id} className={`cs-seg ${settings.budget===b.id?"on":""}`} onClick={() => update("budget", b.id)}>{b.name}</button>
              ))}
            </div>
            <div className="cs-hint">{bd.desc}</div>
          </div>
        </div>
        <div className="cs-row">
          <label className="cs-k">Auto-continue</label>
          <div className="cs-v">
            <button className={`cs-toggle ${settings.autoContinue?"on":""}`} onClick={() => update("autoContinue", !settings.autoContinue)}>
              <span className="dot"></span>
              <span className="t">{settings.autoContinue ? "On" : "Off"}</span>
            </button>
            <div className="cs-hint">Pick up the next planned todo without waiting for input.</div>
          </div>
        </div>
        <div className="cs-row">
          <label className="cs-k">Reviewer model</label>
          <div className="cs-v">
            <select value={settings.reviewer} onChange={e => update("reviewer", e.target.value)}>
              {REVIEWERS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="cs-hint">Runs the critical-review pass after the verifier.</div>
          </div>
        </div>
        <div className="cs-row">
          <label className="cs-k">Max parallel agents</label>
          <div className="cs-v cs-numrow">
            <Stepper value={settings.maxParallel} onChange={v => update("maxParallel", v)} min={1} max={12} />
            <div className="cs-hint">Concurrent experts the coordinator may dispatch.</div>
          </div>
        </div>
        <div className="cs-row">
          <label className="cs-k">Max wallclock</label>
          <div className="cs-v cs-numrow">
            <Stepper value={settings.maxWall} onChange={v => update("maxWall", v)} min={5} max={240} step={5} unit="min" />
            <div className="cs-hint">Hard ceiling before forced checkpoint.</div>
          </div>
        </div>
        <div className="cs-row">
          <label className="cs-k">Max rounds</label>
          <div className="cs-v cs-numrow">
            <Stepper value={settings.maxRounds} onChange={v => update("maxRounds", v)} min={1} max={20} />
            <div className="cs-hint">Plan → execute → reduce loops permitted.</div>
          </div>
        </div>
      </div>
      <footer className="cs-foot">
        <button className="mc-btn ghost" onClick={() => setSettings(DEFAULT_COMPOSER_SETTINGS)}>Reset</button>
        <button className="mc-btn" onClick={onClose}>Done</button>
      </footer>
    </div>
  );
}

function Stepper({ value, onChange, min=0, max=99, step=1, unit }) {
  return (
    <div className="cs-stepper">
      <button onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span className="v">{value}{unit ? <small>{unit}</small> : null}</span>
      <button onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

const DEFAULT_COMPOSER_SETTINGS = {
  workflow: "coding",
  budget: "default",
  autoContinue: false,
  reviewer: "claude-haiku-4-5",
  maxParallel: 4,
  maxWall: 25,
  maxRounds: 6,
};

window.ComposerSettings = ComposerSettings;
window.DEFAULT_COMPOSER_SETTINGS = DEFAULT_COMPOSER_SETTINGS;
window.WORKFLOWS = WORKFLOWS;
