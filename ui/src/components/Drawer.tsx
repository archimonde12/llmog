import React, { useEffect } from "react";

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
    <div className="drawerOverlay" role="dialog" aria-modal="true" onMouseDown={props.onClose}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawerHeader">
          <div className="drawerTitle">{props.title}</div>
          {showClose ? (
            <button type="button" className="btn ghost" onClick={props.onClose}>
              Close
            </button>
          ) : (
            <div className="spacer" />
          )}
        </div>
        <div className="drawerBody">{props.children}</div>
      </div>
    </div>
  );
}

