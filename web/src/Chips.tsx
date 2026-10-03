import { useEffect, useState } from "react";
import { getJson, type ToolSummary } from "./api";
import { Link } from "./router";

/** One chip per tool: last run, flagged or not. */
export function Chips({ active }: { active?: string }) {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  useEffect(() => {
    getJson<ToolSummary[]>("/api/tools").then(setTools);
  }, []);
  return (
    <div className="topbar">
      <span className="brand">lotline</span>
      <div className="chips">
        {tools.map((t) => (
          <Link key={t.id} to={`/tools/${t.id}`} className={`chip${t.id === active ? " active" : ""}`}>
            <span className={`dot${t.lastRunFlagged ? " flagged" : ""}`} />
            {t.displayName}
            <span className="muted">
              {t.runCount} runs{t.lastRunFlagged ? " · flagged" : ""}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
