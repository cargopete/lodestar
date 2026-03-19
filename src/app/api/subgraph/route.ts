import { NextRequest, NextResponse } from 'next/server';

// The Graph Network subgraph on Arbitrum One
// Requires a Graph API key from https://thegraph.com/studio/apikeys/
const SUBGRAPH_URL =
  'https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp';

// Mock data for development when no API key is available
const MOCK_NETWORK_DATA = {
  data: {
    graphNetwork: {
      totalTokensStaked: '2847293847293847293847293847',
      totalDelegatedTokens: '1234567890123456789012345678',
      totalTokensSignalled: '567890123456789012345678901',
      totalTokensAllocated: '1987654321098765432109876543',
      totalIndexingRewards: '9876543210987654321098765432',
      totalQueryFees: '123456789012345678901234567',
      currentEpoch: 1247,
      epochLength: 6646,
      lastLengthUpdateEpoch: 1000,
      lastLengthUpdateBlock: 45000000,
      indexerCount: 542,
      stakedIndexersCount: 178,
      delegatorCount: 12847,
      activeDelegatorCount: 9234,
      curatorCount: 3421,
      activeCuratorCount: 1256,
      subgraphCount: 8934,
      activeSubgraphCount: 1256,
      delegationRatio: 16,
      protocolFeePercentage: 10000,
      delegationTaxPercentage: 5000,
      maxAllocationEpochs: 28,
      thawingPeriod: 2419200
    },
    _meta: {
      block: {
        number: 46640000
      }
    },
  },
};

const MOCK_EPOCH_DATA = {
  data: {
    epoches: Array.from({ length: 20 }, (_, i) => ({
      id: String(1247 - i),
      startBlock: 45000000 - i * 6646,
      endBlock: 45000000 - i * 6646 + 6645,
      signalledTokens: String(BigInt('567890123456789012345678901') + BigInt(i * 1000000000000000000000000)),
      stakeDeposited: String(BigInt('2847293847293847293847293847') + BigInt(i * 5000000000000000000000000)),
      totalQueryFees: String(BigInt('123456789012345678') * BigInt(i + 1)),
      totalRewards: String(BigInt('9876543210987654321') * BigInt(i + 1)),
      totalIndexerRewards: String(BigInt('6543210987654321098') * BigInt(i + 1)),
      totalDelegatorRewards: String(BigInt('3333332223333333223') * BigInt(i + 1)),
    })),
  },
};

interface MockIndexer {
  id: string;
  account: { id: string; defaultDisplayName: string | null; metadata: { displayName: string | null; description: string | null } | null };
  stakedTokens: string;
  delegatedTokens: string;
  allocatedTokens: string;
  tokenCapacity: string;
  allocationCount: number;
  indexingRewardCut: number;
  queryFeeCut: number;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  rewardsEarned: string;
  delegatorShares: string;
  url: string | null;
  geoHash: string | null;
  createdAt: number;
}

const namedIndexers: MockIndexer[] = [
  {
    id: '0x1234567890abcdef1234567890abcdef12345678',
    account: { id: '0x1234567890abcdef1234567890abcdef12345678', defaultDisplayName: 'GraphOps', metadata: { displayName: null, description: 'GraphOps' } },
    stakedTokens: '5000000000000000000000000',
    delegatedTokens: '25000000000000000000000000',
    allocatedTokens: '20000000000000000000000000',
    tokenCapacity: '80000000000000000000000000',
    allocationCount: 45,
    indexingRewardCut: 100000,
    queryFeeCut: 100000,
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: 1700000000,
    rewardsEarned: '1000000000000000000000000',
    delegatorShares: '25000000000000000000000000',
    url: 'https://graphops.xyz',
    geoHash: 'u4pruydqqvj',
    createdAt: 1600000000,
  },
  {
    id: '0xabcdef1234567890abcdef1234567890abcdef12',
    account: { id: '0xabcdef1234567890abcdef1234567890abcdef12', defaultDisplayName: 'Stake.fish', metadata: { displayName: null, description: 'Stake.fish' } },
    stakedTokens: '4500000000000000000000000',
    delegatedTokens: '18000000000000000000000000',
    allocatedTokens: '15000000000000000000000000',
    tokenCapacity: '72000000000000000000000000',
    allocationCount: 38,
    indexingRewardCut: 120000,
    queryFeeCut: 100000,
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: 1700100000,
    rewardsEarned: '900000000000000000000000',
    delegatorShares: '18000000000000000000000000',
    url: 'https://stake.fish',
    geoHash: 'gcpvj0ebps',
    createdAt: 1600100000,
  },
  {
    id: '0x9876543210fedcba9876543210fedcba98765432',
    account: { id: '0x9876543210fedcba9876543210fedcba98765432', defaultDisplayName: 'P2P.org', metadata: { displayName: null, description: 'P2P.org' } },
    stakedTokens: '3800000000000000000000000',
    delegatedTokens: '15000000000000000000000000',
    allocatedTokens: '12000000000000000000000000',
    tokenCapacity: '60800000000000000000000000',
    allocationCount: 32,
    indexingRewardCut: 80000,
    queryFeeCut: 50000,
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: 1700200000,
    rewardsEarned: '750000000000000000000000',
    delegatorShares: '15000000000000000000000000',
    url: 'https://p2p.org',
    geoHash: 'ucfv0j848r',
    createdAt: 1600200000,
  },
];

const generatedIndexers: MockIndexer[] = Array.from({ length: 47 }, (_, i) => ({
  id: `0x${(i + 4).toString(16).padStart(40, '0')}`,
  account: { id: `0x${(i + 4).toString(16).padStart(40, '0')}`, defaultDisplayName: null, metadata: null },
  stakedTokens: String(BigInt(3000000 - i * 50000) * BigInt(10 ** 18)),
  delegatedTokens: String(BigInt(10000000 - i * 150000) * BigInt(10 ** 18)),
  allocatedTokens: String(BigInt(8000000 - i * 100000) * BigInt(10 ** 18)),
  tokenCapacity: String(BigInt(48000000 - i * 800000) * BigInt(10 ** 18)),
  allocationCount: Math.max(1, 30 - i),
  indexingRewardCut: 100000 + i * 5000,
  queryFeeCut: 100000,
  delegatorParameterCooldown: 0,
  lastDelegationParameterUpdate: 1700000000 + i * 10000,
  rewardsEarned: String(BigInt(500000 - i * 8000) * BigInt(10 ** 18)),
  delegatorShares: String(BigInt(10000000 - i * 150000) * BigInt(10 ** 18)),
  url: null,
  geoHash: null,
  createdAt: 1600000000 + i * 100000,
}));

const MOCK_INDEXERS_DATA = {
  data: {
    indexers: [...namedIndexers, ...generatedIndexers],
  },
};

// Mock data services (Horizon multi-service)
const MOCK_DATA_SERVICES = {
  data: {
    dataServices: [
      {
        id: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105', // SubgraphService on Arbitrum
        tokensProvisioned: '2500000000000000000000000000',
        tokensAllocated: '1987654321098765432109876543',
        provisionCount: 178,
        allocationCount: 2847,
        maxVerifierCut: 500000, // 50%
        thawingPeriod: 2419200, // 28 days in seconds
        registeredAt: 1700000000,
        metadata: {
          name: 'Subgraph Service',
          description: 'Index and query subgraphs on The Graph Network',
        },
      },
      {
        id: '0x1234567890abcdef1234567890abcdef12345679', // Substreams (hypothetical)
        tokensProvisioned: '150000000000000000000000000',
        tokensAllocated: '100000000000000000000000000',
        provisionCount: 42,
        allocationCount: 156,
        maxVerifierCut: 400000, // 40%
        thawingPeriod: 1209600, // 14 days in seconds
        registeredAt: 1710000000,
        metadata: {
          name: 'Substreams Service',
          description: 'High-performance streaming data extraction',
        },
      },
      {
        id: '0xabcdef1234567890abcdef1234567890abcdef13', // Token API (hypothetical)
        tokensProvisioned: '50000000000000000000000000',
        tokensAllocated: '35000000000000000000000000',
        provisionCount: 15,
        allocationCount: 45,
        maxVerifierCut: 300000, // 30%
        thawingPeriod: 604800, // 7 days in seconds
        registeredAt: 1715000000,
        metadata: {
          name: 'Token API Service',
          description: 'Real-time token data and analytics API',
        },
      },
    ],
  },
};

// Mock provisions for an indexer
const MOCK_INDEXER_PROVISIONS = {
  data: {
    provisions: [
      {
        id: '0x1234567890abcdef1234567890abcdef12345678-0xb2Bb92d0DE618878E438b55D5846cfecD9301105',
        tokens: '4500000000000000000000000',
        tokensThawing: '500000000000000000000000',
        sharesThawing: '490000000000000000000000',
        maxVerifierCut: 100000, // 10%
        thawingPeriod: 2419200,
        createdAt: 1700500000,
        dataService: {
          id: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105',
          metadata: {
            name: 'Subgraph Service',
            description: 'Index and query subgraphs on The Graph Network',
          },
          tokensProvisioned: '2500000000000000000000000000',
          tokensAllocated: '1987654321098765432109876543',
          thawingPeriod: 2419200,
        },
        thawRequests: [
          {
            id: 'thaw-1',
            shares: '250000000000000000000000',
            thawEndTimestamp: Math.floor(Date.now() / 1000) + 86400 * 14, // 14 days from now
          },
          {
            id: 'thaw-2',
            shares: '250000000000000000000000',
            thawEndTimestamp: Math.floor(Date.now() / 1000) + 86400 * 21, // 21 days from now
          },
        ],
      },
      {
        id: '0x1234567890abcdef1234567890abcdef12345678-0x1234567890abcdef1234567890abcdef12345679',
        tokens: '500000000000000000000000',
        tokensThawing: '0',
        sharesThawing: '0',
        maxVerifierCut: 80000, // 8%
        thawingPeriod: 1209600,
        createdAt: 1712000000,
        dataService: {
          id: '0x1234567890abcdef1234567890abcdef12345679',
          metadata: {
            name: 'Substreams Service',
            description: 'High-performance streaming data extraction',
          },
          tokensProvisioned: '150000000000000000000000000',
          tokensAllocated: '100000000000000000000000000',
          thawingPeriod: 1209600,
        },
        thawRequests: [],
      },
    ],
  },
};

// Mock provisions for a service
const MOCK_SERVICE_PROVISIONS = {
  data: {
    provisions: namedIndexers.map((indexer, i) => ({
      id: `${indexer.id}-0xb2Bb92d0DE618878E438b55D5846cfecD9301105`,
      tokens: String(BigInt(indexer.stakedTokens) * BigInt(90) / BigInt(100)),
      tokensThawing: i === 0 ? '500000000000000000000000' : '0',
      maxVerifierCut: indexer.indexingRewardCut,
      createdAt: indexer.createdAt + 100000,
      indexer: {
        id: indexer.id,
        account: indexer.account,
        stakedTokens: indexer.stakedTokens,
        delegatedTokens: indexer.delegatedTokens,
      },
    })),
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = body.query as string;

    // Use environment variable for API key
    const apiKey = process.env.GRAPH_API_KEY;

    if (apiKey) {
      // Use real subgraph
      const url = SUBGRAPH_URL.replace('[api-key]', apiKey);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Subgraph error response:', response.status, errorText);
        throw new Error(`Subgraph request failed: ${response.status}`);
      }

      const data = await response.json();

      // Check for GraphQL errors - fall through to mock data if errors
      if (data.errors) {
        console.error('GraphQL errors:', JSON.stringify(data.errors, null, 2));
      } else {
        return NextResponse.json(data, {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          },
        });
      }
    }

    // Return mock data for development
    console.log('No GRAPH_API_KEY found, using mock data');

    // Determine which mock data to return based on the query
    if (query.includes('graphNetwork')) {
      return NextResponse.json(MOCK_NETWORK_DATA, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    if (query.includes('epoches')) {
      return NextResponse.json(MOCK_EPOCH_DATA, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    if (query.includes('indexers')) {
      return NextResponse.json(MOCK_INDEXERS_DATA, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Delegator portfolio mock
    if (query.includes('delegator')) {
      const mockDelegator = {
        data: {
          delegator: {
            id: '0x0000000000000000000000000000000000000000',
            totalStakedTokens: '150000000000000000000000',
            totalUnstakedTokens: '10000000000000000000000',
            totalRealizedRewards: '8500000000000000000000',
            stakesCount: 3,
            activeStakesCount: 2,
            stakes: [
              {
                id: '0x0000000000000000000000000000000000000000-0x1234567890abcdef1234567890abcdef12345678',
                stakedTokens: '100000000000000000000000',
                shareAmount: '95000000000000000000000',
                lockedTokens: '0',
                lockedUntil: 0,
                realizedRewards: '5000000000000000000000',
                unstakedTokens: '0',
                createdAt: 1700000000,
                lastUndelegatedAt: null,
                indexer: {
                  id: '0x1234567890abcdef1234567890abcdef12345678',
                  account: {
                    id: '0x1234567890abcdef1234567890abcdef12345678',
                    defaultDisplayName: 'GraphOps',
                    metadata: { displayName: null, description: 'GraphOps' },
                  },
                  stakedTokens: '5000000000000000000000000',
                  delegatedTokens: '25000000000000000000000000',
                  delegatorShares: '24000000000000000000000000',
                  indexingRewardCut: 100000,
                  queryFeeCut: 100000,
                  delegatorParameterCooldown: 0,
                },
              },
              {
                id: '0x0000000000000000000000000000000000000000-0xabcdef1234567890abcdef1234567890abcdef12',
                stakedTokens: '50000000000000000000000',
                shareAmount: '48000000000000000000000',
                lockedTokens: '10000000000000000000000',
                lockedUntil: Math.floor(Date.now() / 1000) + 86400 * 14,
                realizedRewards: '3500000000000000000000',
                unstakedTokens: '10000000000000000000000',
                createdAt: 1705000000,
                lastUndelegatedAt: Math.floor(Date.now() / 1000) - 86400 * 7,
                indexer: {
                  id: '0xabcdef1234567890abcdef1234567890abcdef12',
                  account: {
                    id: '0xabcdef1234567890abcdef1234567890abcdef12',
                    defaultDisplayName: 'Stake.fish',
                    metadata: { displayName: null, description: 'Stake.fish' },
                  },
                  stakedTokens: '4500000000000000000000000',
                  delegatedTokens: '18000000000000000000000000',
                  delegatorShares: '17500000000000000000000000',
                  indexingRewardCut: 120000,
                  queryFeeCut: 100000,
                  delegatorParameterCooldown: 0,
                },
              },
            ],
          },
        },
      };
      return NextResponse.json(mockDelegator, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Curator portfolio mock
    if (query.includes('curator')) {
      const mockCurator = {
        data: {
          curator: {
            id: '0x0000000000000000000000000000000000000000',
            totalSignalledTokens: '25000000000000000000000',
            totalUnsignalledTokens: '5000000000000000000000',
            totalNameSignalledTokens: '0',
            totalNameUnsignalledTokens: '0',
            totalWithdrawnTokens: '0',
            realizedRewards: '1200000000000000000000',
            signalCount: 2,
            activeSignalCount: 1,
            signals: [
              {
                id: '0x0000000000000000000000000000000000000000-QmXyz123abc',
                signalledTokens: '20000000000000000000000',
                unsignalledTokens: '0',
                signal: '19500000000000000000000',
                lastSignalChange: 1710000000,
                realizedRewards: '1200000000000000000000',
                subgraphDeployment: {
                  id: 'QmXyz123abcdef456789',
                  ipfsHash: 'QmXyz123abcdef456789ghijkl',
                  signalledTokens: '500000000000000000000000',
                  queryFeesAmount: '25000000000000000000000',
                  stakedTokens: '1000000000000000000000000',
                },
              },
            ],
          },
        },
      };
      return NextResponse.json(mockCurator, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Data services mock
    if (query.includes('dataServices')) {
      return NextResponse.json(MOCK_DATA_SERVICES, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Indexer provisions mock
    if (query.includes('IndexerProvisions') || (query.includes('provisions') && query.includes('indexer:'))) {
      return NextResponse.json(MOCK_INDEXER_PROVISIONS, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Service provisions mock
    if (query.includes('ServiceProvisions') || (query.includes('provisions') && query.includes('dataService:'))) {
      return NextResponse.json(MOCK_SERVICE_PROVISIONS, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Single indexer detail mock
    if (query.includes('indexer(id:') || query.includes('IndexerDetails')) {
      const mockIndexerDetail = {
        data: {
          indexer: {
            id: '0x1234567890abcdef1234567890abcdef12345678',
            account: {
              id: '0x1234567890abcdef1234567890abcdef12345678',
              defaultDisplayName: 'GraphOps',
              metadata: { displayName: null, description: 'GraphOps' },
            },
            stakedTokens: '5000000000000000000000000',
            delegatedTokens: '25000000000000000000000000',
            allocatedTokens: '20000000000000000000000000',
            tokenCapacity: '80000000000000000000000000',
            allocationCount: 45,
            indexingRewardCut: 100000,
            queryFeeCut: 100000,
            rewardsEarned: '1500000000000000000000000',
            delegatorShares: '24500000000000000000000000',
            url: 'https://graphops.xyz',
            geoHash: 'u4pruydqqvj',
            createdAt: 1600000000,
            allocations: [
              {
                id: 'alloc-1',
                allocatedTokens: '5000000000000000000000000',
                createdAtEpoch: 1240,
                subgraphDeployment: {
                  id: 'QmSubgraph1',
                  signalledTokens: '100000000000000000000000',
                  stakedTokens: '500000000000000000000000',
                },
              },
              {
                id: 'alloc-2',
                allocatedTokens: '3000000000000000000000000',
                createdAtEpoch: 1235,
                subgraphDeployment: {
                  id: 'QmSubgraph2',
                  signalledTokens: '75000000000000000000000',
                  stakedTokens: '300000000000000000000000',
                },
              },
              {
                id: 'alloc-3',
                allocatedTokens: '2000000000000000000000000',
                createdAtEpoch: 1230,
                subgraphDeployment: {
                  id: 'QmSubgraph3',
                  signalledTokens: '50000000000000000000000',
                  stakedTokens: '200000000000000000000000',
                },
              },
            ],
            delegators: [
              {
                id: 'del-1',
                stakedTokens: '5000000000000000000000000',
                shareAmount: '4900000000000000000000000',
                delegator: { id: '0xaaa111222333444555666777888999aaabbbccc' },
              },
              {
                id: 'del-2',
                stakedTokens: '3000000000000000000000000',
                shareAmount: '2950000000000000000000000',
                delegator: { id: '0xbbb222333444555666777888999aaabbbcccddd' },
              },
              {
                id: 'del-3',
                stakedTokens: '2000000000000000000000000',
                shareAmount: '1960000000000000000000000',
                delegator: { id: '0xccc333444555666777888999aaabbbcccdddeee' },
              },
            ],
          },
        },
      };
      return NextResponse.json(mockIndexerDetail, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Default fallback
    return NextResponse.json(MOCK_NETWORK_DATA, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Subgraph proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from subgraph' },
      { status: 500 }
    );
  }
}
