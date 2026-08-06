import { DisassemblyClient } from './DisassemblyClient';

export const metadata = {
  title: 'Subgraph Disassembly | Lodestar',
  description:
    'Fetch a deployed subgraph’s compiled WASM straight from IPFS and statically disassemble it: per-handler host-API reachability, a transparency scorecard, signal-weighted risk, and cross-version diffs.',
};

export default function DisassemblyPage() {
  return <DisassemblyClient />;
}
