"use client";

import { useEffect, useState } from "react";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText("npm i -g @aoagents/ao");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "nav-glass" : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="font-[family-name:var(--font-jetbrains)] text-lg font-bold tracking-wide">
          <span style={{ color: "var(--cyan-400)" }}>ao</span>
          <span style={{ color: "var(--text-muted)" }}>_</span>
          <span className="cursor-blink" style={{ color: "var(--cyan-400)" }}>
            |
          </span>
        </div>

        {/* Center links */}
        <div className="hidden md:flex items-center gap-8">
          {["Features", "Docs", "GitHub"].map((link) => (
            <a
              key={link}
              href={link === "GitHub" ? "https://github.com/ComposioHQ/agent-orchestrator" : `#${link.toLowerCase()}`}
              className="link-hover text-sm font-[family-name:var(--font-geist-sans)]"
              style={{ color: "var(--text-secondary)" }}
              target={link === "GitHub" ? "_blank" : undefined}
              rel={link === "GitHub" ? "noopener noreferrer" : undefined}
            >
              {link}
            </a>
          ))}
        </div>

        {/* Right CTA */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleCopy}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-[family-name:var(--font-jetbrains)] transition-all"
            style={{
              borderColor: "var(--border-default)",
              color: copied ? "var(--emerald-400)" : "var(--text-secondary)",
              background: "var(--bg-surface)",
            }}
          >
            <span>{copied ? "✓ Copied" : "npm i -g @aoagents/ao"}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M3 11V3a1 1 0 011-1h8" />
            </svg>
          </button>
          <a
            href="#get-started"
            className="px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: "var(--cyan-500)",
              color: "#fff",
            }}
          >
            Get Started
          </a>
        </div>
      </div>
    </nav>
  );
}
