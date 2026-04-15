import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Boxes,
  FlaskConical,
  MessageSquare,
  RadioTower,
  Settings2,
} from "lucide-react";
import { MonitoringPage } from "./pages/MonitoringPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { ProbePage } from "./pages/ProbePage";
import type { RangeKey } from "./lib/time";
import { parseAppHash, setHash } from "./lib/hashRoute";
import { cn } from "./lib/utils";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";

const nav = [
  { name: "configuration" as const, label: "Configuration", icon: Settings2 },
  { name: "monitoring" as const, label: "Monitoring", icon: Activity },
  { name: "models" as const, label: "Models", icon: Boxes },
  { name: "playground" as const, label: "Playground", icon: MessageSquare },
  { name: "probe" as const, label: "Endpoint probe", icon: RadioTower },
];

export function App() {
  const [range, setRange] = useState<RangeKey>("15m");
  const [hash, setHashState] = useState(() => window.location.hash);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const onChange = () => setHashState(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const route = useMemo(() => parseAppHash(hash), [hash]);

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-zinc-950 text-zinc-50">
      <aside className="flex flex-col gap-4 border-r border-white/10 bg-white/[0.04] px-4 py-5 backdrop-blur-xl">
        {reducedMotion ? (
          <div className="text-sm font-semibold tracking-tight text-white">llmog</div>
        ) : (
          <motion.div
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="text-sm font-semibold tracking-tight text-white"
          >
            llmog
          </motion.div>
        )}
        <nav className="flex flex-col gap-1">
          {nav.map(({ name, label, icon: Icon }) => {
            const active = route.name === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setHash(name)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  active
                    ? "bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/35"
                    : "text-zinc-300 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <FlaskConical className="size-3.5" aria-hidden />
            Admin UI
          </span>
        </div>
      </aside>

      <main className="max-w-[1320px] overflow-x-auto p-4 pb-10 md:p-6">
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
