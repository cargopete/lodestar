import type { Metadata } from 'next';
import { DisassemblyClient } from '../DisassemblyClient';
import { loadShareReport } from '@/lib/disassembly/share';
import { formatGRT } from '@/lib/utils';

function short(hash: string): string {
  return hash.length > 15 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}): Promise<Metadata> {
  const { deploymentId } = await params;
  const data = await loadShareReport(deploymentId);

  if (!data) {
    return {
      title: 'Subgraph Disassembly | Lodestar',
      description: 'Static disassembly and transparency scorecard for a deployed subgraph.',
    };
  }

  const { report, signal } = data;
  const { scorecard, totals } = report;
  const flagCount = scorecard.flags.filter((f) => f.level !== 'info').length;
  const hosts = totals.hostCategories.join(', ') || 'none';
  const signalStr = signal && signal.signalledGRT > 0 ? ` · ${formatGRT(signal.signalledGRT)} GRT signalled` : '';

  const title = `Subgraph ${short(deploymentId)} · Grade ${scorecard.grade} · risk ${scorecard.riskScore} | Lodestar`;
  const description =
    `Static disassembly: ${totals.handlers} handlers across ${totals.dataSources} data source(s). ` +
    `Host APIs: ${hosts}. ${flagCount} risk flag(s)${signalStr}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function DisassemblyDeploymentPage({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const { deploymentId } = await params;
  return <DisassemblyClient initialId={deploymentId} />;
}
