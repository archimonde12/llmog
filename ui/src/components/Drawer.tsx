import React, { useEffect } from "react";
import { cn } from "@/lib/utils";

export function Drawer(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** @default true */
  showCloseButton?: boolean;
  children: React.ReactNode;
}) {
  const showClose = props.showCloseButton !== false;
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={props.onClose}
    >
      <div
        className={cn(
          "flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-zinc-950 shadow-2xl",
          "animate-in slide-in-from-right duration-200",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{props.title}</div>
          {showClose ? (
            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
              onClick={props.onClose}
            >
              Close
            </button>
          ) : (
            <div className="flex-1" />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-zinc-200">{props.children}</div>
      </div>
    </div>
  );
}
