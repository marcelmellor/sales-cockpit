'use client';

import { motion } from 'framer-motion';
import { getStageColor } from '@/lib/stage-colors';
import { formatDistanceToNow, format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';

interface DealSlideProps {
  deal: DealOverviewItem;
  index: number;
  total: number;
}

const childVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

export function DealSlide({ deal, index, total }: DealSlideProps) {
  const stageColor = getStageColor(deal.dealStage);

  const formattedMRR = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(deal.revenue);

  const nextAppointment = deal.nextAppointment
    ? {
        relative: formatDistanceToNow(new Date(deal.nextAppointment.date), {
          addSuffix: true,
          locale: de,
        }),
        absolute: format(new Date(deal.nextAppointment.date), 'dd. MMM yyyy, HH:mm', {
          locale: de,
        }),
        title: deal.nextAppointment.title,
      }
    : null;

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center px-16 relative">
      {/* Position indicator */}
      <motion.div
        custom={0}
        variants={childVariants}
        initial="hidden"
        animate="visible"
        className="absolute top-8 right-12 text-[var(--gray-dark-11)] text-lg tracking-wide"
        style={{ fontFamily: 'var(--font-primary)' }}
      >
        {index + 1} / {total}
      </motion.div>

      {/* Stage Badge */}
      <motion.div
        custom={0}
        variants={childVariants}
        initial="hidden"
        animate="visible"
      >
        <span
          className="inline-block px-5 py-2 rounded-full text-base font-medium tracking-wide mb-8"
          style={{
            backgroundColor: stageColor.bg,
            color: stageColor.text,
          }}
        >
          {deal.dealStage}
        </span>
      </motion.div>

      {/* Company Name */}
      <motion.h1
        custom={1}
        variants={childVariants}
        initial="hidden"
        animate="visible"
        className="text-7xl md:text-8xl text-white text-center leading-tight mb-12 max-w-[90vw]"
        style={{ fontFamily: 'var(--font-headline)' }}
      >
        {deal.companyName}
      </motion.h1>

      {/* Metric Cards */}
      <div className="flex items-stretch gap-8">
        {/* MRR */}
        <motion.div
          custom={2}
          variants={childVariants}
          initial="hidden"
          animate="visible"
          className="rounded-2xl px-10 py-6 text-center min-w-[200px]"
          style={{ backgroundColor: 'var(--gray-dark-3)' }}
        >
          <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--gray-dark-11)' }}>
            MRR
          </div>
          <div className="text-4xl font-bold" style={{ color: '#DEFF00', fontFamily: 'var(--font-primary)' }}>
            {formattedMRR}
          </div>
        </motion.div>

        {/* Deal Age */}
        <motion.div
          custom={3}
          variants={childVariants}
          initial="hidden"
          animate="visible"
          className="rounded-2xl px-10 py-6 text-center min-w-[200px]"
          style={{ backgroundColor: 'var(--gray-dark-3)' }}
        >
          <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--gray-dark-11)' }}>
            Deal-Alter
          </div>
          <div className="text-4xl font-bold text-white" style={{ fontFamily: 'var(--font-primary)' }}>
            {deal.dealAge}d
          </div>
        </motion.div>

        {/* Next Appointment */}
        <motion.div
          custom={4}
          variants={childVariants}
          initial="hidden"
          animate="visible"
          className="rounded-2xl px-10 py-6 text-center min-w-[200px]"
          style={{ backgroundColor: 'var(--gray-dark-3)' }}
        >
          <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--gray-dark-11)' }}>
            Nächster Termin
          </div>
          {nextAppointment ? (
            <div>
              <div className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-primary)' }}>
                {nextAppointment.relative}
              </div>
              <div className="text-sm mt-1" style={{ color: 'var(--gray-dark-11)' }}>
                {nextAppointment.absolute}
              </div>
            </div>
          ) : (
            <div className="text-2xl text-white" style={{ fontFamily: 'var(--font-primary)' }}>
              —
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
