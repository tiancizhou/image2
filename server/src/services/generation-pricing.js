const settings = require('./settings');

const SIZE_TIERS = {
  '1024x1024': '1k',
  '1536x1024': '2k',
  '1024x1536': '2k',
  '2048x2048': '2k',
  '3840x2160': '4k',
};

const DEFAULT_COSTS = {
  '1k': 1,
  '2k': 2,
  '4k': 4,
};

const SETTING_KEYS = {
  '1k': 'points_cost_1k',
  '2k': 'points_cost_2k',
  '4k': 'points_cost_4k',
};

function parseCost(value, fallback) {
  const cost = Number.parseInt(value, 10);
  return Number.isFinite(cost) && cost >= 0 ? cost : fallback;
}

async function getTierCosts() {
  const legacyCost = parseCost(await settings.get('points_per_generation'), DEFAULT_COSTS['1k']);
  const costs = {};

  for (const [tier, key] of Object.entries(SETTING_KEYS)) {
    const fallback = tier === '1k' ? legacyCost : DEFAULT_COSTS[tier];
    costs[tier] = parseCost(await settings.get(key), fallback);
  }

  return costs;
}

async function getCostForSize(size) {
  const tier = SIZE_TIERS[size] || SIZE_TIERS['1024x1024'];
  const costs = await getTierCosts();
  return costs[tier];
}

async function getPricingTable() {
  const costs = await getTierCosts();
  const sizes = {};

  for (const [size, tier] of Object.entries(SIZE_TIERS)) {
    sizes[size] = {
      tier,
      points_cost: costs[tier],
    };
  }

  return {
    tiers: costs,
    sizes,
  };
}

module.exports = {
  SIZE_TIERS,
  DEFAULT_COSTS,
  getCostForSize,
  getPricingTable,
};
