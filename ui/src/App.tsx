import React, { useEffect, useMemo, useState } from "react";
import { MonitoringPage } from "./pages/MonitoringPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { ProbePage } from "./pages/ProbePage";
import type { RangeKey } from "./lib/time";
import { parseAppHash, setHash } from "./lib/hashRoute";

export function App() {
  const [range, setRange] = useState<RangeKey>("15m");
  const [hash, setHashState] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHashState(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const route = useMemo(() => parseAppHash(hash), [hash]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">llmog</div>
        <nav className="nav">
          <button
            type="button"
            className={`navItem ${route.name === "configuration" ? "active" : ""}`}
            onClick={() => setHash("configuration")}
          >
            Configuration
          </button>
          <button
            type="button"
            className={`navItem ${route.name === "monitoring" ? "active" : ""}`}
            onClick={() => setHash("monitoring")}
          >
            Monitoring
          </button>
          <button
            type="button"
            className={`navItem ${route.name === "models" ? "active" : ""}`}
            onClick={() => setHash("models")}
          >
            Models
          </button>
          <button
            type="button"
            className={`navItem ${route.name === "playground" ? "active" : ""}`}
            onClick={() => setHash("playground")}
          >
            Playground
          </button>
          <button
            type="button"
            className={`navItem ${route.name === "probe" ? "active" : ""}`}
            onClick={() => setHash("probe")}
          >
            Endpoint probe
          </button>
        </nav>
      </aside>

      <main className="content">
        {route.name === "configuration" && <ConfigurationPage />}
        {route.name === "monitoring" && <MonitoringPage range={range} onRangeChange={setRange} />}
        {route.name === "models" && <ModelsPage />}
        {route.name === "playground" && (
          <PlaygroundPage hashModelId={route.query.model} hashKey={hash} />
        )}
        {route.name === "probe" && <ProbePage />}
      </main>
    </div>
  );
}
