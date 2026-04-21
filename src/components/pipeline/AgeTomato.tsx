import Image from 'next/image';

// Gemeinsame Tomaten-Alterslogik für Deals und Leads. Schwellen:
// ≤ 14 Tage frisch, ≤ 45 Tage halb frisch, > 45 Tage alt.
export function getAgeIcon(days: number): { src: string; alt: string } {
  if (days <= 14) return { src: '/tomato-fresh.svg', alt: 'Frisch' };
  if (days <= 45) return { src: '/tomato-half-fresh.svg', alt: 'Halb frisch' };
  return { src: '/tomato-rotten.svg', alt: 'Alt' };
}

interface AgeTomatoProps {
  days: number;
  size?: number;
}

export function AgeTomato({ days, size = 28 }: AgeTomatoProps) {
  const { src, alt } = getAgeIcon(days);
  return <Image src={src} alt={alt} width={size} height={size} />;
}
