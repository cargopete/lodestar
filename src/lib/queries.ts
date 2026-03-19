import { gql } from 'graphql-request';

// =============================================================================
// NETWORK QUERIES
// =============================================================================

/**
 * Network overview statistics (Horizon-aware)
 */
export const NETWORK_STATS_QUERY = gql`
  query NetworkStats {
    graphNetwork(id: "1") {
      totalTokensStaked
      totalDelegatedTokens
      totalTokensSignalled
      totalTokensAllocated
      totalIndexingRewards
      totalQueryFees
      currentEpoch
      epochLength
      lastLengthUpdateEpoch
      lastLengthUpdateBlock
      indexerCount
      stakedIndexersCount
      delegatorCount
      activeDelegatorCount
      curatorCount
      activeCuratorCount
      subgraphCount
      activeSubgraphCount
      delegationRatio
      protocolFeePercentage
      delegationTaxPercentage
      maxAllocationEpochs
      thawingPeriod
    }
  }
`;

/**
 * Epoch history for charts
 */
export const EPOCH_HISTORY_QUERY = gql`
  query EpochHistory($first: Int!) {
    epoches(first: $first, orderBy: startBlock, orderDirection: desc) {
      id
      startBlock
      endBlock
      signalledTokens
      stakeDeposited
      totalQueryFees
      totalRewards
      totalIndexerRewards
      totalDelegatorRewards
    }
  }
`;

/**
 * Top indexers for the directory
 */
export const INDEXERS_QUERY = gql`
  query Indexers($first: Int!, $skip: Int!, $orderBy: Indexer_orderBy!, $orderDirection: OrderDirection!) {
    indexers(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { stakedTokens_gt: "0" }
    ) {
      id
      account {
        id
        defaultDisplayName
        metadata {
          displayName
          description
        }
      }
      stakedTokens
      delegatedTokens
      allocatedTokens
      allocationCount
      indexingRewardCut
      queryFeeCut
      delegatorParameterCooldown
      lastDelegationParameterUpdate
      rewardsEarned
      delegatorShares
      url
      geoHash
      createdAt
    }
  }
`;

/**
 * Single indexer details
 */
export const INDEXER_DETAILS_QUERY = gql`
  query IndexerDetails($id: ID!) {
    indexer(id: $id) {
      id
      account {
        id
        defaultDisplayName
        metadata {
          displayName
          description
        }
      }
      stakedTokens
      delegatedTokens
      allocatedTokens
      tokenCapacity
      allocationCount
      indexingRewardCut
      queryFeeCut
      rewardsEarned
      delegatorShares
      url
      geoHash
      createdAt
      allocations(first: 100, where: { status: Active }) {
        id
        allocatedTokens
        createdAtEpoch
        subgraphDeployment {
          id
          signalledTokens
          stakedTokens
        }
      }
      delegators(first: 100) {
        id
        stakedTokens
        shareAmount
        delegator {
          id
        }
      }
    }
  }
`;

/**
 * Search indexers by address or name
 */
export const SEARCH_INDEXERS_QUERY = gql`
  query SearchIndexers($search: String!) {
    indexers(
      first: 20
      where: { id_contains_nocase: $search }
    ) {
      id
      account {
        id
        defaultDisplayName
        metadata {
          displayName
          description
        }
      }
      stakedTokens
      delegatedTokens
    }
  }
`;

// =============================================================================
// HORIZON-SPECIFIC QUERIES
// =============================================================================

/**
 * Indexers with Horizon fields
 */
export const INDEXERS_HORIZON_QUERY = gql`
  query IndexersHorizon($first: Int!, $skip: Int!, $orderBy: Indexer_orderBy!, $orderDirection: OrderDirection!) {
    indexers(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { stakedTokens_gt: "0" }
    ) {
      id
      account {
        id
        defaultDisplayName
        metadata {
          displayName
          description
        }
      }
      # Core staking
      stakedTokens
      delegatedTokens
      lockedTokens
      allocatedTokens
      tokenCapacity
      # Parameters
      indexingRewardCut
      queryFeeCut
      delegatorParameterCooldown
      lastDelegationParameterUpdate
      # Performance
      allocationCount
      rewardsEarned
      delegatorShares
      # Metadata
      url
      geoHash
      createdAt
    }
  }
`;

/**
 * Delegator portfolio - all delegations for an address
 */
export const DELEGATOR_PORTFOLIO_QUERY = gql`
  query DelegatorPortfolio($id: ID!) {
    delegator(id: $id) {
      id
      totalStakedTokens
      totalUnstakedTokens
      totalRealizedRewards
      stakesCount
      activeStakesCount
      stakes(first: 100, orderBy: stakedTokens, orderDirection: desc) {
        id
        stakedTokens
        shareAmount
        lockedTokens
        lockedUntil
        realizedRewards
        unstakedTokens
        createdAt
        lastUndelegatedAt
        indexer {
          id
          account {
            id
            defaultDisplayName
            metadata {
              displayName
              description
            }
          }
          stakedTokens
          delegatedTokens
          delegatorShares
          indexingRewardCut
          queryFeeCut
          delegatorParameterCooldown
            }
      }
    }
  }
`;

/**
 * Undelegation requests for a delegator (Horizon: up to 100 simultaneous)
 */
export const UNDELEGATION_REQUESTS_QUERY = gql`
  query UndelegationRequests($delegator: String!) {
    delegatedStakes(
      where: {
        delegator: $delegator,
        lockedTokens_gt: "0"
      }
      orderBy: lockedUntil
      orderDirection: asc
    ) {
      id
      lockedTokens
      lockedUntil
      indexer {
        id
        account {
          defaultDisplayName
          metadata {
            displayName
            description
          }
        }
      }
    }
  }
`;

/**
 * Indexer allocations with legacy flag
 */
export const INDEXER_ALLOCATIONS_QUERY = gql`
  query IndexerAllocations($indexer: String!, $first: Int!) {
    allocations(
      first: $first
      where: { indexer: $indexer, status: Active }
      orderBy: allocatedTokens
      orderDirection: desc
    ) {
      id
      allocatedTokens
      createdAtEpoch
      createdAtBlockHash
      closedAtEpoch
      status
      isLegacy
      poi
      subgraphDeployment {
        id
        ipfsHash
        signalledTokens
        stakedTokens
        queryFeesAmount
      }
    }
  }
`;

/**
 * Curator portfolio
 */
export const CURATOR_PORTFOLIO_QUERY = gql`
  query CuratorPortfolio($id: ID!) {
    curator(id: $id) {
      id
      totalSignalledTokens
      totalUnsignalledTokens
      totalNameSignalledTokens
      totalNameUnsignalledTokens
      totalWithdrawnTokens
      realizedRewards
      signalCount
      activeSignalCount
      signals(first: 100, orderBy: signalledTokens, orderDirection: desc) {
        id
        signalledTokens
        unsignalledTokens
        signal
        lastSignalChange
        realizedRewards
        subgraphDeployment {
          id
          ipfsHash
          signalledTokens
          queryFeesAmount
          stakedTokens
        }
      }
    }
  }
`;

/**
 * Effective cut calculation data for an indexer
 */
export const INDEXER_ECONOMICS_QUERY = gql`
  query IndexerEconomics($id: ID!) {
    indexer(id: $id) {
      id
      stakedTokens
      delegatedTokens
      delegatorShares
      indexingRewardCut
      queryFeeCut
      delegatorParameterCooldown
      lastDelegationParameterUpdate
      rewardsEarned
      # For effective cut calculation
      delegationExchangeRate
    }
  }
`;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// Query type definitions for TypeScript
export interface GraphNetwork {
  totalTokensStaked: string;
  totalDelegatedTokens: string;
  totalTokensSignalled: string;
  totalTokensAllocated: string;
  totalIndexingRewards: string;
  totalQueryFees: string;
  currentEpoch: number;
  epochLength: number;
  lastLengthUpdateEpoch: number;
  lastLengthUpdateBlock: number;
  indexerCount: number;
  stakedIndexersCount: number;
  delegatorCount: number;
  activeDelegatorCount: number;
  curatorCount: number;
  activeCuratorCount: number;
  subgraphCount: number;
  activeSubgraphCount: number;
  delegationRatio: number;
  protocolFeePercentage: number;
  delegationTaxPercentage: number;
  maxAllocationEpochs: number;
  thawingPeriod: number;
  // Optional fields for display compatibility
  indexingRewardPercentage?: number;
  queryFeeCut?: number;
  maxPOIStaleness?: string;
}

export interface Epoch {
  id: string;
  startBlock: number;
  endBlock: number;
  signalledTokens: string;
  stakeDeposited: string;
  totalQueryFees: string;
  totalRewards: string;
  totalIndexerRewards: string;
  totalDelegatorRewards: string;
}

export interface AccountMetadata {
  displayName?: string | null;
  description?: string | null;
}

export interface IndexerAccount {
  id: string;
  defaultDisplayName?: string | null;
  metadata?: AccountMetadata | null;
}

export interface Indexer {
  id: string;
  account: IndexerAccount;
  stakedTokens: string;
  delegatedTokens: string;
  allocatedTokens: string;
  tokenCapacity?: string;
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

export interface NetworkStatsResponse {
  graphNetwork: GraphNetwork;
  _meta?: {
    block: {
      number: number;
    };
  };
}

export interface EpochHistoryResponse {
  epoches: Epoch[];
}

export interface IndexersResponse {
  indexers: Indexer[];
}

// =============================================================================
// PROVISIONS QUERIES (Horizon Multi-Service)
// =============================================================================

/**
 * Data services registered in the protocol
 */
// DATA_SERVICES_QUERY - use inline fetch in api.ts instead of gql tagged template

/**
 * Provisions for a specific indexer (all services)
 */
// INDEXER_PROVISIONS_QUERY - use inline fetch in api.ts instead of gql tagged template

/**
 * All provisions for a data service
 */
// SERVICE_PROVISIONS_QUERY - use inline fetch in api.ts instead of gql tagged template

/**
 * Provision thaw requests
 */
// THAW_REQUESTS_QUERY - use inline fetch in api.ts instead of gql tagged template

// =============================================================================
// HORIZON TYPES
// =============================================================================

/**
 * Indexer with Horizon-specific fields
 */
export interface IndexerHorizon extends Indexer {
  lockedTokens: string;
}

/**
 * Delegated stake (delegation from delegator to indexer)
 */
export interface DelegatedStake {
  id: string;
  stakedTokens: string;
  shareAmount: string;
  lockedTokens: string;
  lockedUntil: number;
  realizedRewards: string;
  unstakedTokens: string;
  createdAt: number;
  lastUndelegatedAt: number | null;
  indexer: {
    id: string;
    account: IndexerAccount;
    stakedTokens: string;
    delegatedTokens: string;
    delegatorShares: string;
    indexingRewardCut: number;
    queryFeeCut: number;
    delegatorParameterCooldown: number;
    };
}

/**
 * Delegator entity
 */
export interface Delegator {
  id: string;
  totalStakedTokens: string;
  totalUnstakedTokens: string;
  totalRealizedRewards: string;
  stakesCount: number;
  activeStakesCount: number;
  stakes: DelegatedStake[];
}

/**
 * Undelegation request (thawing)
 */
export interface UndelegationRequest {
  id: string;
  lockedTokens: string;
  lockedUntil: number;
  indexer: {
    id: string;
    account: {
      defaultDisplayName?: string | null;
      metadata?: AccountMetadata | null;
    };
  };
}

/**
 * Allocation with Horizon fields
 */
export interface AllocationHorizon {
  id: string;
  allocatedTokens: string;
  createdAtEpoch: number;
  createdAtBlockHash: string;
  closedAtEpoch: number | null;
  status: 'Null' | 'Active' | 'Closed' | 'Finalized' | 'Claimed';
  isLegacy: boolean | null;
  poi: string | null;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
    signalledTokens: string;
    stakedTokens: string;
    queryFeesAmount: string;
  };
}

/**
 * Signal (curation position)
 */
export interface Signal {
  id: string;
  signalledTokens: string;
  unsignalledTokens: string;
  signal: string;
  lastSignalChange: number;
  realizedRewards: string;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
    signalledTokens: string;
    queryFeesAmount: string;
    stakedTokens: string;
  };
}

/**
 * Curator entity
 */
export interface Curator {
  id: string;
  totalSignalledTokens: string;
  totalUnsignalledTokens: string;
  totalNameSignalledTokens: string;
  totalNameUnsignalledTokens: string;
  totalWithdrawnTokens: string;
  realizedRewards: string;
  signalCount: number;
  activeSignalCount: number;
  signals: Signal[];
}

/**
 * Indexer economics for effective cut calculation
 */
export interface IndexerEconomics {
  id: string;
  stakedTokens: string;
  delegatedTokens: string;
  delegatorShares: string;
  indexingRewardCut: number;
  queryFeeCut: number;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  rewardsEarned: string;
  delegationExchangeRate: string | null;
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

export interface DelegatorPortfolioResponse {
  delegator: Delegator | null;
}

export interface CuratorPortfolioResponse {
  curator: Curator | null;
}

export interface IndexerAllocationsResponse {
  allocations: AllocationHorizon[];
}

export interface IndexerEconomicsResponse {
  indexer: IndexerEconomics | null;
}

export interface UndelegationRequestsResponse {
  delegatedStakes: UndelegationRequest[];
}

// =============================================================================
// PROVISIONS TYPES (Horizon Multi-Service)
// =============================================================================

/**
 * Data service metadata
 */
/**
 * Data service entity (e.g., SubgraphService, Substreams)
 */
export interface DataService {
  id: string;
  totalTokensProvisioned: string;
  totalTokensAllocated: string;
  totalTokensThawing: string;
  totalTokensDelegated: string;
  minimumProvisionTokens: string;
  maximumVerifierCut: string;
  minimumVerifierCut: string;
  minimumThawingPeriod: string;
  maximumThawingPeriod: string;
  delegationRatio: number | null;
  curationCut: string;
}

/**
 * Thaw request for a provision
 */
export interface ThawRequest {
  id: string;
  shares: string;
  tokens: string;
  thawingUntil: string;
  type: string;
  fulfilled: boolean;
}

/**
 * Provision entity - stake committed to a data service
 */
export interface Provision {
  id: string;
  tokensProvisioned: string;
  tokensAllocated: string;
  tokensThawing: string;
  maxVerifierCut: string;
  thawingPeriod: string;
  createdAt: string;
  allocationCount: number;
  dataService: {
    id: string;
    totalTokensProvisioned: string;
    totalTokensAllocated: string;
    minimumThawingPeriod: string;
    maximumThawingPeriod: string;
  };
}

/**
 * Provision with indexer info (for service directory)
 */
export interface ProvisionWithIndexer extends Omit<Provision, 'dataService'> {
  indexer: {
    id: string;
    account: {
      defaultDisplayName?: string | null;
      metadata?: AccountMetadata | null;
    };
    stakedTokens: string;
    delegatedTokens: string;
  };
}

// =============================================================================
// PROVISIONS RESPONSE TYPES
// =============================================================================

export interface DataServicesResponse {
  dataServices: DataService[];
}

export interface IndexerProvisionsResponse {
  provisions: Provision[];
}

export interface ServiceProvisionsResponse {
  provisions: ProvisionWithIndexer[];
}

export interface ThawRequestsResponse {
  thawRequests: ThawRequest[];
}
