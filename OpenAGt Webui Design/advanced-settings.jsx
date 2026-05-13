/* Advanced Developer Settings — FigJam-style runtime workflow board.
   The settings ARE the graph: stages, tools, agents, sandbox rules are nodes.
   Wires between them are routing/handoff edges. Inspector edits the selected node.
*/

const NODE_W = 220
const NODE_H_BASE = 96

/* ---------- Initial workflow (loaded on first open) ---------- */
const INITIAL_NODES = [
  // Column 1 — Input
  {
    id: "n_input",
    kind: "input",
    x: 60,
    y: 120,
    title: "User input",
    sub: "message · files · paste",
    knobs: { roots: ["~/code/openagt"], svgAsText: true, pasteSummary: true },
  },
  // Column 2 — Routing
  {
    id: "n_router",
    kind: "router",
    x: 340,
    y: 100,
    title: "Router",
    sub: "auto · effort-aware",
    knobs: { effort: "medium", model: "claude-sonnet-4.5", small: "claude-haiku-4-5" },
  },
  // Column 3 — Primary agent
  {
    id: "n_primary",
    kind: "agent",
    x: 640,
    y: 60,
    title: "primary",
    sub: "coordinator · sonnet-4.5",
    knobs: { steps: 28, temp: 1.0, color: "#0d0d0d" },
  },
  // Column 4 — Tools fan-out
  {
    id: "n_read",
    kind: "tool",
    x: 960,
    y: -40,
    title: "read()",
    sub: "low risk",
    knobs: { enabled: true, scope: "all" },
  },
  {
    id: "n_edit",
    kind: "tool",
    x: 960,
    y: 60,
    title: "edit()",
    sub: "med risk",
    knobs: { enabled: true, scope: "all" },
  },
  {
    id: "n_bash",
    kind: "tool",
    x: 960,
    y: 160,
    title: "bash()",
    sub: "high · sandboxed",
    knobs: { enabled: true, scope: "all" },
  },
  {
    id: "n_task",
    kind: "tool",
    x: 960,
    y: 260,
    title: "task()",
    sub: "spawn subagents",
    knobs: { enabled: true, scope: "primary-only" },
  },
  // Column 5 — Sandbox
  {
    id: "n_sandbox",
    kind: "sandbox",
    x: 1280,
    y: 140,
    title: "Sandbox",
    sub: "seatbelt · enforced",
    knobs: { backend: "auto", network: "deny", brokerTtl: 300 },
  },
  // Column 6 — Subagents (called via task)
  {
    id: "n_research",
    kind: "agent",
    x: 1280,
    y: 320,
    title: "researcher",
    sub: "subagent · read-only",
    knobs: { steps: 18, temp: 0.7, color: "#3b5d6a" },
  },
  {
    id: "n_writer",
    kind: "agent",
    x: 1280,
    y: 440,
    title: "code-writer",
    sub: "subagent · scoped writes",
    knobs: { steps: 22, temp: 0.4, color: "#3a5a3a" },
  },
  // Column 7 — Feedback gate
  {
    id: "n_perm",
    kind: "feedback",
    x: 1600,
    y: 220,
    title: "Permission gate",
    sub: "ask · correctable",
    knobs: { defaultAction: "ask", continueOnDeny: false, allowCorrection: true },
  },
  // Column 8 — Output
  {
    id: "n_output",
    kind: "output",
    x: 1900,
    y: 240,
    title: "Output stream",
    sub: "reply · events · patches",
    knobs: { showReasoning: true, expandTools: true, eventReplay: true },
  },
]

const INITIAL_EDGES = [
  { id: "e1", from: "n_input", to: "n_router", kind: "data" },
  { id: "e2", from: "n_router", to: "n_primary", kind: "route", label: "auto" },
  { id: "e3", from: "n_primary", to: "n_read", kind: "tool" },
  { id: "e4", from: "n_primary", to: "n_edit", kind: "tool" },
  { id: "e5", from: "n_primary", to: "n_bash", kind: "tool" },
  { id: "e6", from: "n_primary", to: "n_task", kind: "tool" },
  { id: "e7", from: "n_bash", to: "n_sandbox", kind: "gate", label: "exec" },
  { id: "e8", from: "n_task", to: "n_research", kind: "spawn" },
  { id: "e9", from: "n_task", to: "n_writer", kind: "spawn" },
  { id: "e10", from: "n_edit", to: "n_perm", kind: "gate", label: "approve" },
  { id: "e11", from: "n_writer", to: "n_perm", kind: "gate" },
  { id: "e12", from: "n_sandbox", to: "n_perm", kind: "gate" },
  { id: "e13", from: "n_perm", to: "n_output", kind: "data" },
  { id: "e14", from: "n_research", to: "n_primary", kind: "return", label: "result" },
]

const NODE_KIND_META = {
  input: { label: "Input", glyph: "▤", accent: "#3b5d6a" },
  router: { label: "Router", glyph: "◇", accent: "#7a3b2e" },
  agent: { label: "Agent", glyph: "◉", accent: "#0d0d0d" },
  tool: { label: "Tool", glyph: "▷", accent: "#3a5a3a" },
  sandbox: { label: "Sandbox", glyph: "▦", accent: "#6a4a1a" },
  feedback: { label: "Permission", glyph: "▲", accent: "#7a3b2e" },
  output: { label: "Output", glyph: "▶", accent: "#0d0d0d" },
}

/* ---------- Stencil — what users can drag onto the board ---------- */
const STENCIL = [
  { kind: "agent", title: "New agent", sub: "Subagent · custom" },
  { kind: "tool", title: "Custom tool", sub: "Built-in or MCP" },
  { kind: "router", title: "Conditional", sub: "If · then route" },
  { kind: "sandbox", title: "Sandbox lane", sub: "Per-tool scope" },
  { kind: "feedback", title: "Approval step", sub: "Permission gate" },
  { kind: "input", title: "Context source", sub: "Folder · MCP feed" },
  { kind: "output", title: "Output channel", sub: "Reply · event sink" },
]

function AdvancedSettings({ open, onClose }) {
  const [nodes, setNodes] = React.useState(INITIAL_NODES)
  const [edges, setEdges] = React.useState(INITIAL_EDGES)
  const [selectedId, setSelectedId] = React.useState("n_primary")
  const [view, setView] = React.useState({ x: -20, y: -20, k: 0.62 })
  const [drag, setDrag] = React.useState(null) // { mode, ... }
  const [linking, setLinking] = React.useState(null) // { fromId, x, y }
  const [hoverPort, setHoverPort] = React.useState(null)
  const [showGrid, setShowGrid] = React.useState(true)
  const [snap, setSnap] = React.useState(true)
  const [tool, setTool] = React.useState("select") // select | pan | connect
  const boardRef = React.useRef(null)
  const [dirty, setDirty] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (linking) setLinking(null)
        else onClose()
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedId &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        deleteNode(selectedId)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose, linking, selectedId])

  const screenToBoard = (sx, sy) => {
    const r = boardRef.current.getBoundingClientRect()
    return { x: (sx - r.left - view.x) / view.k, y: (sy - r.top - view.y) / view.k }
  }

  /* ---------- Pan / zoom ---------- */
  const onWheel = (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const r = boardRef.current.getBoundingClientRect()
      const px = e.clientX - r.left,
        py = e.clientY - r.top
      const k1 = Math.max(0.25, Math.min(2.2, view.k * (1 - e.deltaY * 0.0015)))
      const x1 = px - (px - view.x) * (k1 / view.k)
      const y1 = py - (py - view.y) * (k1 / view.k)
      setView({ x: x1, y: y1, k: k1 })
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
  }

  /* ---------- Board mousedown — pan or marquee ---------- */
  const onBoardMouseDown = (e) => {
    if (e.button !== 0) return
    if (linking) {
      setLinking(null)
      return
    }
    if (
      e.target === boardRef.current ||
      e.target.classList.contains("adv2-bg") ||
      e.target.classList.contains("adv2-grid")
    ) {
      setSelectedId(null)
      const sx = e.clientX,
        sy = e.clientY
      const startView = { ...view }
      const move = (ev) => {
        setView({ x: startView.x + (ev.clientX - sx), y: startView.y + (ev.clientY - sy), k: startView.k })
      }
      const up = () => {
        window.removeEventListener("mousemove", move)
        window.removeEventListener("mouseup", up)
      }
      window.addEventListener("mousemove", move)
      window.addEventListener("mouseup", up)
    }
  }

  /* ---------- Node drag ---------- */
  const onNodeMouseDown = (e, nodeId) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelectedId(nodeId)
    const node = nodes.find((n) => n.id === nodeId)
    const sx = e.clientX,
      sy = e.clientY
    const startX = node.x,
      startY = node.y
    let moved = false
    const move = (ev) => {
      const dx = (ev.clientX - sx) / view.k
      const dy = (ev.clientY - sy) / view.k
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return
      moved = true
      let nx = startX + dx,
        ny = startY + dy
      if (snap) {
        nx = Math.round(nx / 20) * 20
        ny = Math.round(ny / 20) * 20
      }
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, x: nx, y: ny } : n)))
      setDirty(true)
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }

  /* ---------- Linking ---------- */
  const onPortMouseDown = (e, nodeId, side) => {
    e.stopPropagation()
    if (side !== "out") return
    const node = nodes.find((n) => n.id === nodeId)
    setLinking({ fromId: nodeId, x: node.x + NODE_W, y: node.y + 36 })
    const move = (ev) => {
      const p = screenToBoard(ev.clientX, ev.clientY)
      setLinking((l) => (l ? { ...l, x: p.x, y: p.y } : null))
    }
    const up = (ev) => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      const target = document.elementFromPoint(ev.clientX, ev.clientY)
      const port = target?.closest("[data-port-in]")
      if (port) {
        const toId = port.getAttribute("data-port-in")
        if (toId !== nodeId && !edges.find((x) => x.from === nodeId && x.to === toId)) {
          setEdges((es) => [...es, { id: "e" + Date.now(), from: nodeId, to: toId, kind: "data" }])
          setDirty(true)
        }
      }
      setLinking(null)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }

  /* ---------- Stencil drop ---------- */
  const onStencilDragStart = (e, kind) => {
    e.dataTransfer.setData("kind", kind)
    e.dataTransfer.effectAllowed = "copy"
  }
  const onBoardDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }
  const onBoardDrop = (e) => {
    e.preventDefault()
    const kind = e.dataTransfer.getData("kind")
    if (!kind) return
    const p = screenToBoard(e.clientX, e.clientY)
    const id = "n_" + Date.now()
    const meta = NODE_KIND_META[kind] || NODE_KIND_META.tool
    setNodes((ns) => [
      ...ns,
      {
        id,
        kind,
        x: p.x - NODE_W / 2,
        y: p.y - NODE_H_BASE / 2,
        title: "Untitled " + meta.label.toLowerCase(),
        sub: "Click to configure",
        knobs: {},
      },
    ])
    setSelectedId(id)
    setDirty(true)
  }

  const updateNode = (id, patch) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, ...patch, knobs: { ...n.knobs, ...(patch.knobs || {}) } } : n)),
    )
    setDirty(true)
  }
  const deleteNode = (id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id))
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id))
    setSelectedId(null)
    setDirty(true)
  }
  const deleteEdge = (id) => {
    setEdges((es) => es.filter((e) => e.id !== id))
    setDirty(true)
  }

  const reset = () => {
    setNodes(INITIAL_NODES)
    setEdges(INITIAL_EDGES)
    setSelectedId("n_primary")
    setDirty(false)
    setView({ x: -20, y: -20, k: 0.62 })
  }
  const fit = () => setView({ x: -20, y: -20, k: 0.62 })

  if (!open) return null
  const selected = nodes.find((n) => n.id === selectedId)

  return (
    <div
      className="adv2-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="adv2" onMouseDown={(e) => e.stopPropagation()}>
        {/* ---------- Top toolbar ---------- */}
        <header className="adv2-bar">
          <div className="adv2-bar-left">
            <span className="adv2-eyebrow">№ DS-17</span>
            <span className="adv2-title">Workflow Studio</span>
            <span className="adv2-sub">/ runtime graph · figjam-style</span>
          </div>
          <div className="adv2-bar-tools">
            <div className="adv2-toolgrp">
              <button
                className={`adv2-tool ${tool === "select" ? "on" : ""}`}
                onClick={() => setTool("select")}
                title="Select (V)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 2l9 5-4 1-1 4-4-10z" />
                </svg>
              </button>
              <button
                className={`adv2-tool ${tool === "pan" ? "on" : ""}`}
                onClick={() => setTool("pan")}
                title="Pan (H)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M5 8V4a1 1 0 0 1 2 0v3.5M7 7.5V3a1 1 0 0 1 2 0v4.5M9 7.5V4a1 1 0 0 1 2 0v4M11 8V5.5a1 1 0 0 1 2 0V11a3 3 0 0 1-3 3H7a3 3 0 0 1-2.5-1.3L3 10" />
                </svg>
              </button>
              <button
                className={`adv2-tool ${tool === "connect" ? "on" : ""}`}
                onClick={() => setTool("connect")}
                title="Connect (C)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="3.5" cy="8" r="1.5" />
                  <circle cx="12.5" cy="8" r="1.5" />
                  <line x1="5" y1="8" x2="11" y2="8" />
                </svg>
              </button>
            </div>
            <div className="adv2-toolgrp">
              <button
                className="adv2-tool"
                onClick={() => setView((v) => ({ ...v, k: Math.min(2.2, v.k * 1.15) }))}
                title="Zoom in"
              >
                +
              </button>
              <button className="adv2-tool" onClick={fit} title="Fit board">
                {Math.round(view.k * 100)}%
              </button>
              <button
                className="adv2-tool"
                onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k * 0.87) }))}
                title="Zoom out"
              >
                −
              </button>
            </div>
            <div className="adv2-toolgrp">
              <button
                className={`adv2-tool ${showGrid ? "on" : ""}`}
                onClick={() => setShowGrid((g) => !g)}
                title="Toggle grid"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12" />
                </svg>
              </button>
              <button
                className={`adv2-tool ${snap ? "on" : ""}`}
                onClick={() => setSnap((s) => !s)}
                title="Snap to grid"
              >
                snap
              </button>
            </div>
          </div>
          <div className="adv2-bar-right">
            {dirty && (
              <span className="adv2-dirty">
                <span className="d"></span>Unsaved
              </span>
            )}
            <button className="adv2-mini ghost" onClick={reset}>
              Reset workflow
            </button>
            <button
              className="adv2-mini"
              onClick={() => {
                setDirty(false)
              }}
              disabled={!dirty}
            >
              Apply
            </button>
            <button className="adv2-close" onClick={onClose} title="Close (Esc)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <line x1="3" y1="3" x2="13" y2="13" />
                <line x1="13" y1="3" x2="3" y2="13" />
              </svg>
            </button>
          </div>
        </header>

        {/* ---------- Body ---------- */}
        <div className="adv2-body">
          {/* Stencil rail */}
          <aside className="adv2-stencil">
            <div className="adv2-rail-h">Stencil</div>
            <div className="adv2-rail-sub">Drag onto the canvas</div>
            <div className="adv2-stencil-list">
              {STENCIL.map((s) => {
                const meta = NODE_KIND_META[s.kind]
                return (
                  <div
                    key={s.kind + s.title}
                    className={`adv2-sten adv2-k-${s.kind}`}
                    draggable
                    onDragStart={(e) => onStencilDragStart(e, s.kind)}
                  >
                    <span className="adv2-sten-glyph" style={{ borderColor: meta.accent, color: meta.accent }}>
                      {meta.glyph}
                    </span>
                    <div className="adv2-sten-text">
                      <div className="adv2-sten-title">{s.title}</div>
                      <div className="adv2-sten-sub">{s.sub}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="adv2-rail-foot">
              <div className="adv2-legend-h">Wire kinds</div>
              <div className="adv2-legend-row">
                <span className="lw lw-data"></span>data flow
              </div>
              <div className="adv2-legend-row">
                <span className="lw lw-route"></span>route decision
              </div>
              <div className="adv2-legend-row">
                <span className="lw lw-tool"></span>tool call
              </div>
              <div className="adv2-legend-row">
                <span className="lw lw-spawn"></span>spawn subagent
              </div>
              <div className="adv2-legend-row">
                <span className="lw lw-gate"></span>permission gate
              </div>
              <div className="adv2-legend-row">
                <span className="lw lw-return"></span>return value
              </div>
            </div>
          </aside>

          {/* Canvas */}
          <div
            className="adv2-board"
            ref={boardRef}
            onMouseDown={onBoardMouseDown}
            onWheel={onWheel}
            onDragOver={onBoardDragOver}
            onDrop={onBoardDrop}
          >
            <div className={`adv2-bg ${showGrid ? "with-grid" : ""}`}></div>
            <div className="adv2-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
              {/* Edges */}
              <svg className="adv2-wires" width="3000" height="2000" viewBox="0 0 3000 2000">
                <defs>
                  <marker
                    id="adv2-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = nodes.find((n) => n.id === e.from)
                  const b = nodes.find((n) => n.id === e.to)
                  if (!a || !b) return null
                  const x1 = a.x + NODE_W,
                    y1 = a.y + 36
                  const x2 = b.x,
                    y2 = b.y + 36
                  const cx1 = x1 + Math.max(60, (x2 - x1) / 2)
                  const cx2 = x2 - Math.max(60, (x2 - x1) / 2)
                  const d = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`
                  return (
                    <g
                      key={e.id}
                      className={`adv2-wire wire-${e.kind}`}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        deleteEdge(e.id)
                      }}
                    >
                      <path d={d} className="adv2-wire-hit" />
                      <path d={d} className="adv2-wire-line" markerEnd="url(#adv2-arrow)" />
                      {e.label && (
                        <g transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2 - 8})`}>
                          <rect x="-22" y="-9" width="44" height="16" className="adv2-wire-lab-bg" />
                          <text className="adv2-wire-lab" textAnchor="middle" y="3">
                            {e.label}
                          </text>
                        </g>
                      )}
                    </g>
                  )
                })}
                {linking &&
                  (() => {
                    const a = nodes.find((n) => n.id === linking.fromId)
                    if (!a) return null
                    const x1 = a.x + NODE_W,
                      y1 = a.y + 36
                    const x2 = linking.x,
                      y2 = linking.y
                    const cx1 = x1 + Math.max(60, (x2 - x1) / 2)
                    const cx2 = x2 - Math.max(60, (x2 - x1) / 2)
                    return (
                      <path
                        d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                        className="adv2-wire-pending"
                      />
                    )
                  })()}
              </svg>

              {/* Nodes */}
              {nodes.map((n) => (
                <Node
                  key={n.id}
                  node={n}
                  selected={selectedId === n.id}
                  onMouseDown={onNodeMouseDown}
                  onPortDown={onPortMouseDown}
                  onSelect={() => setSelectedId(n.id)}
                />
              ))}
            </div>

            {/* Mini-map */}
            <MiniMap nodes={nodes} edges={edges} view={view} setView={setView} boardRef={boardRef} />

            {/* Footer chip */}
            <div className="adv2-canvas-foot">
              <span>
                <b>{nodes.length}</b> nodes
              </span>
              <span>
                <b>{edges.length}</b> wires
              </span>
              <span className="dim">Drag stencil onto canvas · drag node port to wire · click wire to delete</span>
            </div>
          </div>

          {/* Inspector */}
          <aside className="adv2-inspector">
            {selected ? (
              <Inspector
                node={selected}
                onChange={(p) => updateNode(selected.id, p)}
                onDelete={() => deleteNode(selected.id)}
                edges={edges}
                nodes={nodes}
              />
            ) : (
              <EmptyInspector />
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

/* ---------- Node ---------- */
function Node({ node, selected, onMouseDown, onPortDown, onSelect }) {
  const meta = NODE_KIND_META[node.kind]
  const knobs = node.knobs || {}
  const knobEntries = Object.entries(knobs).slice(0, 3)
  return (
    <div
      className={`adv2-node adv2-k-${node.kind} ${selected ? "selected" : ""}`}
      style={{ left: node.x, top: node.y, width: NODE_W }}
      onMouseDown={(e) => onMouseDown(e, node.id)}
      onClick={onSelect}
    >
      <div className="adv2-node-bar" style={{ background: meta.accent }}></div>
      <div className="adv2-node-head">
        <span className="adv2-node-glyph" style={{ borderColor: meta.accent, color: meta.accent }}>
          {meta.glyph}
        </span>
        <div className="adv2-node-text">
          <div className="adv2-node-kind">{meta.label}</div>
          <div className="adv2-node-title">{node.title}</div>
        </div>
      </div>
      <div className="adv2-node-sub">{node.sub}</div>
      {knobEntries.length > 0 && (
        <div className="adv2-node-knobs">
          {knobEntries.map(([k, v]) => (
            <div key={k} className="adv2-knob-row">
              <span className="k">{k}</span>
              <span className="v">{formatVal(v)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="adv2-port adv2-port-in" data-port-in={node.id} title="Inbound"></div>
      <div
        className="adv2-port adv2-port-out"
        onMouseDown={(e) => onPortDown(e, node.id, "out")}
        title="Drag to connect"
      ></div>
    </div>
  )
}

function formatVal(v) {
  if (typeof v === "boolean") return v ? "on" : "off"
  if (Array.isArray(v)) return v.length === 1 ? v[0] : v.length + " items"
  if (typeof v === "string" && v.length > 18) return v.slice(0, 16) + "…"
  return String(v)
}

/* ---------- Inspector ---------- */
function EmptyInspector() {
  return (
    <div className="adv2-insp adv2-insp-empty">
      <div className="adv2-insp-eyebrow">Inspector</div>
      <div className="adv2-insp-empty-title">Nothing selected</div>
      <p className="adv2-insp-empty-lede">
        Click a node on the canvas to edit its configuration. Drag from the stencil rail to add new stages. Drag from a
        node's right edge to wire it to another node.
      </p>
      <div className="adv2-insp-empty-tips">
        <div>
          <kbd>V</kbd>
          <span>Select / move</span>
        </div>
        <div>
          <kbd>H</kbd>
          <span>Pan canvas</span>
        </div>
        <div>
          <kbd>⌫</kbd>
          <span>Delete selected</span>
        </div>
        <div>
          <kbd>⌘</kbd>
          <kbd>scroll</kbd>
          <span>Zoom</span>
        </div>
      </div>
    </div>
  )
}

function Inspector({ node, onChange, onDelete, edges, nodes }) {
  const meta = NODE_KIND_META[node.kind]
  const incoming = edges.filter((e) => e.to === node.id)
  const outgoing = edges.filter((e) => e.from === node.id)
  return (
    <div className="adv2-insp">
      <div className="adv2-insp-head">
        <div>
          <div className="adv2-insp-eyebrow">{meta.label} node</div>
          <input className="adv2-insp-title" value={node.title} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        <button className="adv2-mini ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
      <input
        className="adv2-insp-sub"
        value={node.sub}
        onChange={(e) => onChange({ sub: e.target.value })}
        placeholder="Subtitle"
      />

      {node.kind === "input" && <InputKnobs node={node} onChange={onChange} />}
      {node.kind === "router" && <RouterKnobs node={node} onChange={onChange} />}
      {node.kind === "agent" && <AgentKnobs node={node} onChange={onChange} />}
      {node.kind === "tool" && <ToolKnobs node={node} onChange={onChange} />}
      {node.kind === "sandbox" && <SandboxKnobs node={node} onChange={onChange} />}
      {node.kind === "feedback" && <FeedbackKnobs node={node} onChange={onChange} />}
      {node.kind === "output" && <OutputKnobs node={node} onChange={onChange} />}

      <section className="adv2-insp-sec">
        <div className="adv2-insp-h">Wires</div>
        <div className="adv2-wires-pane">
          <div className="adv2-wires-col">
            <div className="adv2-wires-lab">Inbound · {incoming.length}</div>
            {incoming.length === 0 && <div className="adv2-wires-empty">none</div>}
            {incoming.map((e) => {
              const from = nodes.find((n) => n.id === e.from)
              return (
                <div key={e.id} className="adv2-wires-row">
                  <span className={`pip pip-${e.kind}`}></span>
                  {from?.title}
                </div>
              )
            })}
          </div>
          <div className="adv2-wires-col">
            <div className="adv2-wires-lab">Outbound · {outgoing.length}</div>
            {outgoing.length === 0 && <div className="adv2-wires-empty">none</div>}
            {outgoing.map((e) => {
              const to = nodes.find((n) => n.id === e.to)
              return (
                <div key={e.id} className="adv2-wires-row">
                  <span className={`pip pip-${e.kind}`}></span>
                  {to?.title}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

/* ---------- Knob editors ---------- */
function K({ label, hint, children }) {
  return (
    <div className="adv2-k">
      <div className="adv2-k-label">{label}</div>
      {hint && <div className="adv2-k-hint">{hint}</div>}
      <div className="adv2-k-v">{children}</div>
    </div>
  )
}
function Toggle({ on, onChange }) {
  return (
    <button className={`adv2-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="track">
        <span className="thumb"></span>
      </span>
      <span className="t">{on ? "On" : "Off"}</span>
    </button>
  )
}
function Segs({ value, onChange, options }) {
  return (
    <div className="adv2-segs">
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value
        const lab = typeof o === "string" ? o : o.label
        return (
          <button key={v} className={`adv2-seg ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>
            {lab}
          </button>
        )
      })}
    </div>
  )
}
function Num({ value, onChange, min, max, step, suffix }) {
  return (
    <div className="adv2-num">
      <button onClick={() => onChange(Math.max(min ?? -Infinity, value - (step || 1)))}>−</button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {suffix && <span>{suffix}</span>}
      <button onClick={() => onChange(Math.min(max ?? Infinity, value + (step || 1)))}>+</button>
    </div>
  )
}
function Sel({ value, onChange, options }) {
  return (
    <select className="adv2-sel" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value || o} value={o.value || o}>
          {o.label || o}
        </option>
      ))}
    </select>
  )
}

function InputKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Context</div>
      <K label="Roots" hint="Folders the agent may read.">
        <div className="adv2-chips">
          {(k.roots || []).map((r, i) => (
            <span key={i} className="adv2-chip">
              {r}
              <button onClick={() => onChange({ knobs: { roots: k.roots.filter((_, j) => j !== i) } })}>×</button>
            </span>
          ))}
          <button
            className="adv2-chip add"
            onClick={() => onChange({ knobs: { roots: [...(k.roots || []), "~/code/new-path"] } })}
          >
            + path
          </button>
        </div>
      </K>
      <K label="SVG as text" hint="Treat .svg drops as source rather than image.">
        <Toggle on={k.svgAsText} onChange={(v) => onChange({ knobs: { svgAsText: v } })} />
      </K>
      <K label="Paste summary" hint="Auto-summarize pastes over 500 lines.">
        <Toggle on={k.pasteSummary} onChange={(v) => onChange({ knobs: { pasteSummary: v } })} />
      </K>
    </section>
  )
}

function RouterKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Routing</div>
      <K label="Reasoning effort" hint="Drives the variant chosen for downstream agents.">
        <Segs
          value={k.effort}
          onChange={(v) => onChange({ knobs: { effort: v } })}
          options={["low", "medium", "high", "deep"]}
        />
      </K>
      <K label="Default model">
        <Sel
          value={k.model}
          onChange={(v) => onChange({ knobs: { model: v } })}
          options={["claude-opus-4", "claude-sonnet-4.5", "claude-haiku-4-5", "gpt-5.1", "gpt-4o", "gemini-2.5-pro"]}
        />
      </K>
      <K label="Small model" hint="Used for cheap utility steps.">
        <Sel
          value={k.small}
          onChange={(v) => onChange({ knobs: { small: v } })}
          options={["claude-haiku-4-5", "gpt-4o-mini", "gemini-2.5-flash"]}
        />
      </K>
    </section>
  )
}

function AgentKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Agent runtime</div>
      <K label="Step budget" hint="Hard cap on iterations of this agent's loop.">
        <Num
          value={k.steps || 16}
          onChange={(v) => onChange({ knobs: { steps: v } })}
          min={1}
          max={120}
          step={1}
          suffix="steps"
        />
      </K>
      <K label="Temperature">
        <Num value={k.temp ?? 1.0} onChange={(v) => onChange({ knobs: { temp: v } })} min={0} max={2} step={0.1} />
      </K>
      <K label="Color" hint="Shown in transcript and DAG.">
        <div className="adv2-swatches">
          {["#0d0d0d", "#3b5d6a", "#3a5a3a", "#7a3b2e", "#6a4a1a", "#5a3a5a"].map((c) => (
            <button
              key={c}
              className={`adv2-sw ${k.color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => onChange({ knobs: { color: c } })}
            />
          ))}
        </div>
      </K>
    </section>
  )
}

function ToolKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Tool</div>
      <K label="Enabled" hint="Hidden from agents when off.">
        <Toggle on={k.enabled !== false} onChange={(v) => onChange({ knobs: { enabled: v } })} />
      </K>
      <K label="Scope" hint="Which agents may invoke this tool.">
        <Segs
          value={k.scope || "all"}
          onChange={(v) => onChange({ knobs: { scope: v } })}
          options={[
            { value: "all", label: "All" },
            { value: "primary-only", label: "Primary" },
            { value: "subagent-only", label: "Subagent" },
          ]}
        />
      </K>
    </section>
  )
}

function SandboxKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Sandbox</div>
      <K label="Backend">
        <Sel
          value={k.backend || "auto"}
          onChange={(v) => onChange({ knobs: { backend: v } })}
          options={["auto", "process", "seatbelt", "windows_native", "landlock"]}
        />
      </K>
      <K label="Network policy">
        <Segs
          value={k.network || "deny"}
          onChange={(v) => onChange({ knobs: { network: v } })}
          options={[
            { value: "deny", label: "Deny" },
            { value: "loopback", label: "Loop" },
            { value: "allowlist", label: "Allowlist" },
            { value: "allow", label: "All" },
          ]}
        />
      </K>
      <K label="Broker TTL" hint="How long an approved command stays approved.">
        <Num
          value={k.brokerTtl ?? 300}
          onChange={(v) => onChange({ knobs: { brokerTtl: v } })}
          min={0}
          max={3600}
          step={30}
          suffix="sec"
        />
      </K>
    </section>
  )
}

function FeedbackKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Permission gate</div>
      <K label="Default action">
        <Segs
          value={k.defaultAction || "ask"}
          onChange={(v) => onChange({ knobs: { defaultAction: v } })}
          options={["ask", "allow", "always", "deny"]}
        />
      </K>
      <K label="Continue loop on deny" hint="Keep iterating without that tool when denied.">
        <Toggle on={k.continueOnDeny} onChange={(v) => onChange({ knobs: { continueOnDeny: v } })} />
      </K>
      <K label="Allow correction text" hint="Show a textarea so the user can steer.">
        <Toggle on={k.allowCorrection !== false} onChange={(v) => onChange({ knobs: { allowCorrection: v } })} />
      </K>
    </section>
  )
}

function OutputKnobs({ node, onChange }) {
  const k = node.knobs
  return (
    <section className="adv2-insp-sec">
      <div className="adv2-insp-h">Output stream</div>
      <K label="Show reasoning">
        <Toggle on={k.showReasoning !== false} onChange={(v) => onChange({ knobs: { showReasoning: v } })} />
      </K>
      <K label="Expand tool parts">
        <Toggle on={k.expandTools !== false} onChange={(v) => onChange({ knobs: { expandTools: v } })} />
      </K>
      <K label="Event replay">
        <Toggle on={k.eventReplay !== false} onChange={(v) => onChange({ knobs: { eventReplay: v } })} />
      </K>
    </section>
  )
}

/* ---------- Mini-map ---------- */
function MiniMap({ nodes, edges, view, setView, boardRef }) {
  const W = 200,
    H = 130
  const xs = nodes.map((n) => n.x),
    ys = nodes.map((n) => n.y)
  const xmin = Math.min(...xs, 0) - 80,
    xmax = Math.max(...xs, 0) + NODE_W + 80
  const ymin = Math.min(...ys, 0) - 80,
    ymax = Math.max(...ys, 0) + NODE_H_BASE + 80
  const span = Math.max(xmax - xmin, 1),
    spanY = Math.max(ymax - ymin, 1)
  const sx = W / span,
    sy = H / spanY
  const r = boardRef.current?.getBoundingClientRect()
  const vx = r ? -view.x / view.k : 0
  const vy = r ? -view.y / view.k : 0
  const vw = r ? r.width / view.k : 800
  const vh = r ? r.height / view.k : 500
  return (
    <div className="adv2-mini">
      <svg width={W} height={H}>
        <rect x="0" y="0" width={W} height={H} className="adv2-mini-bg" />
        {nodes.map((n) => (
          <rect
            key={n.id}
            x={(n.x - xmin) * sx}
            y={(n.y - ymin) * sy}
            width={NODE_W * sx}
            height={NODE_H_BASE * sy}
            className={`adv2-mini-node mini-${n.kind}`}
          />
        ))}
        <rect x={(vx - xmin) * sx} y={(vy - ymin) * sy} width={vw * sx} height={vh * sy} className="adv2-mini-view" />
      </svg>
    </div>
  )
}

window.AdvancedSettings = AdvancedSettings
