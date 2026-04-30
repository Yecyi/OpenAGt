/* Panel resize + collapse — drag handle and chevron toggle for left/right panels */

function ResizeHandle({ side, value, onChange, min, max, collapsed, onToggle }) {
  const startX = React.useRef(0);
  const startW = React.useRef(0);
  const moved = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);
  const DRAG_THRESHOLD = 4; // px before we count it as a drag

  function onDown(e) {
    // ignore right-click
    if (e.button !== 0) return;
    // when collapsed, let the click handler (below) run; don't start a drag
    if (collapsed) return;
    startX.current = e.clientX;
    startW.current = value;
    moved.current = false;

    const move = (ev) => {
      const dx = ev.clientX - startX.current;
      if (!moved.current && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!moved.current) {
        moved.current = true;
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
      const next = side === "left" ? startW.current + dx : startW.current - dx;
      onChange(Math.max(min, Math.min(max, next)));
    };
    const up = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    e.preventDefault();
  }

  function onClickHandle(e) {
    // Only react when collapsed — expanded clicks come from the chevron button itself
    if (!collapsed) return;
    onToggle && onToggle();
  }

  function onDouble(e) {
    if (collapsed) return;
    e.preventDefault();
    onToggle && onToggle();
  }

  return (
    <div
      className={`panel-handle ${side} ${dragging ? "dragging" : ""} ${collapsed ? "collapsed" : ""}`}
      onMouseDown={onDown}
      onClick={onClickHandle}
      onDoubleClick={onDouble}
      title={collapsed ? "Click to expand" : "Drag to resize · Double-click to collapse"}
    >
      <div className="panel-handle-grip"></div>
      <button
        className="panel-handle-toggle"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle && onToggle(); }}
        title={collapsed ? `Expand ${side === "left" ? "sidebar" : "inspector"}` : `Collapse ${side === "left" ? "sidebar" : "inspector"}`}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          {(side === "left" && !collapsed) || (side === "right" && collapsed)
            ? <polyline points="10,3 5,8 10,13" />
            : <polyline points="6,3 11,8 6,13" />}
        </svg>
      </button>
    </div>
  );
}

window.ResizeHandle = ResizeHandle;
