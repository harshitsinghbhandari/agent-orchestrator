"use client";

import { useEffect, useRef, useState } from "react";

interface Agent {
  name: string;
  status: string;
  statusColor: string;
  glowColor: string;
  lines: string[];
}

const agents: Agent[] = [
  {
    name: "claude-code",
    status: "working",
    statusColor: "var(--cyan-400)",
    glowColor: "var(--cyan-glow)",
    lines: [
      "Reading lifecycle-manager.ts...",
      "Fixing state transition bug",
      "Running pnpm typecheck...",
      "✓ All checks pass",
    ],
  },
  {
    name: "codex",
    status: "pr_open",
    statusColor: "var(--amber-400)",
    glowColor: "var(--amber-glow)",
    lines: [
      "PR #48 opened: fix/ci-timeout",
      "Waiting for CI checks...",
      "● lint: passed",
      "● test: running...",
    ],
  },
  {
    name: "aider",
    status: "spawning",
    statusColor: "var(--text-muted)",
    glowColor: "var(--border-subtle)",
    lines: [
      "Creating worktree...",
      "Branch: session/aa-12",
      "Installing dependencies...",
      "Initializing agent...",
    ],
  },
  {
    name: "opencode",
    status: "merged ✓",
    statusColor: "var(--emerald-400)",
    glowColor: "var(--emerald-glow)",
    lines: [
      "PR #45 merged successfully",
      "Branch cleaned up",
      "Issue #39 auto-closed",
      "Session archived",
    ],
  },
];

export default function AgentGrid() {
  const [visible, setVisible] = useState(false);
  const [typedLines, setTypedLines] = useState<number[]>([0, 0, 0, 0]);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    const intervals = agents.map((_, i) => {
      let lineIdx = 0;
      return setInterval(() => {
        lineIdx++;
        setTypedLines((prev) => {
          const next = [...prev];
          next[i] = Math.min(lineIdx, agents[i].lines.length);
          return next;
        });
      }, 800 + i * 200);
    });

    return () => intervals.forEach(clearInterval);
  }, [visible]);

  return (
    <section ref={sectionRef} id="features" className="py-32 px-6">
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-center font-[family-name:var(--font-jetbrains)] font-bold tracking-widest uppercase mb-4"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
            color: "var(--text-primary)",
          }}
        >
          ONE COMMAND. PARALLEL EXECUTION.
        </h2>
        <p
          className="text-center max-w-lg mx-auto mb-16 font-[family-name:var(--font-geist-sans)]"
          style={{ color: "var(--text-secondary)", fontSize: "1.125rem", lineHeight: 1.6 }}
        >
          Four agents. Four branches. Four PRs. All from a single{" "}
          <code
            className="font-[family-name:var(--font-jetbrains)] px-1.5 py-0.5 rounded"
            style={{ background: "var(--bg-surface)", color: "var(--cyan-400)" }}
          >
            ao spawn
          </code>
          .
        </p>

        {/* 2x2 Grid with perspective */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
          style={{ perspective: "1200px" }}
        >
          {agents.map((agent, i) => (
            <div
              key={agent.name}
              className="terminal-card transition-all duration-700"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible
                  ? "rotateX(-2deg) rotateY(1deg)"
                  : "rotateX(-5deg) rotateY(2deg) translateY(40px)",
                transitionDelay: `${i * 150}ms`,
                borderColor: visible ? agent.glowColor : "var(--border-default)",
              }}
            >
              {/* Card header */}
              <div
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: agent.statusColor }}
                />
                <span
                  className="font-[family-name:var(--font-jetbrains)] text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {agent.name}
                </span>
                <span
                  className="ml-auto text-xs font-[family-name:var(--font-geist-mono)]"
                  style={{ color: agent.statusColor }}
                >
                  {agent.status}
                </span>
              </div>

              {/* Card body */}
              <div className="p-4 font-[family-name:var(--font-jetbrains)] text-xs leading-6">
                {agent.lines.map((line, li) => (
                  <div
                    key={li}
                    className="transition-all duration-300"
                    style={{
                      color: "var(--text-secondary)",
                      opacity: li < typedLines[i] ? 1 : 0,
                      transform: li < typedLines[i] ? "translateY(0)" : "translateY(4px)",
                    }}
                  >
                    <span style={{ color: "var(--text-ghost)", marginRight: 8 }}>
                      {li + 1}
                    </span>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
