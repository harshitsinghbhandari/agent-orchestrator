---
title: Dashboard Attention Projection
discoveredIn: aa-1
updated: 2026-04-13T00:00:00.000Z
relatedFlows:
  - liveness-detection-architecture
  - session-spawn-flow
---

## Overview

The dashboard does not render raw lifecycle status directly. It projects sessions into human-priority buckets such as merge, respond, review, pending, working, and done. That projection lives mostly in `packages/web/src/lib/types.ts` and is tightly coupled to the current overloaded backend state model.

## Primary Entry Point

**Location:** `packages/web/src/lib/types.ts`

`getAttentionLevel(session)` combines:

- `session.status`
- `session.activity`
- PR state
- CI summary
- review decision
- mergeability

into a single attention bucket.

## Current Attention Levels

The current buckets are:

- `merge`
- `respond`
- `review`
- `pending`
- `working`
- `done`

These are useful for the UI, but they are projections, not durable backend truth.

## Current Derivation Rules

### Done

First priority:

- terminal lifecycle statuses such as `merged`, `killed`, `cleanup`, `done`, `terminated`
- PR state `merged` or `closed`

### Merge

Next priority:

- lifecycle `mergeable` or `approved`
- PR mergeability saying all requirements are satisfied

### Respond

Next priority:

- lifecycle `errored`, `needs_input`, `stuck`
- activity `waiting_input`, `blocked`, or `exited`

### Review

Next priority:

- lifecycle `ci_failed`, `changes_requested`
- PR CI failing
- PR conflicts

### Pending

Next priority:

- lifecycle `review_pending`
- PR unresolved threads or pending review

### Working

Fallback:

- anything else

## Why This Is Important

The dashboard is currently compensating for ambiguity in backend state:

- `needs_input` is treated as both lifecycle phase and attention state
- `stuck` is treated as a lifecycle phase even though it really means “please inspect”
- `activity === "exited"` is treated as a respond-worthy crash even when the root cause may be false liveness detection

That means UI semantics are coupled to backend modeling mistakes.

## Secondary Consumers

Attention-like assumptions also leak into:

- `packages/web/src/components/SessionCard.tsx`
- `packages/web/src/components/SessionDetail.tsx`
- `packages/web/src/components/BottomSheet.tsx`
- `packages/web/src/lib/serialize.ts`

Examples:

- working-session counts exclude `activity === "exited"`
- terminal-style pills and labels are chosen partly from activity, partly from status
- some “done” presentation paths assume terminality from mixed sources

## Structural Problem

The UI currently infers three separate questions from the same fields:

1. Is the session alive?
2. What workflow phase is it in?
3. Does a human need to do something?

That works only because the backend mixes all three into `status` and `activity`. Once the backend is redesigned, the dashboard should project from separate fact domains instead:

- workflow phase
- attention reasons
- liveness result
- termination reason

## Recommended Future Split

If the backend exposes richer facts, the dashboard should derive attention using this order:

1. terminal outcomes with explicit reason
2. human-input / blocked reasons
3. review / CI / conflict reasons
4. merge-readiness
5. passive monitoring for healthy running work

This would let the UI stay simple while depending on cleaner semantics.

## Why This Flow Should Exist in Atlas

Anyone changing status semantics or fixing liveness bugs will eventually run into dashboard behavior. This flow documents how the UI currently converts backend ambiguity into operator priority, which makes it easier to evaluate whether a backend change will actually improve what humans see.
