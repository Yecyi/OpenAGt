/* Mission Control — full-screen takeover with plan-preview, DAG, expert lanes */

function MissionControl({ open, onClose }) {
  const M = window.AGT.MISSION;
  if (!open) return null;
  const [tab, setTab] = React.useState("execution"); // preview | execution | quality

  return (
    <div className="mission-scrim">
      <div className="mission">
        <header className="mc-head">
          <div className="mc-eyebrow">
            <span className="num">№ MC-01</span>
            <span className="lab">Mission Control</span>
            <span className="dim">/ Coordinator runtime</span>
          </div>
          <button className="mc-close" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </header>

        <div className="mc-mast">
          <div className="mc-goal">
            <h1>{M.goal}</h1>
            <div className="mc-goal-meta">
              <span><b>Workflow</b> {M.workflow}</span>
              <span className="sep">·</span>
              <span><b>Effort</b> {M.effort}</span>
              <span className="sep">·</span>
              <span><b>Status</b> <span className={`mc-state ${M.status}`}>{M.status}</span></span>
            </div>
          </div>
          <div className="mc-tabs">
            {["preview","execution","quality"].map(t => (
              <button key={t} className={`mc-tab ${tab===t?"on":""}`} onClick={()=>setTab(t)}>
                {t === "preview" ? "Plan Preview" : t === "execution" ? "Execution" : "Quality"}
              </button>
            ))}
          </div>
        </div>

        <div className="mc-body">
          {tab === "preview"   && <PlanPreview M={M} />}
          {tab === "execution" && <Execution M={M} />}
          {tab === "quality"   && <Quality M={M} />}
        </div>

        <footer className="mc-foot">
          <BudgetMeters b={M.budget} />
          <div className="mc-foot-acts">
            <button className="mc-btn ghost" onClick={onClose}>Close</button>
            <button className="mc-btn">Pause Mission</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ---------- Plan Preview tab ---------- */
function PlanPreview({ M }) {
  return (
    <div className="mc-grid">
      <section className="mc-pane">
        <h3 className="mc-h">Planned Stages</h3>
        <ol className="mc-stages">
          {M.stages.map((s, i) => (
            <li key={s.id} className={`mc-stage ${s.state}`}>
              <span className="num">{String(i+1).padStart(2,"0")}</span>
              <span className="title">{s.title}</span>
              <span className="state">{s.state}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="mc-pane">
        <h3 className="mc-h">Todo Timeline (planned)</h3>
        <ul className="mc-todos">
          {M.todos.map(t => (
            <li key={t.id} className={`mc-todo ${t.state}`}>
              <span className="check">{t.state === "done" ? "✓" : t.state === "active" ? "▶" : "○"}</span>
              <span className="title">{t.title}</span>
              <span className="owner">{t.owner}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mc-pane mc-pane-wide">
        <h3 className="mc-h">Revise Points</h3>
        {M.revisePoints.length ? (
          <ul className="mc-revise">
            {M.revisePoints.map((r, i) => (
              <li key={i}>
                <span className="at">{r.at}</span>
                <span className="reason">{r.reason}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mc-empty">No revise points planned.</p>}
      </section>
    </div>
  );
}

/* ---------- Execution tab ---------- */
function Execution({ M }) {
  return (
    <div className="mc-exec">
      <section className="mc-pane mc-dag-pane">
        <h3 className="mc-h">DAG · Live</h3>
        <DAG dag={M.dag} />
      </section>
      <section className="mc-pane">
        <h3 className="mc-h">Expert Lanes <span className="ct">{M.experts.length}</span></h3>
        <div className="mc-lanes">
          {M.experts.map(e => <ExpertLane key={e.id} e={e} />)}
        </div>
      </section>
    </div>
  );
}

function DAG({ dag }) {
  // grid: laneCount × xCount
  const laneCount = Math.max(...dag.nodes.map(n => n.lane)) + 1;
  const xCount    = Math.max(...dag.nodes.map(n => n.x))    + 1;
  const W = 760, H = laneCount * 70 + 30;
  const colW = W / xCount;
  const pos = (id) => {
    const n = dag.nodes.find(n => n.id === id);
    return { cx: n.x * colW + colW/2, cy: n.lane * 70 + 35 };
  };
  return (
    <svg className="mc-dag" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {/* edges */}
      {dag.edges.map(([a,b], i) => {
        const A = pos(a), B = pos(b);
        const mx = (A.cx + B.cx) / 2;
        return (
          <path key={i}
            d={`M ${A.cx + 50} ${A.cy} C ${mx} ${A.cy}, ${mx} ${B.cy}, ${B.cx - 50} ${B.cy}`}
            fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.45" />
        );
      })}
      {/* nodes */}
      {dag.nodes.map(n => {
        const p = pos(n.id);
        return (
          <g key={n.id} transform={`translate(${p.cx - 50}, ${p.cy - 18})`}>
            <rect width="100" height="36" className={`dag-node ${n.state}`} />
            <text x="50" y="22" textAnchor="middle" className="dag-label">{n.label}</text>
            <circle cx="6" cy="6" r="2.6" className={`dag-dot ${n.state}`} />
          </g>
        );
      })}
    </svg>
  );
}

function ExpertLane({ e }) {
  return (
    <div className={`mc-expert ${e.state}`}>
      <div className="mce-head">
        <span className="role">{e.role}</span>
        <span className={`state ${e.state}`}>{e.state}</span>
      </div>
      <div className="mce-row">
        <span className="k">Tool</span>
        <span className="v mono">{e.tool}</span>
      </div>
      <div className="mce-row">
        <span className="k">Scope</span>
        <span className="v">{e.scope.join(" · ")}</span>
      </div>
      <div className="mce-row">
        <span className="k">Steps</span>
        <span className="v mono">{e.steps}</span>
        <span className="k right">Elapsed</span>
        <span className="v mono">{e.elapsed}</span>
      </div>
      <div className="mce-row">
        <span className="k">Confidence</span>
        <span className={`v conf ${e.conf}`}>{e.conf}</span>
      </div>
      {e.ev.length > 0 && <div className="mce-tags">{e.ev.map((x,i) => <span key={i} className="tag ev">{x}</span>)}</div>}
      {e.risks.length > 0 && <div className="mce-tags">{e.risks.map((x,i) => <span key={i} className="tag risk">⚠ {x}</span>)}</div>}
    </div>
  );
}

/* ---------- Quality tab ---------- */
function Quality({ M }) {
  return (
    <div className="mc-grid">
      <section className="mc-pane">
        <h3 className="mc-h">Quality Gates</h3>
        <ul className="mc-gates">
          {M.qualityGates.map(g => (
            <li key={g.id} className={g.state}>
              <span className="check">{g.state === "passed" ? "✓" : g.state === "failed" ? "✗" : "○"}</span>
              <span className="title">{g.name}</span>
              <span className="state">{g.state}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mc-pane">
        <h3 className="mc-h">Evidence</h3>
        <div className="env-row"><span className="k">Coverage</span><span className="v">{M.evidence.coverage}</span></div>
        <div className="env-row"><span className="k">Confidence</span><span className="v">{M.evidence.confidence}</span></div>
        <div className="env-row"><span className="k">Review</span><span className="v">{M.evidence.review}</span></div>
      </section>
      <section className="mc-pane mc-pane-wide">
        <h3 className="mc-h">Critical Review · Pending</h3>
        <p className="mc-empty">Reviewer will run after Verifier passes the quality gates.</p>
      </section>
    </div>
  );
}

/* ---------- Budget meters ---------- */
function BudgetMeters({ b }) {
  const items = [
    { k: "Tool calls",   ...b.tools  },
    { k: "Model calls",  ...b.calls  },
    { k: "Wallclock",    ...b.wall, unit: "m" },
    { k: "Tokens",       ...b.tokens },
  ];
  return (
    <div className="mc-budget">
      {items.map(it => {
        const pct = Math.min(100, (it.used / it.max) * 100);
        return (
          <div className="mcb-item" key={it.k}>
            <div className="mcb-lab">{it.k}</div>
            <div className="mcb-bar"><div className="mcb-fill" style={{ width: pct + "%" }} /></div>
            <div className="mcb-val">{it.used.toLocaleString()}{it.unit||""} / {it.max.toLocaleString()}{it.unit||""}</div>
          </div>
        );
      })}
    </div>
  );
}

window.MissionControl = MissionControl;
