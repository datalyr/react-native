import { SKANCoarseValue, SKANConversionResult } from './native/SKAdNetworkBridge';

// SKAN 4.0 conversion-value mapping (mixed model).
//
// SKAdNetwork's fine value is a 6-bit int (0-63) that can ONLY be revised upward, so we use
// Apple's recommended mixed model: the HIGH 3 bits hold a funnel rank (0-7, down-funnel =
// higher) and the LOW 3 bits hold a revenue tier (0-7). Higher-value events get higher
// values, so an early event (e.g. signup) can't lock the value and block a later, higher-
// value event (e.g. purchase) from registering — the bug in the old independent-bit scheme,
// where bits 6/7 also overflowed 63. The value→meaning mapping MUST match the SKAN
// conversion-value schema configured in the ad-network dashboard.
interface EventMapping {
  rank: number;             // 0-7 funnel stage → high 3 bits
  hasRevenue?: boolean;     // when true, revenue tier fills the low 3 bits
  priority: number;
  coarseValue?: SKANCoarseValue;  // SKAN 4.0: low, medium, high
  lockWindow?: boolean;           // SKAN 4.0: lock the conversion window after this event
}

interface ConversionTemplate {
  name: string;
  events: Record<string, EventMapping>;
}

export class ConversionValueEncoder {
  private template: ConversionTemplate;

  constructor(template: ConversionTemplate) {
    this.template = template;
  }

  /**
   * Encode an event into Apple's 0-63 conversion value format (SKAN 3.0 compatible)
   * @deprecated Use encodeWithSKAN4 for iOS 16.1+
   */
  encode(event: string, properties?: Record<string, any>): number {
    return this.encodeWithSKAN4(event, properties).fineValue;
  }

  /**
   * Encode an event with full SKAN 4.0 support (fine value, coarse value, lock window).
   * fineValue = (funnelRank << 3) | revenueTier.
   */
  encodeWithSKAN4(event: string, properties?: Record<string, any>): SKANConversionResult {
    const mapping = this.template.events[event];
    if (!mapping) {
      return { fineValue: 0, coarseValue: 'low', lockWindow: false, priority: 0 };
    }

    // High 3 bits = funnel rank.
    let conversionValue = (mapping.rank & 0x7) << 3;

    // Low 3 bits = revenue tier (only for monetary events).
    let coarseValue: SKANCoarseValue = mapping.coarseValue || 'medium';
    if (mapping.hasRevenue && properties) {
      const revenue = properties.revenue || properties.value || 0;
      conversionValue |= this.getRevenueTier(revenue);
      coarseValue = this.getCoarseValueForRevenue(revenue);
    }

    // (rank<<3)|tier is already within 0-63 for rank/tier in 0-7; clamp defensively.
    const fineValue = Math.min(Math.max(conversionValue, 0), 63);

    return {
      fineValue,
      coarseValue,
      lockWindow: mapping.lockWindow || false,
      priority: mapping.priority
    };
  }

  /**
   * Map revenue amount to 3-bit tier (0-7)
   */
  private getRevenueTier(revenue: number): number {
    if (revenue < 1) return 0;      // $0-1
    if (revenue < 5) return 1;      // $1-5
    if (revenue < 10) return 2;     // $5-10
    if (revenue < 25) return 3;     // $10-25
    if (revenue < 50) return 4;     // $25-50
    if (revenue < 100) return 5;    // $50-100
    if (revenue < 250) return 6;    // $100-250
    return 7;                       // $250+
  }

  /**
   * Map revenue to SKAN 4.0 coarse value
   */
  private getCoarseValueForRevenue(revenue: number): SKANCoarseValue {
    if (revenue < 10) return 'low';      // $0-10 = low value
    if (revenue < 50) return 'medium';   // $10-50 = medium value
    return 'high';                       // $50+ = high value
  }
}

// Industry templates (mixed model). Fine values are funnelRank<<3 | revenueTier, within
// 0-63 and ordered so down-funnel/higher-value events get HIGHER values (SKAN revises only
// upward). Ranks are a sensible default — tune the event→rank order to your LTV model and
// mirror the final value→meaning mapping into your SKAN dashboard schema.
export const ConversionTemplates = {
  // E-commerce. view_item 8 · signup 16 · add_to_cart 24 · begin_checkout 32 ·
  // subscribe 48-55 · purchase 56-63 (+ revenue tier).
  ecommerce: {
    name: 'ecommerce',
    events: {
      view_item: { rank: 1, priority: 10, coarseValue: 'low' as SKANCoarseValue },
      signup: { rank: 2, priority: 20, coarseValue: 'low' as SKANCoarseValue },
      add_to_cart: { rank: 3, priority: 30, coarseValue: 'low' as SKANCoarseValue },
      begin_checkout: { rank: 4, priority: 50, coarseValue: 'medium' as SKANCoarseValue },
      subscribe: { rank: 6, hasRevenue: true, priority: 90, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      purchase: { rank: 7, hasRevenue: true, priority: 100, coarseValue: 'high' as SKANCoarseValue, lockWindow: true }
    }
  } as ConversionTemplate,

  // Gaming. session_start 8 · ad_watched 16 · level_complete 24 · tutorial_complete 32 ·
  // achievement_unlocked 40 · purchase 56-63 (+ revenue tier).
  gaming: {
    name: 'gaming',
    events: {
      session_start: { rank: 1, priority: 10, coarseValue: 'low' as SKANCoarseValue },
      ad_watched: { rank: 2, priority: 20, coarseValue: 'low' as SKANCoarseValue },
      level_complete: { rank: 3, priority: 40, coarseValue: 'medium' as SKANCoarseValue },
      tutorial_complete: { rank: 4, priority: 60, coarseValue: 'medium' as SKANCoarseValue },
      achievement_unlocked: { rank: 5, priority: 30, coarseValue: 'low' as SKANCoarseValue },
      purchase: { rank: 7, hasRevenue: true, priority: 100, coarseValue: 'high' as SKANCoarseValue, lockWindow: true }
    }
  } as ConversionTemplate,

  // Subscription. cancel 8 · signup 16 · payment_method_added 24 · trial_start 32 ·
  // upgrade 48-55 · subscribe 56-63 (+ revenue tier).
  subscription: {
    name: 'subscription',
    events: {
      cancel: { rank: 1, priority: 20, coarseValue: 'low' as SKANCoarseValue },
      signup: { rank: 2, priority: 30, coarseValue: 'low' as SKANCoarseValue },
      payment_method_added: { rank: 3, priority: 50, coarseValue: 'medium' as SKANCoarseValue },
      trial_start: { rank: 4, priority: 70, coarseValue: 'medium' as SKANCoarseValue },
      upgrade: { rank: 6, hasRevenue: true, priority: 90, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      subscribe: { rank: 7, hasRevenue: true, priority: 100, coarseValue: 'high' as SKANCoarseValue, lockWindow: true }
    }
  } as ConversionTemplate
};
