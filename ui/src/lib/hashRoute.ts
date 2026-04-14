export type AppRouteName = "configuration" | "monitoring" | "models" | "playground" | "probe";

export type AppRoute = {
  name: AppRouteName;
  /** Query string parsed from hash (e.g. `playground?model=x` → `{ model: "x" }`). */
  query: Record<string, string>;
};

export function parseAppHash(hash: string): AppRoute {
  const h = (hash || "").replace(/^#/, "");
  const qIdx = h.indexOf("?");
  const rawPath = (qIdx >= 0 ? h.slice(0, qIdx) : h).replace(/^\/+/, "").replace(/\/+$/, "");
  const queryStr = qIdx >= 0 ? h.slice(qIdx + 1) : "";
  const query: Record<string, string> = {};
  new URLSearchParams(queryStr).forEach((v, k) => {
    query[k] = v;
  });

  const p = rawPath;
  if (!p || p === "configuration") return { name: "configuration", query };
  if (p === "monitoring") return { name: "monitoring", query };
  if (p === "models") return { name: "models", query };
  if (p === "playground") return { name: "playground", query };
  if (p === "probe") return { name: "probe", query };
  if (p.startsWith("models/")) return { name: "models", query };
  return { name: "configuration", query };
}

export function setHash(path: string) {
  const next = path.startsWith("#") ? path : `#/${path.replace(/^\/+/, "")}`;
  if (window.location.hash === next) return;
  window.location.hash = next;
}
