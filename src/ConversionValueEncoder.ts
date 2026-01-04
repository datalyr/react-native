import { SKANCoarseValue, SKANConversionResult } from './native/SKAdNetworkBridge';

// SKAN 4.0 compatible event mapping
interface EventMapping {
  bits: number[];
  revenueBits?: number[];
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
   * Encode an event with full SKAN 4.0 support (fine value, coarse value, lock window)
   */
  encodeWithSKAN4(event: string, properties?: Record<string, any>): SKANConversionResult {
    const mapping = this.template.events[event];
    if (!mapping) {
      return { fineValue: 0, coarseValue: 'low', lockWindow: false, priority: 0 };
    }

    let conversionValue = 0;

    // Set event bits
    for (const bit of mapping.bits) {
      conversionValue |= (1 << bit);
    }

    // Set revenue bits if revenue is provided
    let coarseValue: SKANCoarseValue = mapping.coarseValue || 'medium';
    if (mapping.revenueBits && properties) {
      const revenue = properties.revenue || properties.value || 0;
      const revenueTier = this.getRevenueTier(revenue);

      for (let i = 0; i < Math.min(mapping.revenueBits.length, 3); i++) {
        if ((revenueTier >> i) & 1) {
          conversionValue |= (1 << mapping.revenueBits[i]);
        }
      }

      // Upgrade coarse value based on revenue
      coarseValue = this.getCoarseValueForRevenue(revenue);
    }

    // Ensure value is within 0-63 range
    const fineValue = Math.min(conversionValue, 63);

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

// Industry templates with SKAN 4.0 support
export const ConversionTemplates = {
  // E-commerce template - optimized for online stores
  // SKAN 4.0: purchase locks window, high-value events get "high" coarse value
  ecommerce: {
    name: 'ecommerce',
    events: {
      purchase: { bits: [0], revenueBits: [1, 2, 3], priority: 100, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      add_to_cart: { bits: [4], priority: 30, coarseValue: 'low' as SKANCoarseValue },
      begin_checkout: { bits: [5], priority: 50, coarseValue: 'medium' as SKANCoarseValue },
      signup: { bits: [6], priority: 20, coarseValue: 'low' as SKANCoarseValue },
      subscribe: { bits: [0, 1], revenueBits: [2, 3, 4], priority: 90, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      view_item: { bits: [7], priority: 10, coarseValue: 'low' as SKANCoarseValue }
    }
  } as ConversionTemplate,

  // Gaming template - optimized for mobile games
  // SKAN 4.0: purchase locks window, tutorial completion is medium value
  gaming: {
    name: 'gaming',
    events: {
      level_complete: { bits: [0], priority: 40, coarseValue: 'medium' as SKANCoarseValue },
      tutorial_complete: { bits: [1], priority: 60, coarseValue: 'medium' as SKANCoarseValue },
      purchase: { bits: [2], revenueBits: [3, 4, 5], priority: 100, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      achievement_unlocked: { bits: [6], priority: 30, coarseValue: 'low' as SKANCoarseValue },
      session_start: { bits: [7], priority: 10, coarseValue: 'low' as SKANCoarseValue },
      ad_watched: { bits: [0, 6], priority: 20, coarseValue: 'low' as SKANCoarseValue }
    }
  } as ConversionTemplate,

  // Subscription template - optimized for subscription apps
  // SKAN 4.0: subscribe/upgrade lock window, trial is medium value
  subscription: {
    name: 'subscription',
    events: {
      trial_start: { bits: [0], priority: 70, coarseValue: 'medium' as SKANCoarseValue },
      subscribe: { bits: [1], revenueBits: [2, 3, 4], priority: 100, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      upgrade: { bits: [1, 5], revenueBits: [2, 3, 4], priority: 90, coarseValue: 'high' as SKANCoarseValue, lockWindow: true },
      cancel: { bits: [6], priority: 20, coarseValue: 'low' as SKANCoarseValue },
      signup: { bits: [7], priority: 30, coarseValue: 'low' as SKANCoarseValue },
      payment_method_added: { bits: [0, 7], priority: 50, coarseValue: 'medium' as SKANCoarseValue }
    }
  } as ConversionTemplate
}; 