# reply to post on GRC-009 thread

Draft. Written before seeing tmigone's reply - check it before posting, it may change what needs
answering.

---

update, and a correction to my own proposal.

juan got in touch and filled in a lot of history i did not have. posting it because it changes what i
think should happen, and because most of it is not written down anywhere public.

**on v1.** it would work again if the subgraph were redeployed with a new whitelisted submitter. but
that means a resync, and a resync means dropping old data, because fetching a year of payloads back
from ipfs is too slow to be practical. so the fix is real but it is not free, and it costs history.

**on v2.** it is feature complete. it was never pushed to main because it needed testing against a
production gateway, and because the design has each gateway operator running it themselves - and
maintaining a clickhouse db with a year of qos data is not something e&n wanted to take on. so it
stalled on operational appetite, not on code.

worth saying plainly: v2 is not an oracle. it is a graphql endpoint that a gateway operator hosts and
serves their own data from. that is a better shape than what we have now and i did not know it
already existed.

**on my own proposal, which i now think is wrong in part.** i specced publishing qos summaries as
events on arbitrum, with a self hosted indexer over them, so that no single decoder could take the
whole thing down. juan has already been down that road: this data does not scale well onchain,
ipfs/arweave were too slow and unreliable especially for resyncs, and - the part i had not thought
about properly - verifiability was never actually a requirement here. the data is inherently trusted.
whatever the gateway reports is what exists. there is no second source to check it against, so
cryptographic verification of it does not buy anyone anything.

so i am dropping the onchain publication layer from what i proposed. it was solving a problem that
does not exist, and the person who tried it first already found that out.

**what i still think is worth building**, and what it is not:

we are going ahead with direct probing of indexer endpoints, paid with tap receipts so we can choose
which indexer answers rather than having a gateway choose for us. that gives latency, success rate,
chainhead lag, and one thing no gateway telemetry can produce: correctness. we canonicalise responses
with JCS, hash and cluster them, so an indexer that is fast and returns 200s and serves the wrong
data shows up as wrong. v1 and v2 both count status codes, which cannot see that by construction.

what it does **not** give, and i want to be clear because i was sloppy about this earlier in the
thread: it does not give demand. query_count, served share, "why am i not getting traffic". those are
facts about which indexers a gateway chose to route to, and you cannot derive them without having
served the queries. no amount of probing produces them. that half stays with whoever runs a gateway
with real users.

juan also raised two fair criticisms i want to acknowledge rather than argue with. what we measure is
not what the gateway measures, so our numbers cannot tell you whether your qos is affecting how the
gateway routes to you. and probing indexer endpoints at volume could get probers blocked, which is a
real risk i had not considered and will think about before scaling cadence up.

**a concrete offer.** v2 needs testing against a production gateway with a redpanda/kafka instance.
lodestar runs its own gateway, a fork of edgeandnode/gateway, and our compose stack already ships
redpanda, and the gateway is already writing to gateway_queries and gateway_attestations. so we can
hook v2 up and actually test it. happy to run the clickhouse side too - we are not e&n and we do not
mind maintaining it.

that would unblock something that has been sitting finished for two years, and it would prove the
multi publisher model works with someone other than e&n operating it.

**what i would still ask for**, unchanged from the original post and cheap either way: confirm which
source produces the deployed subgraph, make the submitter set inspectable, and document the payload
format. the monitoring point stands too - watch publisher liveness, decoder acceptance, and data age
as three separate things, because watching only one is how a month went by.

thanks juan for the detail, genuinely useful, and it saved me building the wrong thing.
