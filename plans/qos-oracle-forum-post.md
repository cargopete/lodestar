# the qos oracle has been down for a month and nobody could tell

posting this because the current stall is the smaller half of the story, and the bigger half is
something none of us could see from the outside until we went looking.

everything below is verifiable from the chain and from public ipfs. no insider access, no special
permissions. anyone can reproduce it.

## what is actually broken

there are two separate failures and they got confused with each other.

the one everyone noticed: the publisher stops posting. it did that on 2026-07-29 for about 38 hours,
and it is doing it again right now, 37 hours and counting since the last post at 2026-08-04 00:00 UTC.
that is bad but at least it is visible if you know to look at the DataEdge on gnosis.

the one nobody noticed: since **2026-07-01** the oracle's subgraph has rejected every single message
the publisher sends. it is synced to chain tip, it reports `hasIndexingErrors: false`, and it
discards every post with

```
valid: false
errorMessage: "0x8cbbe43f97f80efa6ba0a95f3d544e03f84db0ce is not a valid submitter."
```

that address is the publisher. the same one that has been posting all along.

so the newest `OracleMessage` in the subgraph is from 2026-08-04, and the newest
`MessageDataPoint` it actually produced is from **2026-07-01 03:20**. over a month where the posts
kept arriving and none of them became data.

if you have been querying that subgraph at any point in the last month you have been getting july 1st
numbers. it does not error, it does not warn, it just answers with old data. a stale subgraph answers
exactly like a fresh one.

## the data was never missing

this is the part that changes what we should ask for.

the CIDs are all on gnosis in the DataEdge calldata, permanently. the payloads are pinned and
fetchable from public ipfs right now. i pulled one from inside the gap, 2026-07-04, and got a 1.86MB
json array with 2741 per-allocation records in it - indexer_wallet, subgraph_deployment_ipfs_hash,
query_count, proportion_indexer_200_responses, avg_indexer_latency_ms, avg_indexer_blocks_behind,
stdev_indexer_latency_ms, total_query_fees, all of it.

every number the subgraph would have materialised was sitting there the whole time. it just never got
decoded.

so the problem is not access to data. the problem is that there is exactly one decoder, one team runs
it, and when it silently stops accepting messages the entire network's view of indexer quality stops
with it and nothing says so.

## what i am not asking for

i am not asking e&n to publish the raw gateway logs. those contain api keys, user ids and
per-customer traffic. that is genuinely their business and it genuinely should not be public. it is
also unnecessary, because the aggregated payloads are already public.

## what would actually fix it

four things, none of them expensive, none of them giving up anything commercially sensitive.

**publish and bless the decoder.** there is a public reference subgraph
(`juanmardefago/gateway-qos-oracle-example-subgraph`) but it is named "example" and i cannot tell
whether it matches what is deployed at `Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D`. confirm which
source produces the live one and keep it current. then anyone can deploy their own and the network
stops depending on a single deployment run by a single team.

**make the submitter set auditable.** whatever governs "is this a valid submitter" should be
inspectable, ideally on chain. if it had been, this would have been a ten minute diagnosis on july
1st instead of a month of silence. right now a change to that list is indistinguishable from the
oracle simply going quiet.

**document the payload format.** the schema of what lands on ipfs. i reverse engineered it from bytes
this week and it was not hard, but nobody should have to, and a documented format means third parties
can decode independently without guessing.

**treat gateway_id as the multi-publisher field it already is.** every entity in that schema carries
`gateway_id`. the format was clearly designed for more than one gateway to publish. if that is
supported, say so and document how, and qos stops being a single-operator service by construction.

## this is not hypothetical, it already works

lodestar decodes the same chain and the same ipfs files independently and publishes what it finds at
https://www.lodestar-dashboard.com/qos - the canonical numbers mirrored, plus our own probe
measurements labelled separately so nobody confuses the two.

we also hold 2479 payloads captured straight from the CIDs, 2.6GB, for the window their subgraph
threw away.

i am not saying this to advertise. i am saying it because it means the ask above is small. a second
implementation already exists and produces the same numbers, which is the evidence that the decoder
does not need to be a single point of failure.

## what the community can do meanwhile

watch three things, not one, because watching one is how this hid for a month:

is the publisher posting - read the DataEdge on gnosis directly, not through the subgraph.

is the decoder accepting - check `OracleMessage.valid` on the newest message. if it is false, no new
data is being produced no matter how healthy everything else looks.

how old is the data you are actually reading - the newest `dayNumber`, compared against now. this is
the one that catches everything, and it is the one nobody had.

happy to share the queries for all three, they are a few lines each.

## the short version

the qos oracle's data has been public and fetchable this entire time. what failed is the only
sanctioned way to read it, and it failed silently for over a month. making the decoder something the
community can run, and making the submitter list auditable, costs almost nothing and means this
cannot happen again quietly.

thanks to @Yash for chasing this internally, genuinely appreciated.
