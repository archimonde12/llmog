import React, { useEffect, useMemo, useState } from "react";
import { MonitoringPage } from "./pages/MonitoringPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import type { RangeKey } from "./lib/time";

type Route =
  | { name: "configuration" }
  | { name: "monitoring" }
  | { name: "models" };

function parseHash(hash: string): Route {
  const h = (hash || "").replace(/^#/, "");
  const p = h.replace(/^\/+/, "");
  if (!p || p === "configuration") return { name: "configuration" };
  if (p === "monitoring") return { name: "monitoring" };
  if (p === "models") return { name: "models" };
  // phase 3.5: drop model detail route; keep hash compatibility by redirecting
  if (p.startsWith("models/")) return { name: "models" };
  return { name: "configuration" };
}

function setHash(path: string) {
  const next = path.startsWith("#") ? path : `#/${path.replace(/^\/+/, "")}`;
  if (window.location.hash === next) return;
  window.location.hash = next;
}

export function App() {
  const [range, setRange] = useState<RangeKey>("15m");
  const [hash, setHashState] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHashState(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const route = useMemo(() => parseHash(hash), [hash]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">llm-proxy</div>
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
        </nav>
      </aside>

      <main className="content">
        {route.name === "configuration" && <ConfigurationPage />}
        {route.name === "monitoring" && <MonitoringPage range={range} onRangeChange={setRange} />}
        {route.name === "models" && <ModelsPage />}
      </main>
    </div>
  );
}
