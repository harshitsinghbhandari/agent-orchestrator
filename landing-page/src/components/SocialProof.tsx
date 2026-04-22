"use client";

import { useEffect, useRef, useState } from "react";

const stats = [
  { label: "Sessions spawned", value: 500, suffix: "+" },
  { label: "Agent types", value: 4, suffix: "" },
  { label: "Plugin slots", value: 8, suffix: "" },
  { label: "Open source", value: 0, suffix: "MIT", isText: true },
];

export default function SocialProof() {
  const [visible, setVisible] = useState(false);
  const [counts, setCounts] = useState(stats.map(() => 0));
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    stats.forEach((stat, i) => {
      if (stat.isText) {
        setCounts((prev) => {
          const next = [...prev];
          next[i] = 1;
          return next;
        });
        return;
      }

      const duration = 1200;
      const steps = 30;
      const increment = stat.value / steps;
      let current = 0;
      const interval = setInterval(() => {
        current += increment;
        if (current >= stat.value) {
          current = stat.value;
          clearInterval(interval);
        }
        setCounts((prev) => {
          const next = [...prev];
          next[i] = Math.round(current);
          return next;
        });
      }, duration / steps);
    });
  }, [visible]);

  return (
    <section
      ref={sectionRef}
      className="py-16 px-6"
      style={{ borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div className="max-w-4xl mx-auto">
        <p
          className="text-center text-xs font-[family-name:var(--font-geist-mono)] uppercase tracking-widest mb-8"
          style={{ color: "var(--text-muted)" }}
        >
          Trusted by teams shipping with AI
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className="text-center transition-all duration-500"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(10px)",
                transitionDelay: `${i * 100}ms`,
              }}
            >
              <div
                className="font-[family-name:var(--font-jetbrains)] font-bold mb-1"
                style={{ color: "var(--cyan-400)", fontSize: "1.75rem" }}
              >
                {stat.isText ? stat.suffix : `${counts[i]}${stat.suffix}`}
              </div>
              <div
                className="text-xs font-[family-name:var(--font-geist-sans)]"
                style={{ color: "var(--text-secondary)" }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
