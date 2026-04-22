"use client";

import { useEffect, useRef, useState } from "react";

const sessions = [
  { id: "aa-12", agent: "claude-code", status: "working", issue: "#42", statusColor: "var(--cyan-400)" },
  { id: "aa-13", agent: "codex", status: "pr_open", issue: "#43", statusColor: "var(--amber-400)" },
  { id: "aa-14", agent: "aider", status: "ci_failed", issue: "#44", statusColor: "var(--rose-400)" },
  { id: "aa-15", agent: "opencode", status: "merged", issue: "#45", statusColor: "var(--emerald-400)" },
  { id: "aa-16", agent: "claude-code", status: "review", issue: "#46", statusColor: "var(--amber-400)" },
  { id: "aa-17", agent: "codex", status: "working", issue: "#47", statusColor: "var(--cyan-400)" },
];

export default function DashboardPreview() {
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (!sectionRef.current) return;
      const rect = sectionRef.current.getBoundingClientRect();
      const viewH = window.innerHeight;
      const raw = (viewH - rect.top) / (viewH + rect.height);
      setScrollProgress(Math.max(0, Math.min(1, raw)));
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const tilt = 4 - scrollProgress * 4;

  return (
    <section ref={sectionRef} className="py-32 px-6 ambient-glow overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-center font-[family-name:var(--font-jetbrains)] font-bold tracking-widest uppercase mb-4"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
            color: "var(--text-primary)",
          }}
        >
          SEE EVERYTHING. CONTROL ANYTHING.
        </h2>
        <p
          className="text-center max-w-lg mx-auto mb-16 font-[family-name:var(--font-geist-sans)]"
          style={{ color: "var(--text-secondary)", fontSize: "1.125rem", lineHeight: 1.6 }}
        >
          A single dashboard to monitor all your agents, their PRs, CI status, and session lifecycle.
        </p>

        {/* Browser frame with dashboard mockup */}
        <div
          className="max-w-4xl mx-auto transition-all duration-700"
          style={{
            perspective: "1500px",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(60px)",
          }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              transform: `rotateX(${tilt}deg)`,
              transformOrigin: "center top",
              transition: "transform 0.1s linear",
              border: "1px solid var(--border-default)",
              boxShadow: "0 40px 80px rgba(0,0,0,0.5), 0 0 80px var(--cyan-glow)",
            }}
          >
            {/* Browser chrome */}
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{
                background: "var(--bg-elevated)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div className="w-3 h-3 rounded-full" style={{ background: "#f43f5e" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#f59e0b" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#10b981" }} />
              <div
                className="flex-1 mx-8 px-4 py-1 rounded-md text-xs font-[family-name:var(--font-geist-mono)]"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                localhost:3000/dashboard
              </div>
            </div>

            {/* Dashboard content */}
            <div style={{ background: "var(--bg-void)", padding: "20px" }}>
              {/* Dashboard header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <span
                    className="font-[family-name:var(--font-jetbrains)] font-bold text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Agent Orchestrator
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded font-[family-name:var(--font-geist-mono)]"
                    style={{
                      background: "var(--emerald-glow)",
                      color: "var(--emerald-400)",
                      border: "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    6 active sessions
                  </span>
                </div>
                <span
                  className="text-xs font-[family-name:var(--font-geist-mono)]"
                  style={{ color: "var(--text-muted)" }}
                >
                  project: ao-ahead
                </span>
              </div>

              {/* Session cards grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {sessions.map((session, i) => (
                  <div
                    key={session.id}
                    className="rounded-lg p-3 transition-all duration-500"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                      opacity: visible ? 1 : 0,
                      transitionDelay: `${600 + i * 100}ms`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: session.statusColor }}
                      />
                      <span
                        className="font-[family-name:var(--font-jetbrains)] text-xs font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {session.id}
                      </span>
                    </div>
                    <div
                      className="text-xs font-[family-name:var(--font-geist-mono)] mb-1"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {session.agent}
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className="text-xs font-[family-name:var(--font-geist-mono)]"
                        style={{ color: session.statusColor }}
                      >
                        {session.status}
                      </span>
                      <span
                        className="text-xs font-[family-name:var(--font-geist-mono)]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {session.issue}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
