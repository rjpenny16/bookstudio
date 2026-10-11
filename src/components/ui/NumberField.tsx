"use client";

import { useState } from "react";

interface Props {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  suffix?: string;
  disabled?: boolean;
}

/** Numeric input that commits on blur/Enter so typing does not spam history. */
export function NumberField({ label, value, onCommit, step = 0.01, min, max, digits = 3, suffix, disabled }: Props) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : "");
  const [text, setText] = useState(fmt(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(fmt(value));
  }
  const commit = () => {
    const n = Number.parseFloat(text);
    if (!Number.isFinite(n)) return setText(fmt(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
    setText(fmt(clamped));
  };
  return (
    <div className="field">
      <label>
        {label}
        {suffix ? <span className="field-hint"> ({suffix})</span> : null}
        <input
          type="number"
          value={text}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </label>
    </div>
  );
}
