"use client";

import { useState } from "react";

/** Textarea that keeps a local draft and commits on blur, so undo works per edit. */
export function CommitTextarea({ value, onCommit, rows = 3, label }: { value: string; onCommit: (v: string) => void; rows?: number; label: string }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <div className="field">
      <label>
        {label}
        <textarea rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onCommit(draft)} />
      </label>
    </div>
  );
}
