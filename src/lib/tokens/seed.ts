import type { TokenSeed } from './types';

/**
 * v0 seed list. Each entry maps a token to its canonical Uniswap V3 pool
 * for price discovery. Pools chosen for liquidity, not the lowest fee tier.
 *
 * The Token API has no top-tokens leaderboard endpoint, so a v1 seed list is
 * a hard requirement until we either (a) maintain a contract list per chain
 * or (b) discover hot tokens by aggregating swaps server-side.
 */
export const TOKEN_SEEDS: TokenSeed[] = [
  // Reference pool: WETH priced in USDC (used to compute eth-quoted prices)
  {
    contract: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    symbol: 'WETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 USDC/WETH 0.05%
      address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'eth',
    website: 'https://weth.io',
    tags: ['Wrapped'],
    altContracts: {
      arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      base: '0x4200000000000000000000000000000000000006',
      polygon: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    },
  },
  {
    contract: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'WBTC',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 WBTC/USDC 0.3%
      address: '0x99ac8ca7087fa4a2a1fb6357269965a2014abc35',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'wbtc',
    website: 'https://wbtc.network',
    tags: ['Wrapped'],
    altContracts: {
      arbitrum: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
      polygon: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
    },
  },
  {
    contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    chain: 'mainnet',
    // For stablecoins the WETH/stable pool is useless for sparklines (it
    // tracks ETH inverse, not peg variance). Use a stable-vs-stable pool
    // instead. USDC/DAI 0.01% on Uniswap V3: token0=DAI, token1=USDC,
    // close ≈ USDC-per-DAI, so inverse=true gives DAI-per-USDC ≈ USDC's
    // approximate USD value. Both legs peg to USD so peg drift surfaces.
    pool: {
      address: '0x5777d92f208679db4b9778590fa3cab3ac9e2168',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'usdc',
    website: 'https://www.circle.com/usdc',
    tags: ['Stablecoin'],
    altContracts: {
      arbitrum: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      polygon: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    },
  },
  {
    contract: '0xc944e90c64b2c07662a292be6244bdf05cda44a7',
    symbol: 'GRT',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 WETH/GRT 0.3%
      address: '0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'grt',
    website: 'https://thegraph.com',
    tags: ['Infrastructure', 'Governance'],
    altContracts: {
      arbitrum: '0x9623063377ad1b27544c965ccd7342f7ea7e88c7',
    },
  },
  // stETH dropped from v0: Uniswap V3 liquidity is thin and the right
  // canonical source is the Lido subgraph (already on /protocols).
  // Re-add once we wire the Lido subgraph into the fetcher.
  {
    contract: '0x514910771af9ca656af840dff83e8264ecf986ca',
    symbol: 'LINK',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 LINK/WETH 0.3%
      address: '0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'link',
    website: 'https://chain.link',
    tags: ['Oracle'],
    altContracts: {
      arbitrum: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4',
      base: '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196',
      polygon: '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39',
    },
  },
  {
    contract: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    symbol: 'UNI',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 UNI/WETH 0.3%
      address: '0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'uni',
    website: 'https://uniswap.org',
    tags: ['DEX', 'Governance'],
    altContracts: {
      arbitrum: '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0',
      polygon: '0xb33eaad8d922b1083446dc23f610c2567fb5180f',
    },
  },
  {
    contract: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    symbol: 'AAVE',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 AAVE/WETH 0.3%
      address: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'aave',
    website: 'https://aave.com',
    tags: ['Lending', 'Governance'],
    altContracts: {
      arbitrum: '0xba5ddd1f9d7f570dc94a51479a000e3bce967196',
      base: '0xa88594d404727625a9437c3f886c7643872296ae',
      polygon: '0xd6df932a45c0f255f85145f286ea0b292b21c90b',
    },
  },
  {
    contract: '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
    symbol: 'LDO',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 LDO/WETH 0.3%
      address: '0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ldo',
    website: 'https://lido.fi',
    tags: ['LST', 'Governance'],
    altContracts: {
      arbitrum: '0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60',
      polygon: '0xc3c7d422809852031b44ab29eec9f1eff2a58756',
    },
  },
  {
    contract: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    symbol: 'PEPE',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 PEPE/WETH 0.3%
      address: '0x11950d141ecb863f01007add7d1a342041227b58',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'pepe',
    website: 'https://www.pepe.vip',
    tags: ['Memecoin'],
  },
  {
    contract: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
    symbol: 'MKR',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 MKR/WETH 0.3%
      address: '0xe8c6c9227491c0a8156a0106a0204d881bb7e531',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'mkr',
    website: 'https://makerdao.com',
    tags: ['Lending', 'Governance'],
  },
  {
    contract: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72',
    symbol: 'ENS',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 WETH/ENS 0.3% (WETH < ENS by address, so ENS is token1)
      address: '0x92560c178ce069cc014138ed3c2f5221ba71f58a',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'ens',
    website: 'https://ens.domains',
    tags: ['Identity', 'Governance'],
  },
  {
    contract: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    symbol: 'COMP',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 COMP/WETH 0.3%
      address: '0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'comp',
    website: 'https://compound.finance',
    tags: ['Lending', 'Governance'],
    altContracts: {
      arbitrum: '0x354a6dd208f8b71e16e4eb5a3ada4ff7e6ae6ddf',
      polygon: '0x8505b9d2254a7ae468c0e9dd10ccea3a837aef5c',
    },
  },
  {
    contract: '0xd533a949740bb3306d119cc777fa900ba034cd52',
    symbol: 'CRV',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 WETH/CRV 1.0% (WETH < CRV by address, so CRV is token1)
      address: '0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'crv',
    website: 'https://curve.fi',
    tags: ['DEX', 'Governance'],
    altContracts: {
      arbitrum: '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978',
      polygon: '0x172370d5cd63279efa6d502dab29171933a610af',
    },
  },
  {
    contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    symbol: 'USDT',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 USDT/WETH 0.30% (TVL $254612314)
      address: '0x4e68ccd3e89f51c3074ca5072bbac773960dfa36',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'usdt',
    website: 'https://tether.to',
    tags: ['Stablecoin'],
    altContracts: {arbitrum:"0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",polygon:"0xc2132d05d31c914a87c6611c10748aeb04b58e8f"},
  },
  {
    contract: '0x6b175474e89094c44da98b954eedeac495271d0f',
    symbol: 'DAI',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 DAI/WETH 0.30%. Token API reports `close` as DAI-per-WETH
      // (~2355) for stablecoin-quoted pools regardless of V3's native token0
      // ordering, so inverse=true to get WETH-per-DAI then multiply by ETH/USD.
      address: '0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'dai',
    website: 'https://makerdao.com',
    tags: ['Stablecoin'],
    altContracts: {arbitrum:"0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",polygon:"0x8f3cf7ad23cd3cadbd9735aff958023239c6a063"},
  },
  {
    contract: '0x853d955acef822db058eb8505911ed77f175b99e',
    symbol: 'FRAX',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 FRAX/USDC 0.05% (TVL $3181637)
      address: '0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'frax',
    website: 'https://frax.finance',
    tags: ['Stablecoin'],
  },
  {
    contract: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409',
    symbol: 'FDUSD',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 FDUSD/WETH 0.30% (TVL $19)
      address: '0x9188d6690a84023ccfb712f409376587ee3b6b63',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'fdusd',
    website: 'https://firstdigitallabs.com',
    tags: ['Stablecoin'],
  },
  {
    contract: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
    symbol: 'PYUSD',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 PYUSD/USDC 0.01% (TVL $264296)
      address: '0x13394005c1012e708fce1eb974f1130fdc73a5ce',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'pyusd',
    website: 'https://www.paypal.com/pyusd',
    tags: ['Stablecoin'],
  },
  {
    contract: '0x5f98805a4e8be255a32880fdec7f6728c6568ba0',
    symbol: 'LUSD',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 LUSD/USDC 0.05% (TVL $927015)
      address: '0x4e0924d3a751be199c426d52fb1f2337fa96f736',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'lusd',
    website: 'https://www.liquity.org',
    tags: ['Stablecoin'],
  },
  {
    // Was previously a wrong contract (Biconomy's BICO) under the GHO
    // symbol; correcting to the actual Aave GHO stablecoin contract.
    contract: '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f',
    symbol: 'GHO',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 GHO/USDC 0.05% (canonical stablecoin pair).
      address: '0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'gho',
    website: 'https://gho.aave.com',
    tags: ['Stablecoin'],
  },
  {
    contract: '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e',
    symbol: 'crvUSD',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 crvUSD/USDC 0.05% (TVL $15497)
      address: '0x73ea3d8ba3d7380201b270ec504b33ed5e478542',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'crvusd',
    website: 'https://crvusd.curve.fi',
    tags: ['Stablecoin'],
  },
  {
    contract: '0x4d224452801aced8b2f0aebe155379bb5d594381',
    symbol: 'APE',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 APE/WETH 0.30% (TVL $12025269)
      address: '0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ape',
    website: 'https://apecoin.com',
    tags: ['Governance'],
  },
  {
    contract: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
    symbol: 'wstETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 wstETH/WETH 0.01% (TVL $13657561)
      address: '0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'wsteth',
    website: 'https://lido.fi',
    tags: ['LST'],
    altContracts: {arbitrum:"0x5979d7b546e38e414f7e9822514be443a4800529",base:"0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",polygon:"0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd"},
  },
  {
    contract: '0xae78736cd615f374d3085123a210448e74fc6393',
    symbol: 'rETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 rETH/WETH 0.01% (TVL $1247926)
      address: '0x553e9c493678d8606d6a5ba284643db2110df823',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'reth',
    website: 'https://www.rocketpool.net',
    tags: ['LST'],
    altContracts: {arbitrum:"0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8",base:"0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c"},
  },
  {
    contract: '0xbe9895146f7af43049ca1c1ae358b0541ea49704',
    symbol: 'cbETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 cbETH/WETH 0.05% (TVL $1912879)
      address: '0x840deeef2f115cf50da625f7368c24af6fe74410',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'cbeth',
    website: 'https://www.coinbase.com/cbeth',
    tags: ['LST'],
    altContracts: {base:"0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22"},
  },
  {
    contract: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee',
    symbol: 'weETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 weETH/WETH 0.05% (TVL $18267801)
      address: '0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'weeth',
    website: 'https://www.ether.fi',
    tags: ['LST'],
    altContracts: {arbitrum:"0x35751007a407ca6feffe80b3cb397736d2cf4dbe",base:"0x04c0599ae5a44757c0af6f9ec3b93da8976c150a"},
  },
  {
    contract: '0xbf5495efe5db9ce00f80364c8b423567e58d2110',
    symbol: 'ezETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 ezETH/WETH 0.01% (TVL $136465)
      address: '0xbe80225f09645f172b079394312220637c440a63',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ezeth',
    website: 'https://www.renzoprotocol.com',
    tags: ['LST'],
  },
  {
    contract: '0xac3e018457b222d93114458476f3e3416abbe38f',
    symbol: 'sfrxETH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 sfrxETH/WETH 0.05% (TVL $1962)
      address: '0xeed4603bc333ef406e5eb691ba66798d5c857d8b',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'sfrxeth',
    website: 'https://frax.finance',
    tags: ['LST'],
  },
  {
    contract: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',
    symbol: 'SUSHI',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 SUSHI/WETH 0.30% (TVL $239583)
      address: '0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'sushi',
    website: 'https://www.sushi.com',
    tags: ['DEX', 'Governance'],
  },
  {
    contract: '0x111111111117dc0aa78b770fa6a738034120c302',
    symbol: '1INCH',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 1INCH/USDC 1.00% (TVL $3284327)
      address: '0x9febc984504356225405e26833608b17719c82ae',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: '1inch',
    website: 'https://1inch.io',
    tags: ['DEX', 'Governance'],
  },
  {
    contract: '0xba100000625a3754423978a60c9317c58a424e3d',
    symbol: 'BAL',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 BAL/WETH 0.30% (TVL $38504)
      address: '0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'bal',
    website: 'https://balancer.fi',
    tags: ['DEX', 'Governance'],
  },
  {
    contract: '0x808507121b80c02388fad14726482e061b8da827',
    symbol: 'PENDLE',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 PENDLE/WETH 0.30% (TVL $1670059)
      address: '0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'pendle',
    website: 'https://www.pendle.finance',
    tags: ['DeFi'],
  },
  {
    contract: '0xd33526068d116ce69f19a9ee46f0bd304f21a51f',
    symbol: 'RPL',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 RPL/WETH 0.30% (TVL $2650339)
      address: '0xe42318ea3b998e8355a3da364eb9d48ec725eb45',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'rpl',
    website: 'https://www.rocketpool.net',
    tags: ['LST', 'Governance'],
  },
  {
    contract: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0',
    symbol: 'FXS',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 FXS/WETH 1.00% (TVL $2700126)
      address: '0xcd8286b48936cdac20518247dbd310ab681a9fbf',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'fxs',
    website: 'https://frax.finance',
    tags: ['DEX', 'Governance'],
  },
  {
    contract: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f',
    symbol: 'SNX',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 SNX/WETH 0.30% (TVL $804567)
      address: '0xede8dd046586d22625ae7ff2708f879ef7bdb8cf',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'snx',
    website: 'https://synthetix.io',
    tags: ['DeFi', 'Governance'],
  },
  {
    contract: '0x92d6c1e31e14520e676a687f0a93788b716beff5',
    symbol: 'DYDX',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 DYDX/WETH 0.30% (TVL $2668474)
      address: '0xd8de6af55f618a7bc69835d55ddc6582220c36c0',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'dydx',
    website: 'https://dydx.exchange',
    tags: ['DEX', 'Governance'],
  },
  {
    contract: '0x57e114b691db790c35207b2e685d4a43181e6061',
    symbol: 'ENA',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 ENA/WETH 0.30% (TVL $4985194)
      address: '0xc3db44adc1fcdfd5671f555236eae49f4a8eea18',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ena',
    website: 'https://ethena.fi',
    tags: ['Governance'],
  },
  {
    contract: '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1',
    symbol: 'ARB',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 ARB/WETH 0.30% (TVL $543015)
      address: '0x59354356ec5d56306791873f567d61ebf11dfbd5',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'arb',
    website: 'https://arbitrum.foundation',
    tags: ['Infrastructure', 'Governance'],
    altContracts: {arbitrum:"0x912ce59144191c1204e64559fe8253a0e49e6548"},
  },
  {
    contract: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
    symbol: 'MATIC',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 MATIC/WETH 0.30% (TVL $7784612)
      address: '0x290a6a7460b308ee3f19023d2d00de604bcf5b42',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'matic',
    website: 'https://polygon.technology',
    tags: ['Infrastructure'],
  },
  {
    contract: '0xaf5191b0de278c7286d6c7cc6ab6bb8a73ba2cd6',
    symbol: 'STG',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 STG/USDC 1.00% (TVL $785179)
      address: '0x8592064903ef23d34e4d5aaaed40abf6d96af186',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'stg',
    website: 'https://stargate.finance',
    tags: ['DEX', 'Governance'],
  },
  {
    contract: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
    symbol: 'SHIB',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 SHIB/WETH 1.00% (TVL $9850923)
      address: '0x5764a6f2212d502bc5970f9f129ffcd61e5d7563',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'shib',
    website: 'https://shibatoken.com',
    tags: ['Memecoin'],
  },
  {
    contract: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e',
    symbol: 'FLOKI',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 FLOKI/WETH 1.00% (TVL $12844)
      address: '0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'floki',
    website: 'https://www.floki.com',
    tags: ['Memecoin'],
  },
  {
    contract: '0x3845badade8e6dff049820680d1f14bd3903a5d0',
    symbol: 'SAND',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 SAND/WETH 1.00% (TVL $2677163)
      address: '0x5b97b125cf8af96834f2d08c8f1291bd47724939',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'sand',
    website: 'https://www.sandbox.game',
    tags: ['Memecoin'],
  },
  {
    contract: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942',
    symbol: 'MANA',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 MANA/WETH 0.30% (TVL $741604)
      address: '0x8661ae7918c0115af9e3691662f605e9c550ddc9',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'mana',
    website: 'https://decentraland.org',
    tags: ['Memecoin'],
  },
  {
    contract: '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b',
    symbol: 'AXS',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 AXS/WETH 0.30% (TVL $2794802)
      address: '0x3019d4e366576a88d28b623afaf3ecb9ec9d9580',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'axs',
    website: 'https://axieinfinity.com',
    tags: ['Memecoin', 'Governance'],
  },
  {
    contract: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff',
    symbol: 'IMX',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 IMX/WETH 1.00% (TVL $2653911)
      address: '0xfd76be67fff3bac84e3d5444167bbc018f5968b6',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'imx',
    website: 'https://www.immutable.com',
    tags: ['Infrastructure'],
  },
  {
    contract: '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
    symbol: 'BAT',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 BAT/WETH 0.30% (TVL $632587)
      address: '0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'bat',
    website: 'https://basicattentiontoken.org',
    tags: ['Governance'],
  },
  {
    contract: '0x6810e776880c02933d47db1b9fc05908e5386b96',
    symbol: 'GNO',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 GNO/WETH 0.30% (TVL $1153823)
      address: '0xf56d08221b5942c428acc5de8f78489a97fc5599',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'gno',
    website: 'https://www.gnosis.io',
    tags: ['Infrastructure', 'Governance'],
  },
  {
    contract: '0x5afe3855358e112b5647b952709e6165e1c1eeee',
    symbol: 'SAFE',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 SAFE/WETH 0.30% (TVL $511666)
      address: '0x000ba527862e5b82cff0f7c66b646af023274aa1',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'safe',
    website: 'https://safe.global',
    tags: ['Infrastructure', 'Governance'],
  },
  {
    contract: '0x163f8c2467924be0ae7b5347228cabf260318753',
    symbol: 'WLD',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 WLD/WETH 1.00% (TVL $2094119)
      address: '0x841820459769cd629b10a36fd12e603938cc2679',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'wld',
    website: 'https://worldcoin.org',
    tags: ['Identity'],
  },
  {
    contract: '0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb',
    symbol: 'ETHFI',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 ETHFI/WETH 0.30% (TVL $816303)
      address: '0x06f00544c0bc62e6db10f46d370dfccdc23d8189',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'ethfi',
    website: 'https://www.ether.fi',
    tags: ['LST', 'Governance'],
  },
];
