"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { resetDemoData } from "./actions";

export function ResetButton() {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={
        armed
          ? "btn btn-sm bg-rose-400 text-paper hover:bg-rose-300"
          : "btn-ghost btn-sm"
      }
      disabled={pending}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        start(async () => {
          await resetDemoData();
          setArmed(false);
        });
      }}
    >
      <RotateCcw size={14} strokeWidth={1.75} />
      {pending
        ? "Resetting"
        : armed
          ? "Click again to erase all bookings"
          : "Reset demo data"}
    </button>
  );
}
