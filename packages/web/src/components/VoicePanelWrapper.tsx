/**
 * VoicePanel wrapper that conditionally renders based on environment variable.
 *
 * This is a server component that checks NEXT_PUBLIC_AO_VOICE_ENABLED
 * and renders the client-side VoicePanel only if enabled.
 */

import { VoicePanel } from "./VoicePanel";

/**
 * Check if voice copilot is enabled via environment variable
 */
function isVoiceEnabled(): boolean {
  // NEXT_PUBLIC_ prefix makes it available on client side
  return process.env.NEXT_PUBLIC_AO_VOICE_ENABLED === "true";
}

/**
 * Wrapper component that conditionally renders VoicePanel
 */
export function VoicePanelWrapper() {
  if (!isVoiceEnabled()) {
    return null;
  }

  return <VoicePanel />;
}
