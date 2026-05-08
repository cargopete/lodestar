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

  // === Expansion v1: 36 new seeds (AI / Restaking / RWA / DePIN / L2 / newer memecoins) ===
  // FET/WETH 10000bps  TVL=$4,367,136
  {
    contract: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85',
    symbol: 'FET',
    chain: 'mainnet',
    pool: {
      address: '0x948b54a93f5ad1df6b8bff6dc249d99ca2eca052',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'fet',
    website: 'https://fetch.ai',
    tags: ['AI', 'Governance'],
  },
  // RENDER/WETH 10000bps  TVL=$5,954,121
  {
    contract: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
    symbol: 'RENDER',
    chain: 'mainnet',
    pool: {
      address: '0xe936f0073549ad8b1fa53583600d629ba9375161',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'rndr',
    website: 'https://renderfoundation.com',
    tags: ['AI', 'DePIN'],
  },
  // OCEAN/WETH 3000bps  TVL=$315,224
  {
    contract: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48',
    symbol: 'OCEAN',
    chain: 'mainnet',
    pool: {
      address: '0x283e2e83b7f3e297c4b7c02114ab0196b001a109',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ocean',
    website: 'https://oceanprotocol.com',
    tags: ['AI'],
  },
  // NMR/WETH 10000bps  TVL=$579,071
  {
    contract: '0x1776e1f26f98b1a5df9cd347953a26dd3cb46671',
    symbol: 'NMR',
    chain: 'mainnet',
    pool: {
      address: '0x8df016708a66377dae191ca6f9fff4705a3d951f',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'nmr',
    website: 'https://numer.ai',
    tags: ['AI'],
  },
  // ARKM/WETH 10000bps  TVL=$382,807
  {
    contract: '0x6e2a43be0b1d33b726f0ca3b8de60b3482b8b050',
    symbol: 'ARKM',
    chain: 'mainnet',
    pool: {
      address: '0x9cb91e5451d29c84b51ffd40df0b724b639bf841',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'arkm',
    website: 'https://www.arkhamintelligence.com',
    tags: ['AI', 'Infrastructure'],
  },
  // PRIME/WETH 10000bps  TVL=$2,826,312
  {
    contract: '0xb23d80f5fefcddaa212212f028021b41ded428cf',
    symbol: 'PRIME',
    chain: 'mainnet',
    pool: {
      address: '0xcd423f3ab39a11ff1d9208b7d37df56e902c932b',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'prime',
    website: 'https://www.echelon.io',
    tags: ['Gaming', 'AI'],
  },
  // EIGEN/WETH 3000bps  TVL=$4,986,564
  {
    contract: '0xec53bf9167f50cdeb3ae105f56099aaab9061f83',
    symbol: 'EIGEN',
    chain: 'mainnet',
    pool: {
      address: '0xc2c390c6cd3c4e6c2b70727d35a45e8a072f18ca',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'eigen',
    website: 'https://www.eigenlayer.xyz',
    tags: ['Restaking', 'Governance'],
  },
  // REZ/WETH 10000bps  TVL=$186,870
  {
    contract: '0x3b50805453023a91a8bf641e279401a0b23fa6f9',
    symbol: 'REZ',
    chain: 'mainnet',
    pool: {
      address: '0x76366d95c2016446247296ea50c8d06d0585ae00',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'rez',
    website: 'https://www.renzoprotocol.com',
    tags: ['Restaking', 'Governance'],
  },
  // rsETH/WETH 500bps  TVL=$91,824
  {
    contract: '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7',
    symbol: 'rsETH',
    chain: 'mainnet',
    pool: {
      address: '0x059615ebf32c946aaab3d44491f78e4f8e97e1d3',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'rseth',
    website: 'https://kelpdao.xyz',
    tags: ['LST', 'Restaking'],
  },
  // SWELL/WETH 10000bps  TVL=$51,081
  {
    contract: '0x0a6e7ba5042b38349e437ec6db6214aec7b35676',
    symbol: 'SWELL',
    chain: 'mainnet',
    pool: {
      address: '0x4765aa201b3c457742e93a329a9719e1d129acd4',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'swell',
    website: 'https://www.swellnetwork.io',
    tags: ['Restaking', 'Governance'],
  },
  // pufETH/WETH 3000bps  TVL=$1,064,712
  {
    contract: '0xd9a442856c234a39a81a089c06451ebaa4306a72',
    symbol: 'pufETH',
    chain: 'mainnet',
    pool: {
      address: '0xbdb04e915b94fbfd6e8552ff7860e59db7d4499a',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'pufeth',
    website: 'https://www.puffer.fi',
    tags: ['LST', 'Restaking'],
  },
  // STRK/WETH 10000bps  TVL=$551,805
  {
    contract: '0xca14007eff0db1f8135f4c25b34de49ab0d42766',
    symbol: 'STRK',
    chain: 'mainnet',
    pool: {
      address: '0xac4fd96fcf729390a3c8044422a529028ec36751',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'strk',
    website: 'https://www.starknet.io',
    tags: ['Infrastructure', 'Governance'],
  },
  // ZRO/WETH 3000bps  TVL=$485,453
  {
    contract: '0x6985884c4392d348587b19cb9eaaf157f13271cd',
    symbol: 'ZRO',
    chain: 'mainnet',
    pool: {
      address: '0x360acf12e72044ba3eaaa654e51e4725c699dcb1',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'zro',
    website: 'https://layerzero.network',
    tags: ['Bridge', 'Governance'],
  },
  // MNT/WETH 3000bps  TVL=$1,160,387
  {
    contract: '0x3c3a81e81dc49a522a592e7622a7e711c06bf354',
    symbol: 'MNT',
    chain: 'mainnet',
    pool: {
      address: '0xf4c5e0f4590b6679b3030d29a84857f226087fef',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'mnt',
    website: 'https://www.mantle.xyz',
    tags: ['Infrastructure', 'Restaking'],
  },
  // METIS/WETH 3000bps  TVL=$3,124,873
  {
    contract: '0x9e32b13ce7f2e80a01932b42553652e053d6ed8e',
    symbol: 'METIS',
    chain: 'mainnet',
    pool: {
      address: '0x1c98562a2fab5af19d8fb3291a36ac3c618835d9',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'metis',
    website: 'https://www.metis.io',
    tags: ['Infrastructure', 'Governance'],
  },
  // AXL/USDC 3000bps  TVL=$363,535
  {
    contract: '0x467719ad09025fcc6cf6f8311755809d45a5e5f3',
    symbol: 'AXL',
    chain: 'mainnet',
    pool: {
      address: '0x975c822e26a514e7a1b75be587aefc738a73eee7',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'axl',
    website: 'https://axelar.network',
    tags: ['Bridge', 'Infrastructure'],
  },
  // ONDO/WETH 3000bps  TVL=$6,810,337
  {
    contract: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
    symbol: 'ONDO',
    chain: 'mainnet',
    pool: {
      address: '0x7b1e5d984a43ee732de195628d20d05cfabc3cc7',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'ondo',
    website: 'https://ondo.finance',
    tags: ['RWA', 'Governance'],
  },
  // TRU/USDC 10000bps  TVL=$43,714
  {
    contract: '0x4c19596f5aaff459fa38b0f7ed92f11ae6543784',
    symbol: 'TRU',
    chain: 'mainnet',
    pool: {
      address: '0x8b65f72b5c3b1822d722d4927eda34f7efd8c7d2',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'tru',
    website: 'https://truefi.io',
    tags: ['RWA', 'Lending'],
  },
  // CFG/USDC 3000bps  TVL=$368,738
  {
    contract: '0xc221b7e65ffc80de234bbb6667abdd46593d34f0',
    symbol: 'CFG',
    chain: 'mainnet',
    pool: {
      address: '0x7270233ccae676e776a659affc35219e6fcfbb10',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'cfg',
    website: 'https://centrifuge.io',
    tags: ['RWA'],
  },
  // USDe/USDC 100bps  TVL=$2,455,334
  {
    contract: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
    symbol: 'USDe',
    chain: 'mainnet',
    pool: {
      address: '0xe6d7ebb9f1a9519dc06d557e03c522d53520e76a',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'usde',
    website: 'https://www.ethena.fi',
    tags: ['Stablecoin'],
  },
  // USDS/USDC 3000bps  TVL=$38,982
  {
    contract: '0xdc035d45d973e3ec169d2276ddab16f1e407384f',
    symbol: 'USDS',
    chain: 'mainnet',
    pool: {
      address: '0xa66a2770bc0e0c65b63b5a3bb4560e90f95d6146',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'usds',
    website: 'https://sky.money',
    tags: ['Stablecoin'],
  },
  // JASMY/WETH 10000bps  TVL=$1,821,482
  {
    contract: '0x7420b4b9a0110cdc71fb720908340c03f9bc03ec',
    symbol: 'JASMY',
    chain: 'mainnet',
    pool: {
      address: '0x4d1eff861316396dd1915f69b49f4c2d7b11590d',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'jasmy',
    website: 'https://www.jasmy.co.jp',
    tags: ['DePIN'],
  },
  // LRC/USDC 3000bps  TVL=$404,807
  {
    contract: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd',
    symbol: 'LRC',
    chain: 'mainnet',
    pool: {
      address: '0x223a719005e758599dfc7840507c67e5240a930e',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'lrc',
    website: 'https://loopring.org',
    tags: ['DEX', 'Infrastructure'],
  },
  // ZRX/WETH 3000bps  TVL=$636,740
  {
    contract: '0xe41d2489571d322189246dafa5ebde1f4699f498',
    symbol: 'ZRX',
    chain: 'mainnet',
    pool: {
      address: '0x14424eeecbff345b38187d0b8b749e56faa68539',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'zrx',
    website: 'https://0x.org',
    tags: ['DEX', 'Governance'],
  },
  // BICO/WETH 3000bps  TVL=$66,372
  {
    contract: '0xf17e65822b568b3903685a7c9f496cf7656cc6c2',
    symbol: 'BICO',
    chain: 'mainnet',
    pool: {
      address: '0xad6b651df72b443f57b76ff79165ee771272e18e',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'bico',
    website: 'https://www.biconomy.io',
    tags: ['Infrastructure'],
  },
  // MOG/WETH 10000bps  TVL=$1,936,543
  {
    contract: '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a',
    symbol: 'MOG',
    chain: 'mainnet',
    pool: {
      address: '0x7832310cd0de39c4ce0a635f34d9a4b5b47fd434',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'mog',
    website: 'https://www.mogcoin.xyz',
    tags: ['Memecoin'],
  },
  // NEIRO/WETH 10000bps  TVL=$1,095,344
  {
    contract: '0x812ba41e071c7b7fa4ebcfb62df5f45f6fa853ee',
    symbol: 'NEIRO',
    chain: 'mainnet',
    pool: {
      address: '0x79a6683d82f25535ff3fd2753e03e0961060e882',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'neiro',
    website: 'https://neirocoin.eth.limo',
    tags: ['Memecoin'],
  },
  // TURBO/WETH 10000bps  TVL=$9,510,782
  {
    contract: '0xa35923162c49cf95e6bf26623385eb431ad920d3',
    symbol: 'TURBO',
    chain: 'mainnet',
    pool: {
      address: '0x7baece5d47f1bc5e1953fbe0e9931d54dab6d810',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'turbo',
    website: 'https://turbotoad.io',
    tags: ['Memecoin'],
  },
  // CHZ/WETH 10000bps  TVL=$231,800
  {
    contract: '0x3506424f91fd33084466f402d5d97f05f8e3b4af',
    symbol: 'CHZ',
    chain: 'mainnet',
    pool: {
      address: '0x325365ed8275f6a74cac98917b7f6face8da533b',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'chz',
    website: 'https://www.chiliz.com',
    tags: ['Memecoin'],
  },
  // PIXEL/WETH 10000bps  TVL=$93,164
  {
    contract: '0x3429d03c6f7521aec737a0bbf2e5ddcef2c3ae31',
    symbol: 'PIXEL',
    chain: 'mainnet',
    pool: {
      address: '0xf6e28a6bf73980d573cb53b71112b6886896ebcb',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'pixel',
    website: 'https://pixels.xyz',
    tags: ['Gaming'],
  },
  // BEAM/WETH 10000bps  TVL=$439,366
  {
    contract: '0x62d0a8458ed7719fdaf978fe5929c6d342b0bfce',
    symbol: 'BEAM',
    chain: 'mainnet',
    pool: {
      address: '0x318fbee0a0d60e5de7009864632ceda8d77489b8',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'beam',
    website: 'https://onbeam.com',
    tags: ['Gaming'],
  },
  // swETH/WETH 500bps  TVL=$346,732
  {
    contract: '0xf951e335afb289353dc249e82926178eac7ded78',
    symbol: 'swETH',
    chain: 'mainnet',
    pool: {
      address: '0x30ea22c879628514f1494d4bbfef79d21a6b49a2',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'sweth',
    website: 'https://www.swellnetwork.io',
    tags: ['LST'],
  },
  // BNB/WETH 10000bps  TVL=$503,908
  {
    contract: '0xb8c77482e45f1f44de1745f52c74426c631bdd52',
    symbol: 'BNB',
    chain: 'mainnet',
    pool: {
      address: '0x9e7809c21ba130c1a51c112928ea6474d9a9ae3c',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'bnb',
    website: 'https://www.bnbchain.org',
    tags: ['Infrastructure', 'Governance'],
  },
  // GUSD/USDC 30bps  TVL=$480,606
  {
    contract: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
    symbol: 'GUSD',
    chain: 'mainnet',
    pool: {
      address: '0x93f267fd92b432bebf4da4e13b8615bb8eb2095c',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://www.gemini.com/dollar',
    tags: ['Stablecoin'],
  },
  // AUSD/USDC 1bps  TVL=$25,043,379
  {
    contract: '0x00000000efe302beaa2b3e6e1b18d08d69a9012a',
    symbol: 'AUSD',
    chain: 'mainnet',
    pool: {
      address: '0xbafead7c60ea473758ed6c6021505e8bbd7e8e5d',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://agora.finance',
    tags: ['Stablecoin'],
  },
  // USD0/USDC 1bps  TVL=$2,429,078
  {
    contract: '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5',
    symbol: 'USD0',
    chain: 'mainnet',
    pool: {
      address: '0x4e665157291dbcb25152ebb01061e4012f58add2',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://usual.money',
    tags: ['Stablecoin'],
  },
  // RLUSD/USDC 1bps  TVL=$4,116,027
  {
    contract: '0x8292bb45bf1ee4d140127049757c2e0ff06317ed',
    symbol: 'RLUSD',
    chain: 'mainnet',
    pool: {
      address: '0xcc6d2f26d363836f85a42d249e145ec0320d3e55',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'rlusd',
    website: 'https://ripple.com/rlusd',
    tags: ['Stablecoin'],
  },
  // agEUR/USDC 5bps  TVL=$230,029
  {
    contract: '0x1a7e4e63778b4f12a199c062f3efdd288afcbce8',
    symbol: 'agEUR',
    chain: 'mainnet',
    pool: {
      address: '0x7ed3f364668cd2b9449a8660974a26a092c64849',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://www.angle.money',
    tags: ['Stablecoin'],
  },
  // EUROC/USDC 5bps  TVL=$6,870,503
  {
    contract: '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',
    symbol: 'EUROC',
    chain: 'mainnet',
    pool: {
      address: '0x95dbb3c7546f22bce375900abfdd64a4e5bd73d6',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://www.circle.com/en/eurc',
    tags: ['Stablecoin'],
  },
  // ZCHF/USDT 1bps  TVL=$1,420,418
  {
    contract: '0xb58e61c3098d85632df34eecfb899a1ed80921cb',
    symbol: 'ZCHF',
    chain: 'mainnet',
    pool: {
      address: '0x8e4318e2cb1ae291254b187001a59a1f8ac78cef',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://frankencoin.com',
    tags: ['DeFi'],
  },
  // BOLD/USDC 5bps  TVL=$1,429,801
  {
    contract: '0x6440f144b7e50d6a8439336510312d2f54beb01d',
    symbol: 'BOLD',
    chain: 'mainnet',
    pool: {
      address: '0x1e4dbb639ebbf725fd243a6190df5440ee38740e',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://www.liquity.org',
    tags: ['DeFi'],
  },
  // MIM/USDC 5bps  TVL=$599,943
  {
    contract: '0x99d8a9c45b2eca8864373a26d1459e3dff1e17f3',
    symbol: 'MIM',
    chain: 'mainnet',
    pool: {
      address: '0x298b7c5e0770d151e4c5cf6cca4dae3a3ffc8e27',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://abracadabra.money',
    tags: ['Stablecoin'],
  },
  // sUSD/USDC 5bps  TVL=$251,357
  {
    contract: '0x57ab1ec28d129707052df4df418d58a2d46d5f51',
    symbol: 'sUSD',
    chain: 'mainnet',
    pool: {
      address: '0x6a9850e46518231b23e50467c975fa94026be5d5',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://synthetix.io',
    tags: ['DeFi'],
  },
  // LsETH/WETH 1bps  TVL=$7,276,418
  {
    contract: '0x8c1bed5b9a0928467c9b1341da1d7bd5e10b6549',
    symbol: 'LsETH',
    chain: 'mainnet',
    pool: {
      address: '0x6e7ff51ff35e4748346411c7adb1ce1a103e6162',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'lseth',
    website: 'https://liquidcollective.io',
    tags: ['LST'],
  },
  // mETH/WETH 5bps  TVL=$7,043,546
  {
    contract: '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa',
    symbol: 'mETH',
    chain: 'mainnet',
    pool: {
      address: '0x04708077eca6bb527a5bbbd6358ffb043a9c1c14',
      quote: 'eth',
      inverse: true,
    },
    website: 'https://www.mantle.xyz/meth',
    tags: ['LST'],
  },
  // OETH/WETH 5bps  TVL=$596,729
  {
    contract: '0x856c4efb76c1d1ae02e20ceb03a2a6a08b0b8dc3',
    symbol: 'OETH',
    chain: 'mainnet',
    pool: {
      address: '0x52299416c469843f4e0d54688099966a6c7d720f',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.originprotocol.com/oeth',
    tags: ['DeFi'],
  },
  // sETH2/WETH 30bps  TVL=$1,666,641
  {
    contract: '0xfe2e637202056d30016725477c5da089ab0a043a',
    symbol: 'sETH2',
    chain: 'mainnet',
    pool: {
      address: '0x7379e81228514a1d2a6cf7559203998e20598346',
      quote: 'eth',
      inverse: true,
    },
    website: 'https://www.stakewise.io',
    tags: ['DeFi'],
  },
  // PERP/WETH 30bps  TVL=$1,342,489
  {
    contract: '0xbc396689893d065f41bc2c6ecbee5e0085233447',
    symbol: 'PERP',
    chain: 'mainnet',
    pool: {
      address: '0xcd83055557536eff25fd0eafbc56e74a1b4260b3',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'perp',
    website: 'https://www.perp.com',
    tags: ['DEX'],
  },
  // JOE/WETH 100bps  TVL=$252,267
  {
    contract: '0x76e222b07c53d28b89b0bac18602810fc22b49a8',
    symbol: 'JOE',
    chain: 'mainnet',
    pool: {
      address: '0xceb63a909d95c9222cdf5b08044f5dae72cd036e',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'joe',
    website: 'https://traderjoexyz.com',
    tags: ['DEX'],
  },
  // SDEX/WETH 100bps  TVL=$982,005
  {
    contract: '0x5de8ab7e27f6e7a1fff3e5b337584aa43961beef',
    symbol: 'SDEX',
    chain: 'mainnet',
    pool: {
      address: '0xc7cbff2a23d0926604f9352f65596e65729b8a17',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://smardex.io',
    tags: ['DeFi'],
  },
  // UNCX/WETH 30bps  TVL=$517,373
  {
    contract: '0xadb2437e6f65682b85f814fbc12fec0508a7b1d0',
    symbol: 'UNCX',
    chain: 'mainnet',
    pool: {
      address: '0xe0f0e02a16b45f949b98856b61175e63ca5f6293',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://uncx.network',
    tags: ['DeFi'],
  },
  // EUL/WETH 100bps  TVL=$938,596
  {
    contract: '0xd9fcd98c322942075a5c3860693e9f4f03aae07b',
    symbol: 'EUL',
    chain: 'mainnet',
    pool: {
      address: '0xb003df4b243f938132e8cadbeb237abc5a889fb4',
      quote: 'eth',
      inverse: true,
    },
    website: 'https://www.euler.finance',
    tags: ['Lending'],
  },
  // SPELL/WETH 30bps  TVL=$876,618
  {
    contract: '0x090185f2135308bad17527004364ebcc2d37e5f6',
    symbol: 'SPELL',
    chain: 'mainnet',
    pool: {
      address: '0xfebf38b1d34818d4827034f97b7d6d77c79d4997',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'spell',
    website: 'https://abracadabra.money',
    tags: ['Stablecoin'],
  },
  // GHST/WETH 100bps  TVL=$267,858
  {
    contract: '0x3f382dbd960e3a9bbceae22651e88158d2791550',
    symbol: 'GHST',
    chain: 'mainnet',
    pool: {
      address: '0xfba31f01058db09573a383f26a088f23774d4e5d',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ghst',
    website: 'https://aavegotchi.com',
    tags: ['Gaming'],
  },
  // LQTY/WETH 30bps  TVL=$2,337,562
  {
    contract: '0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d',
    symbol: 'LQTY',
    chain: 'mainnet',
    pool: {
      address: '0xd1d5a4c0ea98971894772dcd6d2f1dc71083c44e',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.liquity.org',
    tags: ['DeFi'],
  },
  // MPL/USDC 100bps  TVL=$443,552
  {
    contract: '0x33349b282065b0284d756f0577fb39c158f935e6',
    symbol: 'MPL',
    chain: 'mainnet',
    pool: {
      address: '0x858a2ca525466a5c7ad1bd4f66ecbfdcc938f237',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://maple.finance',
    tags: ['DeFi'],
  },
  // CPOOL/USDC 100bps  TVL=$1,214,330
  {
    contract: '0x66761fa41377003622aee3c7675fc7b5c1c2fac5',
    symbol: 'CPOOL',
    chain: 'mainnet',
    pool: {
      address: '0xa7600c4fbddb57e44018bee74a5f6b636cb68352',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://clearpool.finance',
    tags: ['DeFi'],
  },
  // RBN/USDC 30bps  TVL=$2,294,118
  {
    contract: '0x6123b0049f904d730db3c36a31167d9d4121fa6b',
    symbol: 'RBN',
    chain: 'mainnet',
    pool: {
      address: '0xfe0df74636bc25c7f2400f22fe7dae32d39443d2',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://aevo.xyz',
    tags: ['DeFi'],
  },
  // SPX/WETH 100bps  TVL=$4,647,042
  {
    contract: '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c',
    symbol: 'SPX',
    chain: 'mainnet',
    pool: {
      address: '0x00ed26e794b949e18b142f9108429b74ce08ac99',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'spx',
    website: 'https://www.spx6900.com',
    tags: ['Memecoin'],
  },
  // BONE/WETH 30bps  TVL=$1,303,320
  {
    contract: '0x9813037ee2218799597d83d4a5b6f3b6778218d9',
    symbol: 'BONE',
    chain: 'mainnet',
    pool: {
      address: '0xb011e4eb4111ef00b620a5ed195836dcd69db1ff',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'bone',
    website: 'https://shibatoken.com',
    tags: ['Memecoin'],
  },
  // DOG/WETH 30bps  TVL=$2,069,661
  {
    contract: '0xbaac2b4491727d78d2b78815144570b9f2fe8899',
    symbol: 'DOG',
    chain: 'mainnet',
    pool: {
      address: '0x9b3423373e6e786c9ac367120533abe4ee398373',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.thedogenft.io',
    tags: ['DeFi'],
  },
  // PEOPLE/WETH 100bps  TVL=$3,360,855
  {
    contract: '0x7a58c0be72be218b41c608b7fe7c5bb630736c71',
    symbol: 'PEOPLE',
    chain: 'mainnet',
    pool: {
      address: '0x83abecf7204d5afc1bea5df734f085f2535a9976',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.constitutiondao.com',
    tags: ['DeFi'],
  },
  // CULT/WETH 100bps  TVL=$4,560,477
  {
    contract: '0x0000000000c5dc95539589fbd24be07c6c14eca4',
    symbol: 'CULT',
    chain: 'mainnet',
    pool: {
      address: '0xc4ce8e63921b8b6cbdb8fcb6bd64cc701fb926f2',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.miladycultcoin.com',
    tags: ['DeFi'],
  },
  // AGIX/WETH 100bps  TVL=$2,746,622
  {
    contract: '0x5b7533812759b45c2b44c19e320ba2cd2681b542',
    symbol: 'AGIX',
    chain: 'mainnet',
    pool: {
      address: '0x99132b53ab44694eeb372e87bced3929e4ab8456',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'agix',
    website: 'https://singularitynet.io',
    tags: ['AI'],
  },
  // VIRTUAL/WETH 100bps  TVL=$6,097,091
  {
    contract: '0x44ff8620b8ca30902395a7bd3f2407e1a091bf73',
    symbol: 'VIRTUAL',
    chain: 'mainnet',
    pool: {
      address: '0x95a45a87dd4d3a1803039072f37e075f37b23d75',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.virtuals.io',
    tags: ['AI'],
  },
  // AIOZ/WETH 100bps  TVL=$2,368,154
  {
    contract: '0x626e8036deb333b408be468f951bdb42433cbf18',
    symbol: 'AIOZ',
    chain: 'mainnet',
    pool: {
      address: '0x2a0330c7e979a4d18e5b0c987b877da24dd37d04',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'aioz',
    website: 'https://aioz.network',
    tags: ['DePIN'],
  },
  // GALA/WETH 30bps  TVL=$1,134,119
  {
    contract: '0xd1d2eb1b1e90b638588728b4130137d262c87cae',
    symbol: 'GALA',
    chain: 'mainnet',
    pool: {
      address: '0x465e56cd21ad47d4d4790f17de5e0458f20c3719',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'gala',
    website: 'https://www.gala.com',
    tags: ['Gaming'],
  },
  // ILV/WETH 100bps  TVL=$620,329
  {
    contract: '0x767fe9edc9e0df98e07454847909b5e959d7ca0e',
    symbol: 'ILV',
    chain: 'mainnet',
    pool: {
      address: '0xbaec0e18c770993ffb1175fef493b5113cc6e32d',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ilv',
    website: 'https://illuvium.io',
    tags: ['Gaming'],
  },
  // BIGTIME/WETH 100bps  TVL=$597,749
  {
    contract: '0x64bc2ca1be492be7185faa2c8835d9b824c8a194',
    symbol: 'BIGTIME',
    chain: 'mainnet',
    pool: {
      address: '0x32121e0d11ecc79035045bc7466ede30816c5674',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'bigtime',
    website: 'https://bigtime.gg',
    tags: ['Gaming'],
  },
  // MAVIA/WETH 30bps  TVL=$497,713
  {
    contract: '0x24fcfc492c1393274b6bcd568ac9e225bec93584',
    symbol: 'MAVIA',
    chain: 'mainnet',
    pool: {
      address: '0x6a888fb73f13104473a4bdfb1beb220ac1eafda3',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'mavia',
    website: 'https://mavia.com',
    tags: ['Gaming'],
  },
  // AGLD/WETH 100bps  TVL=$4,296,990
  {
    contract: '0x32353a6c91143bfd6c7d363b546e62a9a2489a20',
    symbol: 'AGLD',
    chain: 'mainnet',
    pool: {
      address: '0x5d752f322befb038991579972e912b02f61a3dda',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://adventuregold.org',
    tags: ['DeFi'],
  },
  // LPT/WETH 100bps  TVL=$293,886
  {
    contract: '0x58b6a8a3302369daec383334672404ee733ab239',
    symbol: 'LPT',
    chain: 'mainnet',
    pool: {
      address: '0x2519042aa735edb4688a8376d69d4bb69431206c',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'lpt',
    website: 'https://livepeer.org',
    tags: ['DePIN', 'Infrastructure'],
  },
  // POWR/WETH 5bps  TVL=$704,773
  {
    contract: '0x595832f8fc6bf59c85c527fec3740a1b7a361269',
    symbol: 'POWR',
    chain: 'mainnet',
    pool: {
      address: '0xe3fe800b0de664bf0bca8ad58ecbc73b259047b0',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'powr',
    website: 'https://www.powerledger.io',
    tags: ['DePIN'],
  },
  // PAXG/USDC 5bps  TVL=$4,492,721
  {
    contract: '0x45804880de22913dafe09f4980848ece6ecbaf78',
    symbol: 'PAXG',
    chain: 'mainnet',
    pool: {
      address: '0x5ae13baaef0620fdae1d355495dc51a17adb4082',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'paxg',
    website: 'https://www.paxos.com/pax-gold',
    tags: ['RWA'],
  },
  // PLUME/USDC 100bps  TVL=$940,887
  {
    contract: '0x4c1746a800d224393fe2470c70a35717ed4ea5f1',
    symbol: 'PLUME',
    chain: 'mainnet',
    pool: {
      address: '0xe35bfbf439d7c37e2df41bf1236ccf1dec0543fd',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'plume',
    website: 'https://plumenetwork.xyz',
    tags: ['RWA'],
  },
  // TRAC/WETH 30bps  TVL=$1,007,780
  {
    contract: '0xaa7a9ca87d3694b5755f213b5d04094b8d0f0a6f',
    symbol: 'TRAC',
    chain: 'mainnet',
    pool: {
      address: '0xb1914469141ebb6e244e75cee3f35d43bf6b85e5',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://origintrail.io',
    tags: ['DeFi'],
  },
  // GTC/WETH 100bps  TVL=$1,239,628
  {
    contract: '0xde30da39c46104798bb5aa3fe8b9e0e1f348163f',
    symbol: 'GTC',
    chain: 'mainnet',
    pool: {
      address: '0x06b1655b9d560de112759b4f0bf57d6f005e72fe',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'gtc',
    website: 'https://www.gitcoin.co',
    tags: ['Identity'],
  },
  // OGN/WETH 30bps  TVL=$473,072
  {
    contract: '0x8207c1ffc5b6804f6024322ccf34f29c3541ae26',
    symbol: 'OGN',
    chain: 'mainnet',
    pool: {
      address: '0x70bb8e6844dfb681810fd557dd741bcaf027bf94',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.originprotocol.com',
    tags: ['DeFi'],
  },
  // SYRUP/WETH 100bps  TVL=$3,105,433
  {
    contract: '0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66',
    symbol: 'SYRUP',
    chain: 'mainnet',
    pool: {
      address: '0x27941a235804f33d81adabb2d56589c5f6ea6556',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'syrup',
    website: 'https://maple.finance',
    tags: ['Lending'],
  },
  // CVX/USDC 100bps  TVL=$225,507
  {
    contract: '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b',
    symbol: 'CVX',
    chain: 'mainnet',
    pool: {
      address: '0x575e96f61656b275ca1e0a67d9b68387abc1d09c',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'cvx',
    website: 'https://www.convexfinance.com',
    tags: ['DeFi', 'Governance'],
  },
  // BTRFLY/WETH 100bps  TVL=$572,466
  {
    contract: '0xc55126051b22ebb829d00368f4b12bde432de5da',
    symbol: 'BTRFLY',
    chain: 'mainnet',
    pool: {
      address: '0x3e6e23198679419cd73bb6376518dcc5168c8260',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'btrfly',
    website: 'https://redacted.finance',
    tags: ['DeFi'],
  },
  // YFI/WETH 100bps  TVL=$815,242
  {
    contract: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e',
    symbol: 'YFI',
    chain: 'mainnet',
    pool: {
      address: '0x2e8daf55f212be91d3fa882cceab193a08fddeb2',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'yfi',
    website: 'https://yearn.fi',
    tags: ['DeFi'],
  },
  // INST/WETH 100bps  TVL=$5,660,989
  {
    contract: '0x6f40d4a6237c257fff2db00fa0510deeecd303eb',
    symbol: 'INST',
    chain: 'mainnet',
    pool: {
      address: '0xc1cd3d0913f4633b43fcddbcd7342bc9b71c676f',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://fluid.io',
    tags: ['DeFi'],
  },
  // DPI/WETH 30bps  TVL=$487,490
  {
    contract: '0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b',
    symbol: 'DPI',
    chain: 'mainnet',
    pool: {
      address: '0x9359c87b38dd25192c5f2b07b351ac91c90e6ca7',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://indexcoop.com/products/dpi',
    tags: ['DeFi'],
  },
  // SD/USDC 30bps  TVL=$318,753
  {
    contract: '0x30d20208d987713f46dfd34ef128bb16c404d10f',
    symbol: 'SD',
    chain: 'mainnet',
    pool: {
      address: '0xc72abb13b6bdfa64770cb5b1f57bebd36a91a29e',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://www.staderlabs.com',
    tags: ['DeFi'],
  },
  // FORTH/WETH 100bps  TVL=$343,314
  {
    contract: '0x77fba179c79de5b7653f68b5039af940ada60ce0',
    symbol: 'FORTH',
    chain: 'mainnet',
    pool: {
      address: '0xc1df8037881df17dc88998824b9aea81c71bbb1b',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.ampleforth.org',
    tags: ['DeFi'],
  },
  // cbBTC/USDC 30bps  TVL=$4,663,689
  {
    contract: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
    symbol: 'cbBTC',
    chain: 'mainnet',
    pool: {
      address: '0x4548280ac92507c9092a511c7396cbea78fa9e49',
      quote: 'usd',
      inverse: true,
    },
    iconSlug: 'cbbtc',
    website: 'https://www.coinbase.com/cbbtc',
    tags: ['Wrapped'],
  },
  // tBTC/WETH 30bps  TVL=$542,637
  {
    contract: '0x18084fba666a33d37592fa2633fd49a74dd93a88',
    symbol: 'tBTC',
    chain: 'mainnet',
    pool: {
      address: '0x97944213d2caeea773da1c9b11b0525f25b749cc',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'tbtc',
    website: 'https://threshold.network',
    tags: ['Wrapped'],
  },
  // MORPHO/WETH 100bps  TVL=$1,974,734
  {
    contract: '0x58d97b57bb95320f9a05dc918aef65434969c2b2',
    symbol: 'MORPHO',
    chain: 'mainnet',
    pool: {
      address: '0x25b96761e765b9ac20db18fa57fa91e3b617ec6f',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'morpho',
    website: 'https://morpho.org',
    tags: ['Lending'],
  },
  // USUAL/WETH 100bps  TVL=$1,298,878
  {
    contract: '0xc4441c2be5d8fa8126822b9929ca0b81ea0de38e',
    symbol: 'USUAL',
    chain: 'mainnet',
    pool: {
      address: '0x14154c15fc0fd3f91de557a1b6fdd2059972cd0b',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'usual',
    website: 'https://usual.money',
    tags: ['Stablecoin', 'Governance'],
  },
  // BLUR/USDC 30bps  TVL=$558,991
  {
    contract: '0x5283d291dbcf85356a21ba090e6db59121208b44',
    symbol: 'BLUR',
    chain: 'mainnet',
    pool: {
      address: '0x92ab871abb9d567aa276b2ce58d0203d84e0181e',
      quote: 'usd',
      inverse: false,
    },
    iconSlug: 'blur',
    website: 'https://blur.io',
    tags: ['Infrastructure'],
  },
  // NEXO/WETH 30bps  TVL=$3,773,151
  {
    contract: '0xb62132e35a6c13ee1ee0f84dc5d40bad8d815206',
    symbol: 'NEXO',
    chain: 'mainnet',
    pool: {
      address: '0x4c54ff7f1c424ff5487a32aad0b48b19cbaf087f',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'nexo',
    website: 'https://nexo.com',
    tags: ['Lending'],
  },
  // QNT/WETH 30bps  TVL=$3,590,879
  {
    contract: '0x4a220e6096b25eadb88358cb44068a3248254675',
    symbol: 'QNT',
    chain: 'mainnet',
    pool: {
      address: '0x24ee2c6b9597f035088cda8575e9d5e15a84b9df',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'qnt',
    website: 'https://quant.network',
    tags: ['Infrastructure'],
  },
  // OX/WETH 100bps  TVL=$510,113
  {
    contract: '0xba0dda8762c24da9487f5fa026a9b64b695a07ea',
    symbol: 'OX',
    chain: 'mainnet',
    pool: {
      address: '0x49727bbe3ba46aeb1058749ed2741a42fd1ccda8',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'ox',
    website: 'https://www.0x.org',
    tags: ['DEX'],
  },
  // BTT/WETH 30bps  TVL=$1,231,703
  {
    contract: '0xc669928185dbce49d2230cc9b0979be6dc797957',
    symbol: 'BTT',
    chain: 'mainnet',
    pool: {
      address: '0x64a078926ad9f9e88016c199017aea196e3899e1',
      quote: 'eth',
      inverse: true,
    },
    iconSlug: 'btt',
    website: 'https://bt.io',
    tags: ['Infrastructure'],
  },
  // CRO/WETH 100bps  TVL=$1,861,496
  {
    contract: '0xa0b73e1ff0b80914ab6fe0444e65848c4c34450b',
    symbol: 'CRO',
    chain: 'mainnet',
    pool: {
      address: '0x87b1d1b59725209879cc5c5adeb99d8bc9eccf12',
      quote: 'eth',
      inverse: false,
    },
    iconSlug: 'cro',
    website: 'https://cronos.org',
    tags: ['Infrastructure'],
  },
  // COW/WETH 100bps  TVL=$1,861,639
  {
    contract: '0xdef1ca1fb7fbcdc777520aa7f396b4e015f497ab',
    symbol: 'COW',
    chain: 'mainnet',
    pool: {
      address: '0xfcfdfc98062d13a11cec48c44e4613eb26a34293',
      quote: 'eth',
      inverse: true,
    },
    website: 'https://cow.fi',
    tags: ['DeFi'],
  },
  // SKY/WETH 30bps  TVL=$1,820,512
  {
    contract: '0x56072c95faa701256059aa122697b133aded9279',
    symbol: 'SKY',
    chain: 'mainnet',
    pool: {
      address: '0x764510ab1d39cf300e7abe8f5b8977d18f290628',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://sky.money',
    tags: ['DeFi'],
  },
  // gOHM/USDC 30bps  TVL=$555,411
  {
    contract: '0x0ab87046fbb341d058f17cbc4c1133f25a20a52f',
    symbol: 'gOHM',
    chain: 'mainnet',
    pool: {
      address: '0x08f68110f1e0ca67c80a24b4bd206675610f445d',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://www.olympusdao.finance',
    tags: ['DeFi'],
  },
  // OHM/WETH 100bps  TVL=$2,361,696
  {
    contract: '0x383518188c0c6d7730d91b2c03a03c837814a899',
    symbol: 'OHM',
    chain: 'mainnet',
    pool: {
      address: '0xf1b63cd9d80f922514c04b0fd0a30373316dd75b',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://www.olympusdao.finance',
    tags: ['DeFi'],
  },
  // CTSI/WETH 100bps  TVL=$383,656
  {
    contract: '0x491604c0fdf08347dd1fa4ee062a822a5dd06b5d',
    symbol: 'CTSI',
    chain: 'mainnet',
    pool: {
      address: '0x01949723055a451229c7ba3a817937c966748f76',
      quote: 'eth',
      inverse: false,
    },
    website: 'https://cartesi.io',
    tags: ['DeFi'],
  },
  // DUSK/USDT 30bps  TVL=$750,940
  {
    contract: '0x940a2db1b7008b6c776d4faaca729d6d4a4aa551',
    symbol: 'DUSK',
    chain: 'mainnet',
    pool: {
      address: '0xff29d3e552155180809ea3a877408a4620058086',
      quote: 'usd',
      inverse: false,
    },
    website: 'https://dusk.network',
    tags: ['DeFi'],
  },
  // FPIS/WETH 100bps  TVL=$434,074
  {
    contract: '0xc2544a32872a91f4a553b404c6950e89de901fdb',
    symbol: 'FPIS',
    chain: 'mainnet',
    pool: {
      address: '0xb2db69d6986fbf38de781ba606923f8ae8d7f437',
      quote: 'eth',
      inverse: true,
    },
    website: 'https://frax.finance',
    tags: ['DeFi'],
  },
];
