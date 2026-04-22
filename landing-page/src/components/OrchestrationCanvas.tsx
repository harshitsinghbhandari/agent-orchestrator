"use client";

import { useEffect, useRef, useCallback } from "react";

interface AgentNode {
  label: string;
  angle: number;
  orbitA: number;
  orbitB: number;
  state: string;
  stateIndex: number;
  color: string;
}

interface Particle {
  agentIndex: number;
  t: number;
  speed: number;
  opacity: number;
}

const STATES = [
  { name: "spawning", color: "#6b7280" },
  { name: "working", color: "#06b6d4" },
  { name: "pr_open", color: "#f59e0b" },
  { name: "ci_failed", color: "#f43f5e" },
  { name: "review", color: "#fbbf24" },
  { name: "merged", color: "#10b981" },
];

const STATE_CYCLES: number[][] = [
  [1, 2, 5],       // claude-code: working → pr_open → merged
  [0, 1, 3, 1, 2], // codex: spawning → working → ci_failed → working → pr_open
  [1, 4, 1, 2, 5], // aider: working → review → working → pr_open → merged
  [1, 2, 4, 5],    // opencode: working → pr_open → review → merged
];

export default function OrchestrationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const animRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;
    const cy = H / 2;
    const time = Date.now() / 1000;
    const mouse = mouseRef.current;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background dot grid
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    const gridSpacing = 30;
    for (let x = gridSpacing; x < W; x += gridSpacing) {
      for (let y = gridSpacing; y < H; y += gridSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Agents
    const agents: AgentNode[] = [
      { label: "claude-code", angle: -Math.PI / 4, orbitA: W * 0.3, orbitB: H * 0.25, state: "", stateIndex: 0, color: "" },
      { label: "codex", angle: Math.PI / 4, orbitA: W * 0.32, orbitB: H * 0.22, state: "", stateIndex: 0, color: "" },
      { label: "aider", angle: (3 * Math.PI) / 4, orbitA: W * 0.28, orbitB: H * 0.28, state: "", stateIndex: 0, color: "" },
      { label: "opencode", angle: -(3 * Math.PI) / 4, orbitA: W * 0.3, orbitB: H * 0.24, state: "", stateIndex: 0, color: "" },
    ];

    // Update agent states
    agents.forEach((agent, i) => {
      const cycle = STATE_CYCLES[i];
      const stateIdx = Math.floor(time / 3) % cycle.length;
      agent.stateIndex = cycle[stateIdx];
      agent.state = STATES[agent.stateIndex].name;
      agent.color = STATES[agent.stateIndex].color;
    });

    // Agent positions
    const agentPositions = agents.map((agent) => {
      const wobble = Math.sin(time * 0.5 + agent.angle) * 3;
      return {
        x: cx + Math.cos(agent.angle) * (agent.orbitA + wobble),
        y: cy + Math.sin(agent.angle) * (agent.orbitB + wobble),
      };
    });

    // Draw connection lines
    agentPositions.forEach((pos, i) => {
      const agent = agents[i];
      const midX = (cx + pos.x) / 2 + Math.sin(time + i) * 15;
      const midY = (cy + pos.y) / 2 + Math.cos(time + i) * 15;

      // Mouse proximity check
      const lineMidDist = Math.hypot(mouse.x - midX, mouse.y - midY);
      const lineOpacity = lineMidDist < 80 ? 0.6 : 0.25;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(midX, midY, pos.x, pos.y);
      ctx.strokeStyle = agent.color;
      ctx.globalAlpha = lineOpacity;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -time * 20;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    // Draw particles along connections
    const particleCount = 6;
    agentPositions.forEach((pos, i) => {
      const agent = agents[i];
      const midX = (cx + pos.x) / 2 + Math.sin(time + i) * 15;
      const midY = (cy + pos.y) / 2 + Math.cos(time + i) * 15;

      for (let p = 0; p < particleCount; p++) {
        const t = ((time * 0.3 + p / particleCount + i * 0.15) % 1);
        const inv = 1 - t;
        const px = inv * inv * cx + 2 * inv * t * midX + t * t * pos.x;
        const py = inv * inv * cy + 2 * inv * t * midY + t * t * pos.y;
        const fadeIn = Math.min(t * 4, 1);
        const fadeOut = Math.min((1 - t) * 4, 1);
        const alpha = fadeIn * fadeOut * 0.7;

        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = agent.color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // Draw center node (AO)
    const centerDist = Math.hypot(mouse.x - cx, mouse.y - cy);
    const centerScale = centerDist < 60 ? 1.15 : 1;

    // Outer ring (pulsing)
    const ringAlpha = 0.3 + Math.sin(time * 2) * 0.25;
    ctx.beginPath();
    ctx.arc(cx, cy, 32 * centerScale, 0, Math.PI * 2);
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.globalAlpha = ringAlpha;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Center fill
    ctx.beginPath();
    ctx.arc(cx, cy, 22 * centerScale, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22 * centerScale);
    gradient.addColorStop(0, "#0891b2");
    gradient.addColorStop(1, "#06b6d4");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Center glow
    ctx.beginPath();
    ctx.arc(cx, cy, 40 * centerScale, 0, Math.PI * 2);
    const glowGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 40 * centerScale);
    glowGrad.addColorStop(0, "rgba(6,182,212,0.2)");
    glowGrad.addColorStop(1, "rgba(6,182,212,0)");
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Center label
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px var(--font-jetbrains), monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AO", cx, cy);

    // Draw agent nodes
    agentPositions.forEach((pos, i) => {
      const agent = agents[i];
      const dist = Math.hypot(mouse.x - pos.x, mouse.y - pos.y);
      const scale = dist < 60 ? 1.3 : 1;

      // Agent glow
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 24 * scale, 0, Math.PI * 2);
      const agentGlow = ctx.createRadialGradient(pos.x, pos.y, 4, pos.x, pos.y, 24 * scale);
      agentGlow.addColorStop(0, agent.color + "40");
      agentGlow.addColorStop(1, agent.color + "00");
      ctx.fillStyle = agentGlow;
      ctx.fill();

      // Agent circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 10 * scale, 0, Math.PI * 2);
      ctx.fillStyle = agent.color;
      ctx.fill();

      // Status ring
      if (agent.state === "working" || agent.state === "merged") {
        const statusAlpha = 0.3 + Math.sin(time * 3 + i) * 0.3;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 15 * scale, 0, Math.PI * 2);
        ctx.strokeStyle = agent.color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = statusAlpha;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Agent label
      ctx.fillStyle = "var(--text-secondary)";
      ctx.font = "10px var(--font-jetbrains), monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#8b8b96";
      ctx.fillText(agent.label, pos.x, pos.y + 22 * scale);

      // State label
      ctx.fillStyle = agent.color;
      ctx.font = "9px var(--font-geist-mono), monospace";
      ctx.fillText(agent.state, pos.x, pos.y + 34 * scale);
    });

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    canvas.addEventListener("mousemove", handleMouse);
    canvas.addEventListener("mouseleave", handleLeave);
    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener("mousemove", handleMouse);
      canvas.removeEventListener("mouseleave", handleLeave);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full canvas-container"
      style={{ maxWidth: 500, maxHeight: 500 }}
    />
  );
}
