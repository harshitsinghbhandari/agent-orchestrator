import Nav from "@/components/Nav";
import ScrollProgress from "@/components/ScrollProgress";
import HeroTerminal from "@/components/HeroTerminal";
import HeroCanvas from "@/components/HeroCanvas";
import SocialProof from "@/components/SocialProof";
import AgentGrid from "@/components/AgentGrid";
import LifecycleDiagram from "@/components/LifecycleDiagram";
import PluginGrid from "@/components/PluginGrid";
import DashboardPreview from "@/components/DashboardPreview";
import HowItWorks from "@/components/HowItWorks";
import CTAFooter from "@/components/CTAFooter";

export default function Home() {
  return (
    <>
      <ScrollProgress />
      <Nav />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center pt-20 px-6 overflow-hidden">
        {/* Background ambient glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "10%",
            left: "20%",
            width: 700,
            height: 700,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
          aria-hidden="true"
        />
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: "5%",
            right: "10%",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(251,191,36,0.05) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
          aria-hidden="true"
        />

        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
          {/* Left — Text + Terminal */}
          <div>
            <h1
              className="font-[family-name:var(--font-jetbrains)] font-extrabold uppercase tracking-wider leading-none mb-6"
              style={{
                fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
                color: "var(--text-primary)",
                textShadow: "0 0 60px rgba(6,182,212,0.15)",
              }}
            >
              ORCHESTRATE
              <br />
              <span style={{ color: "var(--cyan-400)" }}>YOUR AGENTS.</span>
            </h1>

            <p
              className="font-[family-name:var(--font-geist-sans)] font-light mb-10 max-w-md"
              style={{
                color: "var(--text-secondary)",
                fontSize: "1.125rem",
                lineHeight: 1.7,
              }}
            >
              Spawn parallel AI agents. Each gets its own branch, its own PR,
              its own mind. You just watch the dashboard.
            </p>

            {/* CTA Buttons */}
            <div className="flex items-center gap-4 mb-12">
              <a
                href="#get-started"
                className="px-6 py-3 rounded-lg font-[family-name:var(--font-jetbrains)] text-sm font-medium transition-all hover:scale-[1.02]"
                style={{
                  background: "var(--cyan-500)",
                  color: "#fff",
                  boxShadow: "0 0 30px var(--cyan-glow)",
                }}
              >
                Get Started
              </a>
              <a
                href="https://github.com/ComposioHQ/agent-orchestrator"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 rounded-lg font-[family-name:var(--font-jetbrains)] text-sm transition-all"
                style={{
                  border: "1px solid var(--border-default)",
                  color: "var(--text-secondary)",
                  background: "var(--bg-surface)",
                }}
              >
                View on GitHub
              </a>
            </div>

            <HeroTerminal />
          </div>

          {/* Right — Orchestration Canvas */}
          <HeroCanvas />
        </div>
      </section>

      {/* Section separator */}
      <div className="section-separator" />

      <SocialProof />

      <div className="section-separator" />

      <AgentGrid />

      <div className="section-separator" />

      <LifecycleDiagram />

      <div className="section-separator" />

      <PluginGrid />

      <div className="section-separator" />

      <DashboardPreview />

      <div className="section-separator" />

      <HowItWorks />

      <div className="section-separator" />

      <CTAFooter />
    </>
  );
}
