import { useEffect } from "react";
import { getJson, type ToolSummary } from "./api";
import { navigate, usePath } from "./router";
import { RunPage } from "./RunPage";
import { ToolPage } from "./ToolPage";

function Home() {
  useEffect(() => {
    getJson<ToolSummary[]>("/api/tools").then((tools) => {
      if (tools.length > 0) navigate(`/tools/${tools[0].id}`);
    });
  }, []);
  return <p className="muted">Loading tools…</p>;
}

export function App() {
  const path = usePath();
  const tool = path.match(/^\/tools\/([^/]+)/);
  const run = path.match(/^\/runs\/([^/]+)/);
  return (
    <div className="page">
      {tool ? <ToolPage key={tool[1]} id={decodeURIComponent(tool[1])} /> : run ? <RunPage key={run[1]} id={decodeURIComponent(run[1])} /> : <Home />}
    </div>
  );
}
