// ─────────────────────────────────────────────────────────────────────────────
//  Full BloomV1 ABI — every public / external function + all public state vars
// ─────────────────────────────────────────────────────────────────────────────

export const BLOOM_ABI = [
  // ── Views ──────────────────────────────────────────────────────────────────
  {
    name: "accountStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "gdBalance",         type: "uint256" },
      { name: "streaming",         type: "bool"    },
      { name: "recipient",         type: "address" },
      { name: "flowRate",          type: "uint96"  },
      { name: "streamEnd",         type: "uint256" },
      { name: "secondsLeft",       type: "uint256" },
      { name: "restreamCount",     type: "uint256" },
      { name: "restreamUnlocksAt", type: "uint256" },
    ],
  },
  {
    name: "previewEarlyStopFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "fee",       type: "uint256" },
      { name: "remaining", type: "uint256" },
    ],
  },
  {
    name: "routes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "multiHop",      type: "bool"    },
      { name: "fee1",          type: "uint24"  },
      { name: "fee2",          type: "uint24"  },
      { name: "fee3",          type: "uint24"  },
      { name: "intermediate",  type: "address" },
      { name: "intermediate2", type: "address" },
    ],
  },
  {
    name: "totalTrackedBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "collectedFees",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "recipientToUser",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  // ── Pure ───────────────────────────────────────────────────────────────────
  {
    name: "previewFlowRate",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "gdAmount",  type: "uint256" },
      { name: "duration",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint96" }],
  },
  {
    name: "minGdToStream",
    type: "function",
    stateMutability: "pure",
    inputs: [{ name: "duration", type: "uint256" }],
    outputs: [
      { name: "minRawUnits", type: "uint256" },
      { name: "minWholeGD",  type: "uint256" },
    ],
  },
  {
    name: "projectCompound",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "startRatePerDay", type: "uint256" },
      { name: "pctIncrease",     type: "uint256" },
      { name: "cycles",          type: "uint256" },
    ],
    outputs: [{ name: "ratePerDay", type: "uint256" }],
  },
  {
    name: "cyclesTo300k",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "startRatePerDay", type: "uint256" },
      { name: "pctIncrease",     type: "uint256" },
      { name: "targetPerDay",    type: "uint256" },
    ],
    outputs: [{ name: "cycles", type: "uint256" }],
  },
  // ── Writes ─────────────────────────────────────────────────────────────────
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn",  type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "splitBps", type: "uint256" },
      { name: "minGDOut", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "startStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "duration",  type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "stopStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "triggerExpiry",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    name: "increaseStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "newFlowRate", type: "uint96" },
    ],
    outputs: [],
  },
  {
    name: "decreaseStream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "newFlowRate", type: "uint96" },
    ],
    outputs: [],
  },
  {
    name: "restream",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newRecipient", type: "address" },
      { name: "duration",     type: "uint256" },
      { name: "newFlowRate",  type: "uint96"  },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  // ── Direct G$ deposit (no swap) ────────────────────────────────────────────
  {
    name: "depositGD",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  // ── Admin ─────────────────────────────────────────────────────────────────
  {
    name: "registerRoute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      {
        name: "route", type: "tuple",
        components: [
          { name: "multiHop",     type: "bool"    },
          { name: "fee1",         type: "uint24"  },
          { name: "fee2",         type: "uint24"  },
          { name: "fee3",         type: "uint24"  },
          { name: "intermediate", type: "address" },
          { name: "intermediate2", type: "address" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "pause",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "unpause",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "collectFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    name: "clearRoute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    name: "emergencyWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",  type: "address" },
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
