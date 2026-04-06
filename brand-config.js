/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  BRAND CONFIGURATION — Pacific Coast Ponds                      ║
 * ║                                                                  ║
 * ║  Single source of truth for all branding constants.              ║
 * ║  To rebrand, update this file — then search the codebase for     ║
 * ║  any remaining hardcoded values that reference the old brand.    ║
 * ║                                                                  ║
 * ║  Usage (browser):                                                ║
 * ║    <script src="/brand-config.js"></script>                      ║
 * ║    Then access window.BRAND.company.name, etc.                   ║
 * ║                                                                  ║
 * ║  Usage (Node / serverless functions):                            ║
 * ║    const BRAND = require('../brand-config.js');                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const BRAND = {

  /* ── Company Identity ─────────────────────────────────────────── */
  company: {
    name:        'Pacific Coast Ponds',
    nameShort:   'PCP',                        // used in PWA names, order prefixes
    tagline:     'Custom Aquatic Design',
    owner:       'Gianni Zuccolotto',
    phone:       '(949) 541-4903',
    phoneTel:    '+19495414903',               // tel: link format
    licenseNo:   '#1137057',
    licenseLabel:'CA Licensed Contractor #1137057',
    warranty:    '5-Year Warranty',
  },

  /* ── Domains & URLs ───────────────────────────────────────────── */
  domains: {
    marketing:   'paccoastponds.com',
    portal:      'my.paccoastponds.com',
    tech:        'tech.paccoastponds.com',
    admin:       'admin.paccoastponds.com',
    shop:        'shop.paccoastponds.com',
    sales:       'sales.paccoastponds.com',
  },

  urls: {
    marketing:   'https://paccoastponds.com',
    portal:      'https://my.paccoastponds.com',
    tech:        'https://tech.paccoastponds.com',
    admin:       'https://admin.paccoastponds.com',
    shop:        'https://shop.paccoastponds.com',
    sales:       'https://sales.paccoastponds.com',
    calendly:    'https://calendly.com/paccoastponds',
  },

  /* ── Email ────────────────────────────────────────────────────── */
  email: {
    noreply:     'noreply@paccoastponds.com',
    build:       'build@paccoastponds.com',
    fromName:    'Pacific Coast Ponds',
    fromLine:    'Pacific Coast Ponds <noreply@paccoastponds.com>',
  },

  /* ── Colors ───────────────────────────────────────────────────── */
  colors: {
    dark:        '#0F1C12',     // forest green — headers, PWA background
    green:       '#1E5E37',     // primary brand green — buttons, accents, PWA theme
    blue:        '#2CA7DF',     // secondary accent blue
    cream:       '#F8FAF7',     // light background
  },

  /* CSS custom properties string — drop into :root{} */
  cssVars: ':root{--brand-green:#1E5E37;--brand-blue:#2CA7DF;--brand-cream:#F8FAF7;--brand-dark:#0F1C12;}',

  /* ── Logo ─────────────────────────────────────────────────────── */
  logo: {
    url:         'https://paccoastponds.com/assets/logo.webp',
    localPath:   '/assets/logo.webp',          // relative to marketing site root
    altText:     'Pacific Coast Ponds',
    emailHeight: '52px',
  },

  /* ── PWA Manifests ────────────────────────────────────────────── */
  pwa: {
    tech: {
      name:        'PCP Tech',
      shortName:   'PCP Tech',
      description: 'Pacific Coast Ponds — Technician App',
    },
    sales: {
      name:        'PCP Sales',
      shortName:   'PCP Sales',
      description: 'Pacific Coast Ponds — Sales Portal',
    },
    backgroundColor: '#0F1C12',
    themeColor:      '#1E5E37',
  },

  /* ── Service Area ─────────────────────────────────────────────── */
  serviceArea: {
    primary:     'Orange County',
    state:       'CA',
    region:      'Southern California',
    baseCity:    'San Clemente, CA',
    counties:    ['Orange County', 'Los Angeles', 'San Diego', 'Riverside'],
    cities:      [
      'Irvine', 'Newport Beach', 'Mission Viejo', 'Yorba Linda',
      'Anaheim Hills', 'Laguna Niguel', 'San Clemente', 'Dana Point',
      'Laguna Beach', 'Huntington Beach',
    ],
    fulfillment: {
      address:   '2600 Michelson Dr',
      city:      'Irvine',
      state:     'CA',
      zip:       '92612',
    },
  },

  /* ── Pricing ──────────────────────────────────────────────────── */
  pricing: {
    maintenance: {
      weekly:    325,
      biweekly:  265,
      monthly:   195,
    },
    /* Sales portal uses separate defaults (higher weekly rate includes initiation) */
    sales: {
      weekly:    450,
      biweekly:  265,
      monthly:   195,
    },
    constructionStartsAt: 20000,
    addons: {
      onCall:         199,   // 24/7 On-Call
      priority:        29,   // Priority Scheduling
      annualCleanouts: 79,   // Two Annual Cleanouts
    },
  },

  /* ── Tracking & Analytics ─────────────────────────────────────── */
  tracking: {
    googleAdsId: 'AW-17993828944',
    gtmId:       'GTM-TSRCNDJR',
  },

  /* ── E-Commerce ───────────────────────────────────────────────── */
  shop: {
    orderPrefix:       'PCP-',
    orderPadLength:    5,
    freeShippingMin:   99,
    flatRateShipping:  8.99,
    flatRateHeavy:     14.99,
    subscribeSaveDiscount: 0.05,  // 5%
  },

  /* ── Trust Badges ─────────────────────────────────────────────── */
  trustBadges: [
    'Licensed Contractor',
    '5-Year Warranty',
    'Engineered Filtration',
    'Fixed-Price Quotes',
    'Free 3D Rendering',
  ],

  /* ── Email Footer ─────────────────────────────────────────────── */
  emailFooter: {
    line1: 'Pacific Coast Ponds \u2022 Orange County, CA',
    line2: 'Licensed Contractor \u2022 5-Year Warranty',
  },

  /* ── Chat Assistant ───────────────────────────────────────────── */
  chatbot: {
    name: 'Koi',
  },

  /* ── Email Template Helpers ───────────────────────────────────── */

  /** Returns the standard HTML email header block */
  emailHeader() {
    return `<div style="background:${this.colors.dark};padding:32px;text-align:center;">
      <img src="${this.logo.url}" alt="${this.logo.altText}"
           style="height:${this.logo.emailHeight};display:block;margin:0 auto 10px;" />
      <p style="margin:0;color:rgba(255,255,255,.5);font-size:12px;letter-spacing:1px;text-transform:uppercase;">${this.company.tagline}</p>
    </div>`;
  },

  /** Returns the standard HTML email footer block */
  emailFooterHtml() {
    return `<div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-weight:600;">${this.emailFooter.line1}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">${this.emailFooter.line2}</p>
    </div>`;
  },
};


/* ── Universal Export ───────────────────────────────────────────── */
// Works in both browser (window.BRAND) and Node (require/import)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BRAND;
} else if (typeof window !== 'undefined') {
  window.BRAND = BRAND;
}
