"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  {
    number: "01",
    title: "Configure",
    command: "ao init",
    description: "Generate agent-orchestrator.yaml with your project settings.",
  },
  {
    number: "02",
    title: "Spawn",
    command: "ao spawn --all",
    description: "Agents start working on issues in parallel, each in its own worktree.",
  },
  {
    number: "03",
    title: "Ship",
    command: "ao merge --ready",
    description: "Auto-merge approved PRs. Agents clean up their branches.",
  },
];

export default function HowItWorks() {
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
      { threshold: 0.3 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-32 px-6">
      <div className="max-w-5xl mx-auto">
        <h2
          className="text-center font-[family-name:var(--font-jetbrains)] font-bold tracking-widest uppercase mb-16"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
            color: "var(--text-primary)",
          }}
        >
          THREE COMMANDS. THAT&apos;S IT.
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connecting line (desktop only) */}
          <div
            className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px"
            style={{
              background: `linear-gradient(to right, var(--border-subtle), var(--cyan-500), var(--border-subtle))`,
              opacity: visible ? 0.5 : 0,
              transition: "opacity 1s ease",
            }}
          />

          {steps.map((step, i) => (
            <div
              key={step.number}
              className="text-center transition-all duration-700"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(30px)",
                transitionDelay: `${i * 200}ms`,
              }}
            >
              {/* Step number */}
              <div
                className="inline-flex items-center justify-center w-10 h-10 rounded-full mb-6 font-[family-name:var(--font-jetbrains)] text-sm font-bold"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--cyan-500)",
                  color: "var(--cyan-400)",
                  boxShadow: "0 0 20px var(--cyan-glow)",
                }}
              >
                {step.number}
              </div>

              {/* Title */}
              <h3
                className="font-[family-name:var(--font-jetbrains)] font-bold uppercase tracking-wide mb-4"
                style={{ color: "var(--text-primary)", fontSize: "1.125rem" }}
              >
                {step.title}
              </h3>

              {/* Command */}
              <div
                className="inline-block px-4 py-2 rounded-md mb-4 font-[family-name:var(--font-jetbrains)] text-sm"
                style={{
                  background: "var(--bg-terminal)",
                  border: "1px solid var(--border-default)",
                  color: "var(--cyan-400)",
                }}
              >
                $ {step.command}
              </div>

              {/* Description */}
              <p
                className="font-[family-name:var(--font-geist-sans)] text-sm"
                style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}
              >
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
