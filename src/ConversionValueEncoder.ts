// Interface definitions
interface EventMapping {
  bits: number[];
  revenueBits?: number[];
  priority: number;
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
   * Encode an event into Apple's 0-63 conversion value format
   */
  encode(event: string, properties?: Record<string, any>): number {
    const mapping = this.template.events[event];
    if (!mapping) return 0;

    let conversionValue = 0;

    // Set event bits
    for (const bit of mapping.bits) {
      conversionValue |= (1 << bit);
    }

    // Set revenue bits if revenue is provided
    if (mapping.revenueBits && properties) {
      const revenue = properties.revenue || properties.value || 0;
      const revenueTier = this.getRevenueTier(revenue);
      
      for (let i = 0; i < Math.min(mapping.revenueBits.length, 3); i++) {
        if ((revenueTier >> i) & 1) {
          conversionValue |= (1 << mapping.revenueBits[i]);
        }
      }
    }

    return Math.min(conversionValue, 63);
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
}

// Industry templates
export const ConversionTemplates = {
  ecommerce: {
    name: 'ecommerce',
    events: {
      purchase: { bits: [0], revenueBits: [1, 2, 3], priority: 100 },
      add_to_cart: { bits: [4], priority: 30 },
      begin_checkout: { bits: [5], priority: 50 },
      signup: { bits: [6], priority: 20 },
      subscribe: { bits: [0, 1], revenueBits: [2, 3, 4], priority: 90 },
      view_item: { bits: [7], priority: 10 }
    }
  } as ConversionTemplate,
  
  gaming: {
    name: 'gaming',
    events: {
      level_complete: { bits: [0], priority: 40 },
      tutorial_complete: { bits: [1], priority: 60 },
      purchase: { bits: [2], revenueBits: [3, 4, 5], priority: 100 },
      achievement_unlocked: { bits: [6], priority: 30 },
      session_start: { bits: [7], priority: 10 },
      ad_watched: { bits: [0, 6], priority: 20 }
    }
  } as ConversionTemplate,
  
  subscription: {
    name: 'subscription',
    events: {
      trial_start: { bits: [0], priority: 70 },
      subscribe: { bits: [1], revenueBits: [2, 3, 4], priority: 100 },
      upgrade: { bits: [1, 5], revenueBits: [2, 3, 4], priority: 90 },
      cancel: { bits: [6], priority: 20 },
      signup: { bits: [7], priority: 30 },
      payment_method_added: { bits: [0, 7], priority: 50 }
    }
  } as ConversionTemplate
}; 