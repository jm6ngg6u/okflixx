import { Fragment, useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";

export type CodeInputHandle = {
  getCode: () => string;
  clear: () => void;
};

/**
 * 8-box TV code input with animated conic border around the group.
 */
export const CodeInput = forwardRef<CodeInputHandle, { onComplete?: (code: string) => void; onChange?: (filled: number, code: string) => void }>(
  function CodeInput({ onComplete, onChange }, ref) {
  const LEN = 8;
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useImperativeHandle(ref, () => ({
    getCode: () => digits.join(""),
    clear: () => setDigits(Array(LEN).fill("")),
  }), [digits]);

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

  const handleChange = (i: number, val: string) => {
    const clean = val.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!clean) { setAt(i, ""); return; }
    if (clean.length === 1) {
      setAt(i, clean);
      if (i < LEN - 1) refs.current[i + 1]?.focus();
    } else {
      // paste
      const chars = clean.slice(0, LEN - i).split("");
      setDigits((prev) => {
        const next = [...prev];
        chars.forEach((c, k) => (next[i + k] = c));
        return next;
      });
      const nextIdx = Math.min(i + chars.length, LEN - 1);
      refs.current[nextIdx]?.focus();
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

  return (
    <div className="code-frame">
      <div className="code-boxes">
        {digits.map((d, i) => (
          <Fragment key={i}>
            <input
              ref={(el) => { refs.current[i] = el; }}
              className={`code-box ${d ? "filled" : ""}`}
              inputMode="text"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKey(i, e)}
              aria-label={`Digit ${i + 1}`}
            />
            {i === 3 && <span className="code-sep">—</span>}
          </Fragment>
        ))}
      </div>
    </div>
  );
});

