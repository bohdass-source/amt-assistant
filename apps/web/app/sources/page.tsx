import type { Metadata } from 'next';
import { SourcesList } from '@/components/SourcesList';

export const metadata: Metadata = { title: 'Источники — Amt-Assistent' };

export default function SourcesPage() {
  return <SourcesList />;
}
