'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type AutoscrollStatus = 'idle' | 'running' | 'paused_by_user' | 'finished';

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function atBottom(): boolean {
  const el = document.scrollingElement ?? document.documentElement;
  return Math.ceil(window.scrollY + window.innerHeight) >= el.scrollHeight - 1;
}

/**
 * Window autoscroll (SPEC §8). Continuous at `speed` px/s; with
 * prefers-reduced-motion it advances in discrete page steps instead of
 * animating. Any manual scroll input (wheel, touch, navigation keys) stops
 * it so it never fights the player.
 */
export function useAutoscroll(speed: number) {
  const [status, setStatus] = useState<AutoscrollStatus>('idle');
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const start = useCallback(() => {
    setStatus(atBottom() ? 'finished' : 'running');
  }, []);
  const stop = useCallback(() => {
    setStatus('idle');
  }, []);
  const toggle = useCallback(() => {
    setStatus((current) => (current === 'running' ? 'idle' : atBottom() ? 'finished' : 'running'));
  }, []);

  useEffect(() => {
    if (status !== 'running') return undefined;
    const interrupt = () => {
      setStatus('paused_by_user');
    };
    const onKey = (event: KeyboardEvent) => {
      if (NAVIGATION_KEYS.has(event.key)) interrupt();
    };
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interrupt, { passive: true });
    window.addEventListener('keydown', onKey);

    let cancelled = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (prefersReducedMotion()) {
      // Discrete steps: move ~80% of a screen at the pace the speed implies.
      const step = () => {
        if (cancelled) return;
        const distance = Math.round(window.innerHeight * 0.8);
        window.scrollTo({ top: window.scrollY + distance, behavior: 'instant' });
        if (atBottom()) {
          setStatus('finished');
          return;
        }
        timer = setTimeout(step, (distance / Math.max(speedRef.current, 1)) * 1000);
      };
      timer = setTimeout(step, ((window.innerHeight * 0.8) / Math.max(speedRef.current, 1)) * 1000);
    } else {
      let last = performance.now();
      let carry = 0;
      const tick = (now: number) => {
        if (cancelled) return;
        carry += ((now - last) / 1000) * speedRef.current;
        last = now;
        const whole = Math.floor(carry);
        if (whole >= 1) {
          carry -= whole;
          window.scrollTo({ top: window.scrollY + whole, behavior: 'instant' });
        }
        if (atBottom()) {
          setStatus('finished');
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchstart', interrupt);
      window.removeEventListener('keydown', onKey);
    };
  }, [status]);

  return { status, reducedMotion, start, stop, toggle };
}
