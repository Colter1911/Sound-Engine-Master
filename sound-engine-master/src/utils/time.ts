/**
 * Get current server time (for sync calculations).
 * Uses Date.now() since Foundry VTT's game.time.serverTime
 * represents world time in seconds, not real-time clock.
 * For audio sync, all participants use Date.now() and
 * compensate for network latency via startTimestamp.
 */
export function getServerTime(): number {
  return Date.now();
}

/**
 * Calculate playback offset based on start time
 */
export function calculateOffset(startedAt: number, pausedAt: number = 0): number {
  if (pausedAt > 0) {
    return pausedAt;
  }
  return (getServerTime() - startedAt) / 1000;
}

/**
 * Format seconds to mm:ss
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}