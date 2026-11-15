import type { Metadata } from 'next';
import { Admin } from '@/components/Admin';

export const metadata: Metadata = { title: 'Админ — Amt-Assistent', robots: { index: false } };

export default function AdminPage() {
  return <Admin />;
}
