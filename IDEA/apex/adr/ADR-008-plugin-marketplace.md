# ADR-008: Agentic Plugin Marketplace

## Status
Proposed

## Context
Tools must be manually loaded via configuration.

## Decision
Provide an autonomous marketplace where agents can search, evaluate, and install new MCP tools dynamically at runtime.

## Implementation
- **Affected files**: `packages/core/src/plugin-registry.ts`
- **Estimated effort**: 20-30d
- **Prerequisites**: None
- **Definition of done**: Agents auto-resolve capability gaps via the marketplace.

## Consequences
- **Positive**: Infinite capability expansion.
- **Negative**: Massive security surface.
- **Risks**: Malicious plugin injection.
