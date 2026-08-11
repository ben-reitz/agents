import type { Channel } from "./channel";

/** A non-empty sequence of channels ordered from preferred to final fallback. */
export type FallbackChannelOptions = readonly [Channel, ...Channel[]];

async function isAvailable(channel: Channel): Promise<boolean> {
  return channel.isAvailable?.() ?? true;
}

/**
 * Compose channels in preference order, selecting the first available route.
 *
 * Once delivery is attempted on a channel, its result is final. Falling back
 * after an attempt could duplicate a delivery whose outcome is uncertain. The
 * final channel is always attempted so the composition produces a delivery
 * result even when every route reports unavailable.
 */
export function fallback(channels: FallbackChannelOptions): Channel {
  return {
    async isAvailable() {
      for (const channel of channels) {
        if (await isAvailable(channel)) return true;
      }
      return false;
    },

    async deliver(message) {
      for (let index = 0; index < channels.length - 1; index += 1) {
        const channel = channels[index];
        if (channel && (await isAvailable(channel))) {
          return channel.deliver(message);
        }
      }

      return channels[channels.length - 1].deliver(message);
    }
  };
}
