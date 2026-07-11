/**
 * Shared e-commerce property builders (A3-14c / TR-20c).
 *
 * The bare (`datalyr-sdk.ts`) and Expo (`datalyr-sdk-expo.ts`) entry points historically
 * shaped the SAME conversion event with DIFFERENT property keys:
 *
 *   helper                    bare emitted            Expo emitted
 *   ------------------------  ----------------------  --------------------------
 *   trackAddToCart            product_id/_name        content_id/_name
 *   trackInitiateCheckout     product_ids             content_ids
 *   trackCompleteRegistration method                  registration_method
 *   trackSearch               query / result_ids      search_string / content_ids
 *
 * The server-side postback `fromAny()` mapping reads the Meta-canonical name FIRST and the
 * legacy name as a fallback (e.g. `['content_ids', 'product_ids']`, `['search_string',
 * 'query']`), so neither build was broken on the wire — but two builds produced two shapes,
 * so a merchant dashboard / conversion-rule keyed on one spelling only saw half its traffic,
 * and Meta/TikTok/Snap custom_data forwarding differed by platform build.
 *
 * These builders are the SINGLE source of truth for both entry points. They are pure (no
 * react-native / expo native imports), so both builds import them directly — unlike
 * `normalizeEventName`, which had to be duplicated into `utils.ts` + `utils-expo.ts` because
 * those modules pull in native deps.
 *
 * Each builder emits BOTH the canonical Meta key (server-preferred, forwarded verbatim to
 * Pixel/CAPI) AND the legacy alias, so existing dashboards / rules keyed on either spelling
 * keep working — the same emit-both-names strategy the web SDK uses for `utm_*` (FSR-13).
 */

type Props = Record<string, any>;

/** purchase / one primary product id. Both builds already emitted `product_id`; we add the
 *  canonical `content_id` alias so a rule keyed on Meta's name resolves too. `value` +
 *  `revenue` are both emitted (value_path='value' must not yield $0; SKAN/value_usd read either). */
export function purchaseProperties(value: number, currency: string, productId?: string): Props {
  const p: Props = { value, revenue: value, currency };
  if (productId) { p.product_id = productId; p.content_id = productId; }
  return p;
}

export function addToCartProperties(
  value: number,
  currency: string,
  contentId?: string,
  contentName?: string
): Props {
  const p: Props = { value, currency };
  if (contentId) { p.content_id = contentId; p.product_id = contentId; }
  if (contentName) { p.content_name = contentName; p.product_name = contentName; }
  return p;
}

export function viewContentProperties(
  contentId?: string,
  contentName?: string,
  contentType: string = 'product',
  value?: number,
  currency?: string
): Props {
  const p: Props = { content_type: contentType };
  if (contentId) { p.content_id = contentId; p.product_id = contentId; }
  if (contentName) { p.content_name = contentName; p.product_name = contentName; }
  if (value !== undefined) p.value = value;
  if (currency) p.currency = currency;
  return p;
}

export function initiateCheckoutProperties(
  value?: number,
  currency?: string,
  numItems?: number,
  contentIds?: string[]
): Props {
  const p: Props = {};
  if (value !== undefined) p.value = value;
  if (currency) p.currency = currency;
  if (numItems !== undefined) p.num_items = numItems;
  if (contentIds) { p.content_ids = contentIds; p.product_ids = contentIds; }
  return p;
}

export function completeRegistrationProperties(registrationMethod?: string): Props {
  const p: Props = {};
  if (registrationMethod) { p.registration_method = registrationMethod; p.method = registrationMethod; }
  return p;
}

export function searchProperties(searchString: string, contentIds?: string[]): Props {
  const p: Props = { search_string: searchString, query: searchString };
  if (contentIds) { p.content_ids = contentIds; p.result_ids = contentIds; }
  return p;
}

export function leadProperties(value?: number, currency?: string): Props {
  const p: Props = {};
  if (value !== undefined) p.value = value;
  if (currency) p.currency = currency;
  return p;
}
