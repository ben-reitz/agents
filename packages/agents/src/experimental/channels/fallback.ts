import type { Channel } from "./channel";

/** Configuration for a channel with an availability-based fallback. */
export type FallbackChannelOptions = {
  primary: Channel;
  secondary: Channel;
};

/**
 * Compose two channels, selecting the secondary only when the primary reports
 * that it is unavailable before delivery begins.
 *
 * Once delivery is attempted on the primary, its result is final. Falling back
 * after an attempt could duplicate a delivery whose outcome is uncertain.
 */
export function fallback(options: FallbackChannelOptions): Channel {
  return {
    async isAvailable() {
      const primaryAvailable = await (options.primary.isAvailable?.() ?? true);
      return primaryAvailable
        ? true
        : (options.secondary.isAvailable?.() ?? true);
    },

    async deliver(message) {
      const primaryAvailable = await (options.primary.isAvailable?.() ?? true);
      return primaryAvailable
        ? options.primary.deliver(message)
        : options.secondary.deliver(message);
    }
  };
}
