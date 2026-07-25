"use client";

import { useEffect, useState } from "react";
import type { LandingReplayItem } from "@/pipeline/overlay/landingReplayItem";

// ---------------------------------------------------------------------------
// useReplayImages — decoding the playlist's embedded backdrops in play order.
//
// Every item carries two base64 WebPs (a video-space wall still and a Route
// Photo), and the whole playlist arrives in one fetch — that is a curation-PRD
// invariant and this hook does not reopen it. What it does own is *when* each of
// those bitmaps is turned into something paintable.
//
// Decoding them all the moment the playlist resolves is what this replaces. With
// one clip that was two decodes; with three it is six, and the two that gate the
// opening frame end up competing with four that will not be seen for twelve
// seconds. So the decodes run as a chain in play order instead: item 0's pair
// first, and each later item only once the one before it has settled.
//
// That is enough to also keep an item ready before its own slot opens, without
// this hook having to watch the clock. Item N's decode starts behind at most N-1
// others, and each slot is REPLAY_ANIMATION_SECONDS long — twelve seconds of
// head start per position, against decodes measured in tens of milliseconds. The
// chain is far enough ahead of the playhead that gating it on the clock would
// only be a more complicated way to reach the same state.
//
// Nothing here is load-bearing for playback. An item whose decode is still in
// flight, has failed, or was never authored with a wall still plays exactly the
// same, against the dark stage — the renderer composes a missing backdrop as an
// absent one, not as an error.
// ---------------------------------------------------------------------------

/**
 * One item's decoded backdrops. Either may be absent — a decode in flight, a
 * decode that failed, or an item authored without a wall still — and the
 * renderer composes the frame the same way regardless.
 */
export interface ItemImages {
  /** The video-space wall still, drawn in the source plane through phases 1-3. */
  frame?: HTMLImageElement;
  /** The Route Photo, drawn in the photo plane from phase 3 on. */
  photo?: HTMLImageElement;
}

/**
 * Load one embedded WebP and resolve once it is genuinely ready to paint, or
 * with `null` if it never will be.
 *
 * `decode()` is the call that means what this hook is about: `onload` promises
 * only that the bytes arrived, leaving the actual bitmap decode to happen
 * synchronously inside the first `drawImage` — on the animation frame, on the
 * main thread. Where it exists we wait for it, so "decoded before its slot
 * opens" is literal. Where it does not (older browsers, jsdom) `onload` is the
 * best signal available and the ordering still holds.
 *
 * Failure resolves rather than rejects: a backdrop that cannot be decoded is a
 * dark stage behind that one clip, and — just as importantly — it must not
 * strand the items queued behind it.
 */
function decodeImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    if (typeof img.decode === "function") {
      img.src = src;
      img.decode().then(
        () => resolve(img),
        () => resolve(null),
      );
      return;
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Decode the playlist's backdrops in play order, publishing each one as it
 * lands.
 *
 * Keyed by item id rather than index, so a decode can never be applied to the
 * wrong clip and there is nothing to reset when the playlist arrives.
 *
 * `items` is the identity the chain is keyed on: a caller that rebuilds the
 * array every render restarts it from item 0 each time. The hero holds its
 * playlist in state and sets it once, which is the shape this expects.
 */
export function useReplayImages(items: readonly LandingReplayItem[]): Record<string, ItemImages> {
  const [images, setImages] = useState<Record<string, ItemImages>>({});

  useEffect(() => {
    if (items.length === 0) return;
    let mounted = true;

    const publish = (id: string, slot: keyof ItemImages, img: HTMLImageElement | null) => {
      if (!mounted || !img) return;
      setImages((prev) => ({ ...prev, [id]: { ...prev[id], [slot]: img } }));
    };

    void (async () => {
      for (const item of items) {
        if (!mounted) return;
        // An item's own two backdrops decode together. Both belong to the clip
        // that is about to play, and deferring one behind the other would only
        // defer that clip against itself.
        await Promise.all([
          decodeImage(item.photo.webp).then((img) => publish(item.id, "photo", img)),
          item.source.webp
            ? decodeImage(item.source.webp).then((img) => publish(item.id, "frame", img))
            : Promise.resolve(),
        ]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [items]);

  return images;
}
