// Provider namespaces the server's webhooks join on `external_ids`. MUST match
// KNOWN_EXTERNAL_NAMESPACES in datalyr-v2/infra/cloudflare/lib/person-contract.js.
// One constant for both entry points (datalyr-sdk.ts and datalyr-sdk-expo.ts);
// pinned by tests/provider-namespaces.test.ts.
export const KNOWN_EXTERNAL_NAMESPACES: readonly string[] = [
  'revenuecat', 'superwall', 'stripe', 'shopify', 'whop', 'checkoutchamp',
  'clickfunnels', 'firebase',
  'klaviyo',
  'iclosed', 'commas', 'hubspot', 'calendly',
];
