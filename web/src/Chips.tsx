import { useEffect, useState } from "react";
import { getJson, type ToolSummary } from "./api";
import { Link } from "./router";

const STEP_NAMES = ["pumpdown", "stabilize", "deposit", "purge"];

/** One chip per tool, polled every 2 s: live step while a run streams in, else the last run. */
export function Chips({ active, onTools }: { active?: string; onTools?: (tools: ToolSummary[]) => void }) {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () =>
      getJson<ToolSummary[]>("/api/tools")
        .then((t) => {
          if (stop) return;
          setTools(t);
          onTools?.(t);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
    // onTools is a stable setter-style callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="topbar">
      <span className="brand">lotline</span>
      <div className="chips">
        {tools.map((t) => {
          const running = t.live.state === "running" && t.live.stepIdx !== null;
          return (
            <Link key={t.id} to={`/tools/${t.id}`} className={`chip${t.id === active ? " active" : ""}`}>
              <span className={`dot${running ? " running" : t.lastRunFlagged ? " flagged" : ""}`} />
              {t.displayName}
              <span className="muted" data-testid={`chip-${t.id}`}>
                {running
                  ? `run ${t.live.runIdx}: running step ${t.live.stepIdx! + 1} (${STEP_NAMES[t.live.stepIdx!]})`
                  : `${t.runCount} runs${t.lastRunFlagged ? " · flagged" : ""}`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
