/* Permission Center — queue of pending approvals with structured safety details */

function PermissionCenter({ open, onClose }) {
  if (!open) return null;
  const initial = window.AGT.PERMISSIONS;
  const [queue, setQueue] = React.useState(initial);
  const [selectedId, setSelectedId] = React.useState(initial[0]?.id);
  const [resolved, setResolved] = React.useState({}); // id -> "allow"|"always"|"block"
  const [history, setHistory] = React.useState([
    { id: "h1", title: "read_file src/App.jsx",       decision: "allow",  at: "14:02:14", by: "auto" },
    { id: "h2", title: "Network egress to anthropic", decision: "always", at: "14:01:48", by: "user" },
    { id: "h3", title: "rm -rf dist (workspace)",     decision: "block",  at: "13:58:01", by: "user" },
  ]);

  const sel = queue.find(p => p.id === selectedId) || queue[0];

  const decide = (id, decision) => {
    setResolved(r => ({ ...r, [id]: decision }));
    setTimeout(() => {
      setQueue(q => q.filter(x => x.id !== id));
      const item = initial.find(x => x.id === id);
      if (item) setHistory(h => [{ id: "h-"+id, title: item.summary, decision, at: item.at, by: "user" }, ...h]);
      setSelectedId(prev => {
        const remaining = queue.filter(x => x.id !== id);
        return remaining[0]?.id;
      });
    }, 320);
  };

  return (
    <div className="pc-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc">
        <header className="pc-head">
          <div className="pc-eyebrow">
            <span className="num">№ PC-01</span>
            <span className="lab">Permission Center</span>
            <span className="dim">/ Safety queue</span>
          </div>
          <button className="mc-close" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </header>

        <div className="pc-body">
          <aside className="pc-queue">
            <h3 className="pc-h">Pending <span className="ct">{queue.length}</span></h3>
            {queue.length === 0 && <div className="pc-empty">No pending approvals.</div>}
            {queue.map(p => (
              <div key={p.id}
                   className={`pc-q ${selectedId===p.id?"on":""} ${resolved[p.id]?"resolved-"+resolved[p.id]:""}`}
                   onClick={() => setSelectedId(p.id)}>
                <div className="pc-q-top">
                  <span className={`risk ${p.risk}`}>{p.risk}</span>
                  <span className="kind">{p.kind.replace(/_/g," ")}</span>
                </div>
                <div className="pc-q-title">{p.title}</div>
                <div className="pc-q-sum">{p.summary}</div>
                <div className="pc-q-meta">
                  <span>{p.requestedBy}</span>
                  <span className="dot">·</span>
                  <span>{p.at}</span>
                </div>
              </div>
            ))}

            <h3 className="pc-h" style={{marginTop:24}}>Audit · Recent</h3>
            {history.map(h => (
              <div key={h.id} className={`pc-hist ${h.decision}`}>
                <span className={`pill ${h.decision}`}>{h.decision}</span>
                <span className="title">{h.title}</span>
                <span className="at">{h.at}</span>
              </div>
            ))}
          </aside>

          <section className="pc-detail">
            {sel ? <PermissionDetail p={sel} resolved={resolved[sel.id]} onDecide={decide} /> : (
              <div className="pc-empty pc-empty-large">
                <div className="num">— —</div>
                <div className="t">Queue clear</div>
                <div className="s">No agent is awaiting your decision.</div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PermissionDetail({ p, resolved, onDecide }) {
  return (
    <div className="pcd">
      <div className="pcd-head">
        <div className={`pcd-risk ${p.risk}`}>{p.risk} risk</div>
        <h2 className="pcd-title">{p.title}</h2>
        <div className="pcd-cmd">{p.summary}</div>
      </div>

      <div className="pcd-grid">
        <div className="pcd-block">
          <div className="pcd-lab">Why this is gated</div>
          <p className="pcd-p">{p.why}</p>
        </div>
        <div className="pcd-block">
          <div className="pcd-lab">Approval kind</div>
          <p className="pcd-p mono">{p.kind}</p>
        </div>
        <div className="pcd-block">
          <div className="pcd-lab">Policy reason</div>
          <p className="pcd-p mono">{p.policy}</p>
        </div>
        <div className="pcd-block">
          <div className="pcd-lab">Retryable without escalation?</div>
          <p className="pcd-p">{p.retryable ? "Yes — agent may retry under a softer rule." : "No — this requires explicit operator decision."}</p>
        </div>

        <div className="pcd-block pcd-wide">
          <div className="pcd-lab">Boundary being crossed</div>
          <div className="pcd-bound">
            <div><span className="k">Sandbox</span><span className="v">{p.boundary.sandbox}</span></div>
            <div><span className="k">Filesystem</span><span className="v">{p.boundary.filesystem}</span></div>
            <div><span className="k">Network</span><span className="v">{p.boundary.network}</span></div>
          </div>
        </div>

        <div className="pcd-block pcd-wide">
          <div className="pcd-lab">Matched rules</div>
          <div className="pcd-rules">
            {p.matched.map(r => <span key={r} className="rule">{r}</span>)}
          </div>
        </div>

        <div className="pcd-block pcd-wide">
          <div className="pcd-lab">Requested by</div>
          <p className="pcd-p"><span className="mono">{p.requestedBy}</span> on session <span className="mono">{p.sessionId}</span> at <span className="mono">{p.at}</span></p>
        </div>
      </div>

      <div className="pcd-acts">
        {resolved ? (
          <span className={`pcd-resolved ${resolved}`}>{resolved === "allow" ? "✓ Allowed once" : resolved === "always" ? "✓ Always allowed" : "✗ Blocked"}</span>
        ) : (
          <>
            <button className="pcd-btn block" onClick={() => onDecide(p.id, "block")}>
              <span className="lab">Block</span>
              <span className="hint">Deny and remember</span>
            </button>
            <button className="pcd-btn once" onClick={() => onDecide(p.id, "allow")}>
              <span className="lab">Allow Once</span>
              <span className="hint">Just this call</span>
            </button>
            <button className="pcd-btn always" onClick={() => onDecide(p.id, "always")}>
              <span className="lab">Allow Always</span>
              <span className="hint">Add rule for this scope</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

window.PermissionCenter = PermissionCenter;
