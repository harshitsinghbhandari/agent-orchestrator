"use client";

import { useEffect, useRef, useState } from "react";

interface Line {
  text: string;
  delay: number;
  className?: string;
}

const TERMINAL_LINES: Line[] = [
  { text: "~/project $ ao spawn --issue 42", delay: 0, className: "command" },
  { text: "", delay: 1200 },
  { text: "✓ Spawning agent: claude-code", delay: 1400, className: "success" },
  { text: "✓ Spawning agent: codex", delay: 1700, className: "success" },
  { text: "✓ Spawning agent: aider", delay: 2000, className: "success" },
  { text: "", delay: 2300 },
  { text: "◉ 3 agents working in parallel", delay: 2500, className: "info" },
  { text: "├─ claude-code  [████████░░] PR #47", delay: 2800, className: "progress" },
  { text: "├─ codex        [██████░░░░] working...", delay: 3100, className: "progress" },
  { text: "└─ aider        [████░░░░░░] spawning", delay: 3400, className: "progress" },
  { text: "", delay: 3700 },
  { text: "~/project $ ", delay: 4000, className: "command" },
];

export default function HeroTerminal() {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [typingIndex, setTypingIndex] = useState(0);
  const [typedText, setTypedText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // First, type the command
    const command = TERMINAL_LINES[0].text;
    const prompt = "~/project $ ";
    const commandPart = command.slice(prompt.length);

    let charIndex = 0;
    setTypedText(prompt);
    setVisibleLines(1);

    const typeInterval = setInterval(() => {
      if (charIndex < commandPart.length) {
        setTypedText(prompt + commandPart.slice(0, charIndex + 1));
        charIndex++;
      } else {
        clearInterval(typeInterval);
        // Start revealing remaining lines
        TERMINAL_LINES.slice(1).forEach((line, i) => {
          setTimeout(() => {
            setVisibleLines(i + 2);
          }, line.delay - 1200);
        });
      }
    }, 40 + Math.random() * 15);

    return () => clearInterval(typeInterval);
  }, []);

  const getLineColor = (className?: string) => {
    switch (className) {
      case "command": return "var(--cyan-400)";
      case "success": return "var(--emerald-400)";
      case "info": return "var(--amber-400)";
      case "progress": return "var(--text-secondary)";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div
      ref={containerRef}
      className="terminal-card overflow-hidden"
      style={{ maxWidth: 540 }}
    >
      {/* Terminal chrome */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="w-3 h-3 rounded-full" style={{ background: "#f43f5e" }} />
        <div className="w-3 h-3 rounded-full" style={{ background: "#f59e0b" }} />
        <div className="w-3 h-3 rounded-full" style={{ background: "#10b981" }} />
        <span
          className="ml-3 text-xs font-[family-name:var(--font-geist-mono)]"
          style={{ color: "var(--text-muted)" }}
        >
          Terminal — ao session
        </span>
      </div>

      {/* Terminal body */}
      <div className="p-5 font-[family-name:var(--font-jetbrains)] text-sm leading-7">
        {/* First line (typing) */}
        <div style={{ color: getLineColor("command") }}>
          {typedText}
          {visibleLines <= 1 && (
            <span className="cursor-blink" style={{ color: "var(--cyan-400)" }}>▊</span>
          )}
        </div>

        {/* Remaining lines */}
        {TERMINAL_LINES.slice(1).map((line, i) => (
          <div
            key={i}
            className="transition-all duration-300"
            style={{
              color: getLineColor(line.className),
              opacity: i + 2 <= visibleLines ? 1 : 0,
              transform: i + 2 <= visibleLines ? "translateY(0)" : "translateY(8px)",
            }}
          >
            {line.text || "\u00A0"}
            {i === TERMINAL_LINES.length - 2 && visibleLines >= TERMINAL_LINES.length && (
              <span className="cursor-blink" style={{ color: "var(--cyan-400)" }}>▊</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
