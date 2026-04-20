"use client";

import { useEffect, useRef, useState } from "react";

interface PluginSlot {
  name: string;
  icon: string;
  implementations: string[];
  active: string;
}

const plugins: PluginSlot[] = [
  { name: "Runtime", icon: "⚡", implementations: ["tmux", "process"], active: "tmux" },
  { name: "Agent", icon: "🤖", implementations: ["claude-code", "codex", "aider", "opencode"], active: "claude-code" },
  { name: "Workspace", icon: "📁", implementations: ["worktree", "clone"], active: "worktree" },
  { name: "Tracker", icon: "📋", implementations: ["github", "linear", "gitlab"], active: "github" },
  { name: "SCM", icon: "🔀", implementations: ["github", "gitlab"], active: "github" },
  { name: "Notifier", icon: "🔔", implementations: ["desktop", "slack", "webhook"], active: "desktop" },
  { name: "Terminal", icon: "🖥️", implementations: ["iterm2", "web"], active: "iterm2" },
  { name: "Lifecycle", icon: "🔄", implementations: ["core (built-in)"], active: "core" },
];

export default function PluginGrid() {
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-32 px-6">
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-center font-[family-name:var(--font-jetbrains)] font-bold tracking-widest uppercase mb-4"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
            color: "var(--text-primary)",
          }}
        >
          PLUG IN. SWAP OUT. SHIP.
        </h2>
        <p
          className="text-center max-w-lg mx-auto mb-16 font-[family-name:var(--font-geist-sans)]"
          style={{ color: "var(--text-secondary)", fontSize: "1.125rem", lineHeight: 1.6 }}
        >
          8 extension points. Mix and match runtimes, agents, trackers, and notifiers.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plugins.map((plugin, i) => (
            <div
              key={plugin.name}
              className="plugin-card transition-all duration-500"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(30px)",
                transitionDelay: `${i * 80}ms`,
              }}
            >
              {/* Icon + name */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xl">{plugin.icon}</span>
                <span
                  className="font-[family-name:var(--font-jetbrains)] font-medium text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  {plugin.name}
                </span>
              </div>

              {/* Implementations */}
              <div
                className="text-xs font-[family-name:var(--font-geist-mono)] mb-4"
                style={{ color: "var(--text-muted)" }}
              >
                {plugin.implementations.join(" · ")}
              </div>

              {/* Active badge */}
              <div
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-xs font-[family-name:var(--font-jetbrains)]"
                style={{
                  background: "var(--cyan-glow)",
                  color: "var(--cyan-400)",
                  border: "1px solid rgba(6,182,212,0.2)",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full pulse-ring"
                  style={{ background: "var(--cyan-400)" }}
                />
                {plugin.active}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
