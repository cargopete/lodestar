import { NextResponse } from 'next/server';
import { NetworksRegistry } from '@pinax/graph-networks-registry';
import { cached } from '@/lib/cache';

export interface NetworkInfo {
  id: string;
  shortName: string;
  fullName: string;
  networkType: 'mainnet' | 'testnet' | 'devnet' | 'beacon';
  iconUrl: string | null;
  aliases: string[];
}

const WEB3_ICONS_BASE =
  'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded';

export async function GET() {
  try {
    const networks = await cached<NetworkInfo[]>('lodestar:networks-registry', 86400, async () => {
      const reg = await NetworksRegistry.fromLatestVersion();
      return reg.networks.map((n): NetworkInfo => {
        const iconName = n.icon?.web3Icons?.name;
        return {
          id: n.id,
          shortName: n.shortName ?? n.id,
          fullName: n.fullName ?? n.shortName ?? n.id,
          networkType: n.networkType as NetworkInfo['networkType'],
          iconUrl: iconName ? `${WEB3_ICONS_BASE}/${iconName}.svg` : null,
          aliases: n.aliases ?? [],
        };
      });
    });

    return NextResponse.json({ networks }, {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800',
      },
    });
  } catch (error) {
    console.error('Networks registry error:', error);
    return NextResponse.json({ error: 'Failed to fetch networks registry' }, { status: 500 });
  }
}
