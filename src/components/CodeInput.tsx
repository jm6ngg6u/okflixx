import { Fragment, useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";

export type CodeInputHandle = {
  getCode: () => string;
  clear: () => void;
  shake: () => void;
  focusFirst: () => void;
};

type CodeInputProps = {
  onComplete?: (code: string) => void;
  onChange?: (filled: number, code: string) => void;
  /** When true, digits render as bullets (PIN mask). */
  masked?: boolean;
  /** Show error styling (red ring, red boxes) with an optional message under the group. */
  error?: string | null;
  /** Show the built-in Show/Hide mask toggle in the corner. */
  showMaskToggle?: boolean;
};

/**
 * 8-box TV code input with animated conic border, PIN masking, paste support,
 * and error shake/highlight.
 */
export const CodeInput = forwardRef<CodeInputHandle, CodeInputProps>(
  function CodeInput({ onComplete, onChange, masked: maskedProp, error, showMaskToggle = true }, ref) {
  const LEN = 8;
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [shaking, setShaking] = useState(false);
  const [internalMasked, setInternalMasked] = useState(false);
  const masked = maskedProp ?? internalMasked;
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const shakeTimer = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    getCode: () => digits.join(""),
    clear: () => setDigits(Array(LEN).fill("")),
    shake: () => {
      setShaking(true);
      if (shakeTimer.current) window.clearTimeout(shakeTimer.current);
      shakeTimer.current = window.setTimeout(() => setShaking(false), 500);
    },
    focusFirst: () => refs.current[0]?.focus(),
  }), [digits]);

  useEffect(() => () => { if (shakeTimer.current) window.clearTimeout(shakeTimer.current); }, []);

  // Auto-shake when error toggles on
  useEffect(() => {
    if (!error) return;
    setShaking(true);
    const t = window.setTimeout(() => setShaking(false), 500);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const code = digits.join("");
    const filled = digits.filter(Boolean).length;
    if (onChange) onChange(filled, code);
    if (filled === LEN && onComplete) onComplete(code);
  }, [digits, onComplete, onChange]);


  const setAt = (i: number, v: string) => {
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  };

  const fillFrom = (i: number, raw: string) => {
    const clean = raw.replace(/[^0-9]/g, "");
    if (!clean) return;
    const chars = clean.slice(0, LEN - i).split("");
    setDigits((prev) => {
      const next = [...prev];
      chars.forEach((c, k) => (next[i + k] = c));
      return next;
    });
    const nextIdx = Math.min(i + chars.length, LEN - 1);
    // focus on next tick so React has painted the new value
    window.requestAnimationFrame(() => refs.current[nextIdx]?.focus());
  };

  const handleChange = (i: number, val: string) => {
    const clean = val.replace(/[^0-9]/g, "");
    if (!clean) { setAt(i, ""); return; }
    if (clean.length === 1) {
      setAt(i, clean);
      if (i < LEN - 1) refs.current[i + 1]?.focus();
    } else {
      fillFrom(i, clean);
    }
  };

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
      setAt(i - 1, "");
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LEN - 1) refs.current[i + 1]?.focus();
  };

  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!/\d/.test(text)) return;
    e.preventDefault();
    fillFrom(i, text);
  };

  const frameClass = [
    "code-frame",
    error ? "is-error" : "",
    shaking ? "is-shake" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="relative">
      <div className={frameClass} aria-invalid={!!error}>
        {showMaskToggle && maskedProp === undefined && (
          <button
            type="button"
            className="code-mask-toggle"
            onClick={() => setInternalMasked((m) => !m)}
            aria-pressed={masked}
            aria-label={masked ? "Show code" : "Hide code"}
          >
            {masked ? "Show" : "Hide"}
          </button>
        )}
        <div className="code-boxes">
          {digits.map((d, i) => (
            <Fragment key={i}>
              <input
                ref={(el) => { refs.current[i] = el; }}
                className={`code-box ${d ? "filled" : ""} ${masked && d ? "is-masked" : ""}`}
                type="tel"
                inputMode="numeric"
                enterKeyHint="next"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={1}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                onPaste={(e) => handlePaste(i, e)}
                onFocus={(e) => { try { e.currentTarget.select(); } catch {} }}
                aria-label={`Digit ${i + 1} of 8`}
                aria-invalid={!!error}
              />
              {i === 3 && <span className="code-sep">—</span>}
            </Fragment>
          ))}
        </div>
      </div>
      {error && (
        <div className="code-error-msg" role="alert" aria-live="polite">
          <span className="dot" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
});
