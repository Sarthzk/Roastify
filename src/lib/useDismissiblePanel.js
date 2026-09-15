import { useCallback, useEffect } from "react";

// Shared outside-click/Escape/focus-trap behavior for a trigger+panel pair — extracted
// out of the sign-in dropdown so a second dropdown (the account panel) doesn't need its
// own copy of this logic. `containerRef` must wrap both the trigger and the panel, so an
// outside click is measured against the whole unit, not just the panel; `getFocusable()`
// traps Tab/Shift+Tab within whatever buttons are inside it while `isOpen`, matching the
// original sign-in dropdown's own behavior of including the trigger in that cycle.
// Returns `close()` — call it from the panel's own "close" button; Escape calls it
// internally too. A plain outside click does not restore focus to the trigger (it's
// already moving to whatever the user just clicked, and stealing it back would be the
// surprising behavior) — it only calls `onDismiss`.
export function useDismissiblePanel(isOpen, { containerRef, triggerRef, onDismiss }) {
  const close = useCallback(() => {
    onDismiss();
    triggerRef.current?.focus();
  }, [onDismiss, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;

    function getFocusable() {
      return containerRef.current ? Array.from(containerRef.current.querySelectorAll("button")) : [];
    }

    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) onDismiss();
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, containerRef, onDismiss, close]);

  return close;
}
