"use client";

import { useEffect, useRef, useState } from "react";

const NODES = [
  { id: "spawning", x: 100, y: 60, color: "var(--text-muted)" },
  { id: "working", x: 300, y: 60, color: "var(--cyan-400)" },
  { id: "pr_open", x: 500, y: 60, color: "var(--amber-400)" },
  { id: "ci_failed", x: 200, y: 180, color: "var(--rose-400)" },
  { id: "review", x: 400, y: 180, color: "var(--amber-400)" },
  { id: "approved", x: 600, y: 180, color: "var(--emerald-400)" },
  { id: "merged", x: 400, y: 300, color: "var(--emerald-400)" },
  { id: "done", x: 400, y: 400, color: "var(--emerald-400)" },
];

export default function LifecycleDiagram() {
  const [progress, setProgress] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!sectionRef.current) return;
      const rect = sectionRef.current.getBoundingClientRect();
      const viewH = window.innerHeight;
      const start = viewH * 0.8;
      const end = -rect.height * 0.3;
      const raw = (start - rect.top) / (start - end);
      setProgress(Math.max(0, Math.min(1, raw)));
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const getNodeOpacity = (index: number) => {
    const threshold = index / NODES.length;
    return progress > threshold ? 1 : 0;
  };

  const getNodeScale = (index: number) => {
    const threshold = index / NODES.length;
    return progress > threshold ? 1 : 0.8;
  };

  return (
    <section ref={sectionRef} className="py-32 px-6">
      <div className="max-w-5xl mx-auto">
        <h2
          className="text-center font-[family-name:var(--font-jetbrains)] font-bold tracking-widest uppercase mb-4"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
            color: "var(--text-primary)",
          }}
        >
          AUTONOMOUS FROM SPAWN TO MERGE.
        </h2>
        <p
          className="text-center max-w-lg mx-auto mb-16 font-[family-name:var(--font-geist-sans)]"
          style={{ color: "var(--text-secondary)", fontSize: "1.125rem", lineHeight: 1.6 }}
        >
          Agents handle CI failures, review comments, and PR management.
          You intervene only when you want to.
        </p>

        {/* SVG Lifecycle Diagram */}
        <div className="relative mx-auto ambient-glow" style={{ maxWidth: 700 }}>
          <svg
            viewBox="0 0 700 460"
            className="w-full h-auto"
            style={{ overflow: "visible" }}
          >
            {/* Connection paths */}
            <g>
              {/* spawning → working */}
              <path
                d="M 150 60 L 250 60"
                fill="none"
                stroke="var(--border-bright)"
                strokeWidth="1.5"
                strokeDasharray="200"
                strokeDashoffset={200 - progress * 200 * 5}
                opacity={Math.min(progress * 5, 1)}
              />
              {/* working → pr_open */}
              <path
                d="M 350 60 L 450 60"
                fill="none"
                stroke="var(--border-bright)"
                strokeWidth="1.5"
                strokeDasharray="200"
                strokeDashoffset={200 - Math.max(0, (progress - 0.15) * 200 * 5)}
                opacity={Math.min(Math.max(0, (progress - 0.15)) * 5, 1)}
              />
              {/* pr_open → ci_failed */}
              <path
                d="M 480 90 L 250 160"
                fill="none"
                stroke="var(--rose-400)"
                strokeWidth="1.5"
                strokeDasharray="300"
                strokeDashoffset={300 - Math.max(0, (progress - 0.3) * 300 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.3)) * 4, 0.7)}
              />
              {/* pr_open → review */}
              <path
                d="M 500 90 L 400 160"
                fill="none"
                stroke="var(--amber-400)"
                strokeWidth="1.5"
                strokeDasharray="200"
                strokeDashoffset={200 - Math.max(0, (progress - 0.3) * 200 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.3)) * 4, 0.7)}
              />
              {/* pr_open → approved */}
              <path
                d="M 540 90 L 580 160"
                fill="none"
                stroke="var(--emerald-400)"
                strokeWidth="1.5"
                strokeDasharray="200"
                strokeDashoffset={200 - Math.max(0, (progress - 0.3) * 200 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.3)) * 4, 0.7)}
              />
              {/* All → merged */}
              <path
                d="M 230 210 Q 350 260 400 280"
                fill="none"
                stroke="var(--emerald-400)"
                strokeWidth="1.5"
                strokeDasharray="300"
                strokeDashoffset={300 - Math.max(0, (progress - 0.55) * 300 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.55)) * 4, 0.7)}
              />
              <path
                d="M 400 210 L 400 280"
                fill="none"
                stroke="var(--emerald-400)"
                strokeWidth="1.5"
                strokeDasharray="100"
                strokeDashoffset={100 - Math.max(0, (progress - 0.55) * 100 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.55)) * 4, 0.7)}
              />
              <path
                d="M 580 210 Q 480 260 400 280"
                fill="none"
                stroke="var(--emerald-400)"
                strokeWidth="1.5"
                strokeDasharray="300"
                strokeDashoffset={300 - Math.max(0, (progress - 0.55) * 300 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.55)) * 4, 0.7)}
              />
              {/* merged → done */}
              <path
                d="M 400 330 L 400 380"
                fill="none"
                stroke="var(--emerald-400)"
                strokeWidth="1.5"
                strokeDasharray="100"
                strokeDashoffset={100 - Math.max(0, (progress - 0.75) * 100 * 4)}
                opacity={Math.min(Math.max(0, (progress - 0.75)) * 4, 0.7)}
              />
            </g>

            {/* Nodes */}
            {NODES.map((node, i) => (
              <g
                key={node.id}
                style={{
                  opacity: getNodeOpacity(i),
                  transform: `scale(${getNodeScale(i)})`,
                  transformOrigin: `${node.x}px ${node.y}px`,
                  transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {/* Glow */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="35"
                  fill={node.color}
                  opacity="0.08"
                />
                {/* Box */}
                <rect
                  x={node.x - 50}
                  y={node.y - 18}
                  width="100"
                  height="36"
                  rx="6"
                  fill="var(--bg-surface)"
                  stroke={node.color}
                  strokeWidth="1"
                  opacity="0.9"
                />
                {/* Label */}
                <text
                  x={node.x}
                  y={node.y + 4}
                  textAnchor="middle"
                  fill={node.color}
                  fontSize="11"
                  fontFamily="var(--font-jetbrains), monospace"
                >
                  {node.id}
                </text>
              </g>
            ))}

            {/* Arrow markers */}
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-bright)" />
              </marker>
            </defs>
          </svg>
        </div>
      </div>
    </section>
  );
}
