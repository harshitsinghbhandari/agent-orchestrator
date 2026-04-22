"use client";

import { useState } from "react";

export default function CTAFooter() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText("npm install -g @aoagents/ao");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <footer id="get-started" className="py-32 px-6">
      <div className="max-w-3xl mx-auto text-center">
        {/* Big install command */}
        <h2
          className="font-[family-name:var(--font-jetbrains)] font-bold tracking-widest uppercase mb-8"
          style={{
            fontSize: "clamp(1.25rem, 3vw, 1.875rem)",
            color: "var(--text-primary)",
          }}
        >
          READY TO ORCHESTRATE?
        </h2>

        <div
          className="inline-flex items-center gap-4 px-8 py-5 rounded-lg cursor-pointer transition-all duration-300 hover:scale-[1.02]"
          onClick={handleCopy}
          style={{
            background: "var(--bg-terminal)",
            border: "1px solid var(--border-default)",
            boxShadow: "0 0 40px var(--cyan-glow), 0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <span
            className="font-[family-name:var(--font-jetbrains)] text-lg md:text-xl"
            style={{ color: "var(--text-muted)" }}
          >
            $
          </span>
          <span
            className="font-[family-name:var(--font-jetbrains)] text-lg md:text-xl"
            style={{ color: "var(--cyan-400)" }}
          >
            npm install -g @aoagents/ao
          </span>
          <button
            className="ml-4 p-2 rounded-md transition-all"
            style={{
              background: "var(--bg-elevated)",
              color: copied ? "var(--emerald-400)" : "var(--text-muted)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8.5l3 3 7-7" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="5" y="5" width="9" height="9" rx="1.5" />
                <path d="M3 11V3a1 1 0 011-1h8" />
              </svg>
            )}
          </button>
        </div>

        <p
          className="mt-4 text-sm font-[family-name:var(--font-geist-sans)]"
          style={{ color: "var(--text-muted)" }}
        >
          {copied ? "✓ Copied to clipboard!" : "Click to copy"}
        </p>

        {/* Links */}
        <div className="flex items-center justify-center gap-8 mt-16">
          <a
            href="https://github.com/ComposioHQ/agent-orchestrator"
            target="_blank"
            rel="noopener noreferrer"
            className="link-hover text-sm font-[family-name:var(--font-geist-sans)]"
            style={{ color: "var(--text-secondary)" }}
          >
            GitHub
          </a>
          <a
            href="#"
            className="link-hover text-sm font-[family-name:var(--font-geist-sans)]"
            style={{ color: "var(--text-secondary)" }}
          >
            Documentation
          </a>
          <a
            href="#"
            className="link-hover text-sm font-[family-name:var(--font-geist-sans)]"
            style={{ color: "var(--text-secondary)" }}
          >
            Discord
          </a>
        </div>

        {/* Footer meta */}
        <div
          className="mt-16 pt-8 flex items-center justify-center gap-4 text-xs font-[family-name:var(--font-geist-mono)]"
          style={{
            borderTop: "1px solid var(--border-subtle)",
            color: "var(--text-muted)",
          }}
        >
          <span>MIT License</span>
          <span style={{ color: "var(--text-ghost)" }}>·</span>
          <span>ComposioHQ</span>
          <span style={{ color: "var(--text-ghost)" }}>·</span>
          <span>Built for developers who ship fast</span>
        </div>
      </div>
    </footer>
  );
}
