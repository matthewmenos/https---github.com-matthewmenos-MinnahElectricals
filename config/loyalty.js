const { pool } = require('./db');

/**
 * Get loyalty program settings from the settings table
 * Returns defaults if not configured
 */
async function getLoyaltySettings() {
  try {
    const result = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('loyalty_points_per_ghs', 'loyalty_silver_threshold', 'loyalty_gold_threshold', 'loyalty_platinum_threshold', 'loyalty_auto_enroll')"
    );
    
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    return {
      points_per_ghs: parseFloat(settings.loyalty_points_per_ghs) || 1,
      silver_threshold: parseInt(settings.loyalty_silver_threshold) || 100,
      gold_threshold: parseInt(settings.loyalty_gold_threshold) || 500,
      platinum_threshold: parseInt(settings.loyalty_platinum_threshold) || 1000,
      auto_enroll: settings.loyalty_auto_enroll !== 'false'
    };
  } catch (error) {
    console.error('✗ Error fetching loyalty settings:', error.message);
    return {
      points_per_ghs: 1,
      silver_threshold: 100,
      gold_threshold: 500,
      platinum_threshold: 1000,
      auto_enroll: true
    };
  }
}

/**
 * Calculate tier based on total points
 */
function calculateTier(points, settings) {
  if (points >= settings.platinum_threshold) return 'platinum';
  if (points >= settings.gold_threshold) return 'gold';
  if (points >= settings.silver_threshold) return 'silver';
  return 'bronze';
}

/**
 * Auto-enroll a customer in the loyalty program if they're not already a member
 * Returns the member record or null if auto-enroll is disabled
 */
async function autoEnrollCustomer(customer_phone, customer_name, customer_email) {
  try {
    const settings = await getLoyaltySettings();
    
    if (!settings.auto_enroll) return null;

    // Check if member already exists
    const existingResult = await pool.query(
      'SELECT * FROM loyalty_program WHERE customer_phone = $1',
      [customer_phone]
    );

    if (existingResult.rows[0]) {
      // Update email if provided and member doesn't have one
      if (customer_email && !existingResult.rows[0].customer_email) {
        await pool.query(
          'UPDATE loyalty_program SET customer_email = $1, updated_at = CURRENT_TIMESTAMP WHERE customer_phone = $2',
          [customer_email, customer_phone]
        );
      }
      return existingResult.rows[0];
    }

    // Auto-enroll new member
    const insertResult = await pool.query(
      `INSERT INTO loyalty_program (customer_phone, customer_name, customer_email, points, tier) 
       VALUES ($1, $2, $3, 0, 'bronze') 
       RETURNING *`,
      [customer_phone, customer_name, customer_email || null]
    );

    console.log(`✓ Auto-enrolled loyalty member: ${customer_phone} (${customer_name})`);
    return insertResult.rows[0];
  } catch (error) {
    console.error('✗ Error auto-enrolling loyalty member:', error.message);
    return null;
  }
}

/**
 * Award loyalty points to a member for an order
 * Automatically updates points, total_spent, total_orders, and tier
 */
async function awardLoyaltyPoints(customer_phone, orderTotal, orderId, description) {
  try {
    const settings = await getLoyaltySettings();

    // Check if member exists
    const memberResult = await pool.query(
      'SELECT * FROM loyalty_program WHERE customer_phone = $1',
      [customer_phone]
    );

    if (!memberResult.rows[0]) return null;

    const member = memberResult.rows[0];
    const pointsEarned = Math.floor(orderTotal * settings.points_per_ghs);
    
    if (pointsEarned <= 0) return null;

    const newPoints = (member.points || 0) + pointsEarned;
    const newTotalSpent = parseFloat(member.total_spent || 0) + orderTotal;
    const newTotalOrders = (member.total_orders || 0) + 1;
    const newTier = calculateTier(newPoints, settings);

    // Update member
    await pool.query(
      `UPDATE loyalty_program 
       SET points = $1, total_spent = $2, total_orders = $3, tier = $4, updated_at = CURRENT_TIMESTAMP 
       WHERE customer_phone = $5`,
      [newPoints, newTotalSpent, newTotalOrders, newTier, customer_phone]
    );

    // Record transaction
    await pool.query(
      `INSERT INTO loyalty_transactions (customer_phone, points, transaction_type, description, order_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [customer_phone, pointsEarned, 'earned', description || `Points earned from order #${orderId}`, orderId || null]
    );

    console.log(`✓ Awarded ${pointsEarned} loyalty points to ${customer_phone} (tier: ${newTier})`);

    return {
      points_earned: pointsEarned,
      new_balance: newPoints,
      new_tier: newTier
    };
  } catch (error) {
    console.error('✗ Error awarding loyalty points:', error.message);
    return null;
  }
}

/**
 * Award loyalty points for a completed order (used when order status changes to Completed)
 */
async function awardPointsForCompletedOrder(order) {
  if (!order || !order.customer_phone) return null;
  
  const orderTotal = parseFloat(order.product_price) * order.quantity;
  return awardLoyaltyPoints(
    order.customer_phone,
    orderTotal,
    order.id,
    `Points earned from order #${order.id}`
  );
}

/**
 * Process loyalty points for a new order (auto-enroll + award)
 * Used by both public and admin order creation flows
 */
async function processLoyaltyForNewOrder(customer_phone, customer_name, customer_email, orderTotal, orderId) {
  try {
    // Auto-enroll if not a member
    const member = await autoEnrollCustomer(customer_phone, customer_name, customer_email);
    if (!member) return null;

    // Award points
    return await awardLoyaltyPoints(
      customer_phone,
      orderTotal,
      orderId,
      `Points earned from order #${orderId}`
    );
  } catch (error) {
    console.error('✗ Error processing loyalty for new order:', error.message);
    return null;
  }
}

module.exports = {
  getLoyaltySettings,
  calculateTier,
  autoEnrollCustomer,
  awardLoyaltyPoints,
  awardPointsForCompletedOrder,
  processLoyaltyForNewOrder
};