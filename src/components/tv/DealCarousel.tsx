'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DealSlide } from './DealSlide';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';

interface DealCarouselProps {
  deals: DealOverviewItem[];
  intervalSeconds: number;
}

// Three transition variants that rotate
const easing = [0.25, 0.46, 0.45, 0.94] as const;

const transitions = [
  // Slide horizontal
  {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: '-100%', opacity: 0 },
    transition: { duration: 0.7, ease: easing },
  },
  // Fade + Scale
  {
    initial: { scale: 0.9, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    exit: { scale: 1.05, opacity: 0 },
    transition: { duration: 0.6, ease: easing },
  },
  // Blur Zoom
  {
    initial: { scale: 1.1, opacity: 0, filter: 'blur(10px)' },
    animate: { scale: 1, opacity: 1, filter: 'blur(0px)' },
    exit: { scale: 0.95, opacity: 0, filter: 'blur(10px)' },
    transition: { duration: 0.6, ease: easing },
  },
];

export function DealCarousel({ deals, intervalSeconds }: DealCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(Date.now());

  const advance = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % deals.length);
    setProgress(0);
    startTimeRef.current = Date.now();
  }, [deals.length]);

  // Auto-advance timer
  useEffect(() => {
    if (deals.length <= 1) return;

    const startTimers = () => {
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(advance, intervalSeconds * 1000);
      progressRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setProgress(Math.min(elapsed / (intervalSeconds * 1000), 1));
      }, 50);
    };

    const stopTimers = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTimers();
      } else {
        startTimers();
      }
    };

    startTimers();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopTimers();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [deals.length, intervalSeconds, advance]);

  // Keyboard navigation: space/right = next, left = previous
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowRight') {
        e.preventDefault();
        advance();
        // Reset auto-advance timer
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(advance, intervalSeconds * 1000);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setCurrentIndex((prev) => (prev - 1 + deals.length) % deals.length);
        setProgress(0);
        startTimeRef.current = Date.now();
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(advance, intervalSeconds * 1000);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advance, deals.length, intervalSeconds]);

  // Reset index when deals change
  useEffect(() => {
    setCurrentIndex(0);
    setProgress(0);
    startTimeRef.current = Date.now();
  }, [deals]);

  if (deals.length === 0) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <p className="text-2xl" style={{ color: 'var(--gray-dark-11)' }}>
          Keine Deals vorhanden
        </p>
      </div>
    );
  }

  const currentDeal = deals[currentIndex % deals.length];
  const transitionVariant = transitions[currentIndex % transitions.length];

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentDeal.id}
          initial={transitionVariant.initial}
          animate={transitionVariant.animate}
          exit={transitionVariant.exit}
          transition={transitionVariant.transition}
          className="absolute inset-0"
        >
          <DealSlide
            deal={currentDeal}
            index={currentIndex}
            total={deals.length}
          />
        </motion.div>
      </AnimatePresence>

      {/* Progress Bar */}
      {deals.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1">
          <motion.div
            className="h-full"
            style={{
              backgroundColor: '#DEFF00',
              width: `${progress * 100}%`,
              transition: 'width 50ms linear',
            }}
          />
        </div>
      )}
    </div>
  );
}
