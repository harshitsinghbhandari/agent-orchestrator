# L7 Human Stub

## Concept
The simplest implementation of the Human Interaction layer. Uses the current `Notifier` plugins to asynchronously ping the user when execution completes or fails.

## Implementation Strategy
Already implemented via the `Notifier` plugin slot:
- Desktop notifications (`ao-plugin-notifier-desktop`)
- Slack/Webhook integrations

## Limitations vs. Full L7 Spec
- No interactive plan approval UI.
- No side-by-side semantic diff viewer for partial task approvals.
- Purely asynchronous push; no synchronous "ask human a question mid-execution" GUI.
