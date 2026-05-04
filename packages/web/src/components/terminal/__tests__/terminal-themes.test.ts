import { describe, expect, it } from "vitest";
import { buildTerminalThemes } from "../terminal-themes";

describe("buildTerminalThemes", () => {
  it("returns a dark and light theme pair", () => {
    const { dark, light } = buildTerminalThemes("agent");
    expect(dark).toBeDefined();
    expect(light).toBeDefined();
  });

  it("dark theme uses the dark background and foreground", () => {
    const { dark } = buildTerminalThemes("agent");
    expect(dark.background).toBe("#0a0a0f");
    expect(dark.foreground).toBe("#d4d4d8");
    // cursorAccent should match the background so the cursor block is legible.
    expect(dark.cursorAccent).toBe("#0a0a0f");
  });

  it("light theme uses the light background and foreground", () => {
    const { light } = buildTerminalThemes("agent");
    expect(light.background).toBe("#fafafa");
    expect(light.foreground).toBe("#24292f");
    expect(light.cursorAccent).toBe("#fafafa");
  });

  it("uses the same accent cursor across dark and light", () => {
    const { dark, light } = buildTerminalThemes("agent");
    expect(dark.cursor).toBe("#5b7ef8");
    expect(light.cursor).toBe("#5b7ef8");
  });

  it("uses semi-transparent selection backgrounds tuned per theme", () => {
    const { dark, light } = buildTerminalThemes("agent");
    expect(dark.selectionBackground).toBe("rgba(91, 126, 248, 0.30)");
    expect(light.selectionBackground).toBe("rgba(91, 126, 248, 0.25)");
  });

  it("includes the full ANSI palette on both themes", () => {
    const { dark, light } = buildTerminalThemes("agent");
    const ansiKeys = [
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ] as const;
    for (const key of ansiKeys) {
      expect(typeof dark[key]).toBe("string");
      expect(typeof light[key]).toBe("string");
    }
  });

  it("returns the same palette regardless of variant (currently unified)", () => {
    // The variant parameter is preserved for future divergence; today both
    // variants resolve to the same colours.
    const agent = buildTerminalThemes("agent");
    const orchestrator = buildTerminalThemes("orchestrator");
    expect(agent.dark).toEqual(orchestrator.dark);
    expect(agent.light).toEqual(orchestrator.light);
  });

  it("returns fresh objects on each call (no shared mutable state)", () => {
    const a = buildTerminalThemes("agent");
    const b = buildTerminalThemes("agent");
    expect(a.dark).not.toBe(b.dark);
    expect(a.light).not.toBe(b.light);
  });
});
