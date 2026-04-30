/* System Settings — modal with appearance (Day/Night), notifications, telemetry, etc. */

function SystemSettings({ open, onClose, theme, onTheme, tweaks, setTweak, onAdvanced }) {
  if (!open) return null;
  return (
    <div className="ss-scrim" onMouseDown={onClose}>
      <div className="ss" onMouseDown={e => e.stopPropagation()}>
        <header className="ss-head">
          <div className="ss-eyebrow">
            <span className="num">§</span>
            <span className="lab">System Settings</span>
            <span className="dim">— preferences for this device</span>
          </div>
          <button className="mc-close" onClick={onClose} title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </header>

        <div className="ss-body">
          <section className="ss-section">
            <div className="ss-h">Appearance</div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">Theme</div>
                <div className="ss-kd">Switches the broadsheet between day and night reading modes.</div>
              </div>
              <div className="ss-v">
                <div className="ss-segs ss-theme">
                  <button className={`ss-seg ${theme === "light" ? "on" : ""}`} onClick={() => onTheme("light")}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="3" />
                      <line x1="8" y1="1.5" x2="8" y2="3.5" /><line x1="8" y1="12.5" x2="8" y2="14.5" />
                      <line x1="1.5" y1="8" x2="3.5" y2="8" /><line x1="12.5" y1="8" x2="14.5" y2="8" />
                      <line x1="3.5" y1="3.5" x2="4.9" y2="4.9" /><line x1="11.1" y1="11.1" x2="12.5" y2="12.5" />
                      <line x1="3.5" y1="12.5" x2="4.9" y2="11.1" /><line x1="11.1" y1="4.9" x2="12.5" y2="3.5" />
                    </svg>
                    <span>Day</span>
                  </button>
                  <button className={`ss-seg ${theme === "dark" ? "on" : ""}`} onClick={() => onTheme("dark")}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12.5 9.5A5.5 5.5 0 0 1 6.5 3.5a.5.5 0 0 0-.7-.5 6 6 0 1 0 7.2 7.2.5.5 0 0 0-.5-.7z" />
                    </svg>
                    <span>Night</span>
                  </button>
                  <button className={`ss-seg ${theme === "auto" ? "on" : ""}`} onClick={() => onTheme("auto")}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
                    </svg>
                    <span>Auto</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">Density</div>
                <div className="ss-kd">Compact tightens line-height and padding throughout the app.</div>
              </div>
              <div className="ss-v">
                <div className="ss-segs">
                  <button className={`ss-seg ${(tweaks.density || "comfortable") === "comfortable" ? "on" : ""}`} onClick={() => setTweak && setTweak("density", "comfortable")}>Comfortable</button>
                  <button className={`ss-seg ${tweaks.density === "compact" ? "on" : ""}`} onClick={() => setTweak && setTweak("density", "compact")}>Compact</button>
                </div>
              </div>
            </div>
          </section>

          <section className="ss-section">
            <div className="ss-h">Notifications</div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">Approval requests</div>
                <div className="ss-kd">System banner when an agent waits on a high-risk action.</div>
              </div>
              <div className="ss-v">
                <SsToggle on={tweaks.notifyApprovals !== false} onChange={v => setTweak && setTweak("notifyApprovals", v)} />
              </div>
            </div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">Mission completion</div>
                <div className="ss-kd">Sound + banner when a mission finishes or fails.</div>
              </div>
              <div className="ss-v">
                <SsToggle on={tweaks.notifyMission !== false} onChange={v => setTweak && setTweak("notifyMission", v)} />
              </div>
            </div>
          </section>

          <section className="ss-section">
            <div className="ss-h">Privacy</div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">Telemetry</div>
                <div className="ss-kd">Local-only diagnostic events. Nothing leaves this machine without explicit upload.</div>
              </div>
              <div className="ss-v">
                <SsToggle on={tweaks.telemetry === true} onChange={v => setTweak && setTweak("telemetry", v)} />
              </div>
            </div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">Redact secrets in transcripts</div>
                <div className="ss-kd">Mask API keys, tokens, env vars when sharing or exporting.</div>
              </div>
              <div className="ss-v">
                <SsToggle on={tweaks.redact !== false} onChange={v => setTweak && setTweak("redact", v)} />
              </div>
            </div>
          </section>

          <section className="ss-section">
            <div className="ss-h">Editor</div>
            <div className="ss-row">
              <div className="ss-k">
                <div className="ss-kt">External editor</div>
                <div className="ss-kd">Open files referenced in chat in your preferred editor.</div>
              </div>
              <div className="ss-v">
                <select className="ss-select" value={tweaks.editor || "vscode"} onChange={e => setTweak && setTweak("editor", e.target.value)}>
                  <option value="vscode">Visual Studio Code</option>
                  <option value="cursor">Cursor</option>
                  <option value="zed">Zed</option>
                  <option value="vim">Neovim</option>
                  <option value="sublime">Sublime Text</option>
                  <option value="system">System default</option>
                </select>
              </div>
            </div>
          </section>
        </div>

        <footer className="ss-foot">
          <div className="ss-foot-meta">OpenAGt · v1.17.0-rc.3</div>
          <div style={{ display: "flex", gap: 8 }}>
            {onAdvanced && <button className="mc-btn ghost" onClick={onAdvanced}>Advanced developer settings →</button>}
            <button className="mc-btn" onClick={onClose}>Done</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SsToggle({ on, onChange }) {
  return (
    <button className={`ss-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="dot"></span>
      <span className="t">{on ? "On" : "Off"}</span>
    </button>
  );
}

window.SystemSettings = SystemSettings;
