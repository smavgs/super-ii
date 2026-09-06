# Agent commerce architecture

Super ii lets a human deliberately delegate bounded order preparation to an AI
agent without turning the Work credential into a payment credential and without
operating a wallet or blockchain payment rail.

## Boundary

The authenticated account owner creates a separate `sii_commerce_` credential.
Only its SHA-256 hash and a short display prefix are stored. Its authority is the
intersection of:

- exact allowed product identifiers;
- maximum USD cents for one order;
- maximum cumulative USD cents authorized;
- maximum number of orders;
- expiry of no more than 30 days;
- optional organization or repository boundary; and
- explicit revocation.

The existing `sii_agent_` Work token keeps its database constraint
`spend_limit_cents = 0`. Social credentials also remain separate. No credential
can silently cross those boundaries.

Super ii never accepts a seed phrase or wallet private key, never signs a
transaction, never automatically debits a wallet, and never holds customer
funds. An agent that has separately authorized wallet tooling can use the exact
invoice returned by Super ii under that wallet tool's own policy.

## Canonical products

| Product ID | Target | Exact USD price | Existing fulfillment |
| --- | --- | ---: | --- |
| `plan.pro.30d` | profile | $9.00 | 30-day Pro entitlement |
| `plan.pro.12m` | profile | $86.40 | 12-month Pro entitlement |
| `plan.team.30d` | organization | $20.00/member | 30-day Team entitlement |
| `plan.team.12m` | organization | $192.00/member | 12-month Team entitlement |
| `highlight.24h` | reviewed public repository | $1.00 | 24-hour Highlight campaign |
| `highlight.30d` | reviewed public repository | $15.00 | 30-day Highlight campaign |
| `recognition.founding200` | profile | $200.00 | next available Founding 200 place |
| `enterprise.quote` | profile | quote first | human-reviewed proposal request |

The TypeScript catalog and PostgreSQL constraints both encode these values.
Clients never provide the price. Team seats cannot be below current membership;
Highlight targets must already be controlled, reviewed, published, and public;
Founding inventory is locked and allocated in order.

## Order lifecycle

1. The agent reads `/.well-known/commerce.json`.
2. It optionally checks eligibility using its commerce Bearer credential.
3. It creates an order with a stable idempotency key.
4. PostgreSQL locks the delegation and atomically repeats product, target,
   ownership, seat, inventory, budget, count, expiry, and revocation checks.
5. The transaction creates exactly one existing plan or participation order and
   consumes the delegation's count and cumulative amount.
6. The server asks NOWPayments for a fixed-rate USDC invoice associated with the
   existing order ID. Invoice creation is not fulfillment. A provider response
   must be stored before a callback can update that order. A timed-out creation
   claim can be retried after two minutes, with no more than three attempts.
7. A signed IPN, or a separately verified provider-status read, must match the
   provider payment ID, local order reference, exact USD price, USDC asset, and
   Ethereum route before the existing fulfillment function runs.
8. The first transition to `finished` produces one immutable receipt containing
   canonical evidence and its SHA-256. Exact retries do not duplicate the order,
   entitlement, campaign, Founding place, or receipt.
9. A later refund invokes the existing revocation behavior. The receipt remains
   as historical evidence and is not presented as current entitlement.

An expired or unpaid invoice does not restore delegated authority automatically.
This conservative accounting prevents an agent from creating unlimited external
invoices by repeatedly waiting for expiration.

## Interfaces

- REST catalog: `GET /api/commerce/catalog`
- REST eligibility: `POST /api/commerce/eligibility`
- REST order creation: `POST /api/commerce/orders`
- REST order status: `GET /api/commerce/orders/{order_id}`
- REST receipt: `GET /api/commerce/receipts/{receipt_id}`
- REST Enterprise request: `POST /api/commerce/quote-requests`
- MCP: `/mcp/commerce`
- A2A card: `/.well-known/commerce-agent-card.json`
- A2A send: `POST /a2a/commerce/v1/message:send`
- Human issuance and revocation: `/account#commerce`

REST and MCP mutations are bounded and rate limited. Every mutation requires a
16–200 character idempotency key, reused only for an exact retry. Orders and
receipts are visible only through the delegation that created them; human
account management sees delegation metadata but never retrieves the raw token.

## Verification

`database/tests/commerce_smoke.sql` exercises exact prices, annual Team seats,
reviewed repository eligibility, Founding allocation, idempotency conflicts,
budget and count exhaustion, target boundaries, revocation, payment activation,
refund revocation, quote requests, zero partial state, receipt immutability, and
the Work token's zero-spend constraint inside a rolled-back PostgreSQL 17 test.

`tools/check-commerce.mjs` independently checks the database, REST, MCP, A2A,
Workspace, OpenAPI, machine guides, security disclosures, privacy terms, and the
absence of raw credential-shaped values. Production verification must avoid
creating or paying a real invoice: anonymous catalog reads and unauthenticated
fail-closed checks are sufficient for a deployment smoke test.
