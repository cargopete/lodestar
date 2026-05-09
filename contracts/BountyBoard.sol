// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BountyBoard
 * @notice Experimental on-chain GRT escrow for subgraph sync bounties.
 *
 * Flow:
 *   1. Developer approves GRT spend, then calls post(deploymentId, amount, expiresAt).
 *   2. Indexer opens an allocation via SubgraphService.startService(), syncs the deployment,
 *      and submits a POI via SubgraphService.collect().
 *   3. Indexer calls claim(bountyId, allocationId). The contract verifies on-chain that:
 *        - the allocation belongs to the caller,
 *        - it is for the correct deployment,
 *        - it is still open (closedAt == 0), and
 *        - a POI was submitted AFTER the bounty was posted.
 *      First valid claim wins; GRT is transferred immediately.
 *   4. Developer can cancel after a 72-hour lock (gives indexers time to react).
 *   5. Expired unclaimed bounties can be refunded by anyone.
 *
 * @dev EXPERIMENTAL — unaudited. Use at your own risk.
 *      SubgraphService: 0xb2Bb92d0DE618878E438b55D5846cfecD9301105 (Arbitrum One)
 *      GRT:             0x9623063377AD1B27544C965cCd7342f7EA7e88C7 (Arbitrum One)
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @dev Mirrors IAllocation.State from graphprotocol/contracts subgraph-service package.
 *      Field order must match the deployed contract exactly or getAllocation() decodes garbage.
 *      Verified against Allocation.sol library (create() call parameter order).
 */
interface ISubgraphService {
    struct AllocationState {
        address indexer;
        bytes32 subgraphDeploymentId;
        uint256 tokens;
        uint256 createdAt;
        uint256 closedAt;
        uint256 lastPOIPresentedAt;
        uint256 accRewardsPerAllocatedToken;
        uint256 accRewardsPending;
        uint256 createdAtEpoch;
    }

    function getAllocation(address allocationId) external view returns (AllocationState memory);
}

contract BountyBoard {
    IERC20 public immutable GRT;
    ISubgraphService public immutable SUBGRAPH_SERVICE;

    /// @notice Minimum time after posting before the developer can cancel.
    uint256 public constant CANCEL_LOCK = 72 hours;

    struct Bounty {
        address developer;
        bytes32 deploymentId;
        uint256 amount;
        uint256 postedAt;
        uint256 expiresAt; // 0 = no expiry
        address winner;
        bool settled;
    }

    Bounty[] public bounties;

    event BountyPosted(
        uint256 indexed bountyId,
        address indexed developer,
        bytes32 indexed deploymentId,
        uint256 amount,
        uint256 expiresAt
    );
    event BountyClaimed(
        uint256 indexed bountyId,
        address indexed indexer,
        address allocationId
    );
    event BountyCancelled(uint256 indexed bountyId);
    event BountyRefunded(uint256 indexed bountyId);

    constructor(address grt, address subgraphService) {
        GRT = IERC20(grt);
        SUBGRAPH_SERVICE = ISubgraphService(subgraphService);
    }

    /// @notice Post a sync bounty. Caller must approve `amount` GRT first.
    /// @param deploymentId  IPFS deployment hash as bytes32 (strip 0x1220 multihash prefix).
    /// @param amount        GRT amount in wei (18 decimals).
    /// @param expiresAt     Unix timestamp; 0 for no expiry. Must be > now + 72h if set.
    function post(
        bytes32 deploymentId,
        uint256 amount,
        uint256 expiresAt
    ) external returns (uint256 bountyId) {
        require(amount > 0, "BountyBoard: amount must be > 0");
        require(
            expiresAt == 0 || expiresAt > block.timestamp + CANCEL_LOCK,
            "BountyBoard: expiry must be > 72h from now"
        );
        require(
            GRT.transferFrom(msg.sender, address(this), amount),
            "BountyBoard: GRT transfer failed"
        );

        bountyId = bounties.length;
        bounties.push(Bounty({
            developer: msg.sender,
            deploymentId: deploymentId,
            amount: amount,
            postedAt: block.timestamp,
            expiresAt: expiresAt,
            winner: address(0),
            settled: false
        }));

        emit BountyPosted(bountyId, msg.sender, deploymentId, amount, expiresAt);
    }

    /// @notice Claim a bounty. First valid caller wins and receives GRT immediately.
    /// @param bountyId     The on-chain bounty ID returned by post().
    /// @param allocationId The allocation address used in SubgraphService.startService().
    function claim(uint256 bountyId, address allocationId) external {
        Bounty storage b = bounties[bountyId];
        require(!b.settled, "BountyBoard: already settled");
        require(b.expiresAt == 0 || block.timestamp <= b.expiresAt, "BountyBoard: bounty expired");

        ISubgraphService.AllocationState memory state =
            SUBGRAPH_SERVICE.getAllocation(allocationId);

        require(state.indexer == msg.sender,                   "BountyBoard: not your allocation");
        require(state.subgraphDeploymentId == b.deploymentId,  "BountyBoard: wrong deployment");
        require(state.closedAt == 0,                           "BountyBoard: allocation is closed");
        require(
            state.lastPOIPresentedAt > b.postedAt,
            "BountyBoard: no POI submitted after bounty was posted"
        );

        b.settled = true;
        b.winner = msg.sender;
        require(GRT.transfer(msg.sender, b.amount), "BountyBoard: GRT transfer failed");

        emit BountyClaimed(bountyId, msg.sender, allocationId);
    }

    /// @notice Cancel a bounty and reclaim GRT. Only callable after CANCEL_LOCK has elapsed.
    function cancel(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        require(!b.settled,                "BountyBoard: already settled");
        require(b.developer == msg.sender, "BountyBoard: not your bounty");
        require(
            block.timestamp >= b.postedAt + CANCEL_LOCK,
            "BountyBoard: 72h cancel lock still active"
        );

        b.settled = true;
        require(GRT.transfer(b.developer, b.amount), "BountyBoard: GRT transfer failed");

        emit BountyCancelled(bountyId);
    }

    /// @notice Refund an expired unclaimed bounty to the developer. Anyone can call.
    function refundExpired(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        require(!b.settled,              "BountyBoard: already settled");
        require(b.expiresAt > 0,         "BountyBoard: no expiry set");
        require(block.timestamp > b.expiresAt, "BountyBoard: not yet expired");

        b.settled = true;
        require(GRT.transfer(b.developer, b.amount), "BountyBoard: GRT transfer failed");

        emit BountyRefunded(bountyId);
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        require(bountyId < bounties.length, "BountyBoard: does not exist");
        return bounties[bountyId];
    }

    function bountyCount() external view returns (uint256) {
        return bounties.length;
    }
}
