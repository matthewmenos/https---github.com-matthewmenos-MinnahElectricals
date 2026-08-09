const { pool } = require('../config/db');
const { sendSms } = require('./sms');
require('dotenv').config();

// Auto-responder Module
// Sends automated responses when the business is closed

/**
 * Check if current time is within business hours
 * @returns {boolean} - true if within business hours
 */
function isWithinBusinessHours() {
  const settings = getAutoResponderSettings();
  const openHour = parseInt(settings.open_hour || process.env.AUTO_OPEN_HOUR || '8');
  const closeHour = parseInt(settings.close_hour || process.env.AUTO_CLOSE_HOUR || '18');
  const timezone = settings.timezone || process.env.AUTO_TIMEZONE || 'UTC';

  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday

  // Check if weekend (0 = Sunday, 6 = Saturday)
  const isWeekend = day === 0 || day === 6;
  
  // If weekends are NOT enabled, return false (closed) on weekends
  if (isWeekend && settings.weekends_enabled !== 'true') {
    return false;
  }
  
  // If weekends ARE enabled but it's a weekend, check if within hours
  if (isWeekend && settings.weekends_enabled === 'true') {
    return hour >= openHour && hour < closeHour;
  }

  // Weekday - check if within business hours
  return hour >= openHour && hour < closeHour;
}

/**
 * Get auto-responder settings from database
 */
async function getAutoResponderSettings() {
  try {
    const result = await pool.query('SELECT key, value FROM settings WHERE key LIKE $1', ['auto_%']);
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key.replace('auto_', '')] = row.value;
    });
    return settings;
  } catch (error) {
    console.error('✗ Failed to get auto-responder settings:', error.message);
    return {};
  }
}

/**
 * Check if a customer was already contacted today
 * @param {string} phone - Customer phone number
 * @returns {boolean} - true if already contacted today
 */
async function wasContactedToday(phone) {
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const today = new Date().toISOString().split('T')[0];

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM sms_logs WHERE phone = $1 AND status = $2 AND DATE(created_at) = $3',
      [cleanPhone, 'sent', today]
    );

    return result.rows[0] && parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('✗ Failed to check contact history:', error.message);
    return false;
  }
}

/**
 * Get template by name
 */
async function getTemplate(name) {
  try {
    const result = await pool.query(
      'SELECT * FROM templates WHERE name = $1 ORDER BY created_at DESC LIMIT 1',
      [name]
    );
    if (result.rows[0]) {
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        subject: row.subject,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    }
    return null;
  } catch (error) {
    console.error('✗ Failed to get template:', error.message);
    return null;
  }
}

/**
 * Replace template variables with actual values
 */
function renderTemplate(content, variables) {
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return rendered;
}

/**
 * Send auto-responder message for a new lead
 * @param {object} lead - Lead object
 */
async function sendAutoResponder(lead) {
  // Check if auto-responder is enabled
  const settings = await getAutoResponderSettings();
  if (settings.enabled !== 'true') {
    return false;
  }

  // Check if within business hours
  if (isWithinBusinessHours()) {
    return false; // Don't auto-respond during business hours
  }

  // Check if already contacted today
  if (await wasContactedToday(lead.phone)) {
    return false; // Don't spam the same customer
  }

  // Get template
  const template = await getTemplate('auto_responder') || await getTemplate('after_hours');
  if (!template) {
    // Use default message
    const defaultMessage = `Thank you for contacting Minnah Electricals! We are currently closed. Our business hours are ${settings.open_hour || '8'}AM - ${settings.close_hour || '18'}PM. We will contact you during business hours.`;
    await sendSms(lead.phone, defaultMessage);
    return true;
  }

  // Render template with variables
  const message = renderTemplate(template.content, {
    customer_name: lead.full_name,
    company_name: process.env.COMPANY_NAME || 'Minnah Electricals',
    open_hour: settings.open_hour || '8',
    close_hour: settings.close_hour || '18',
    phone: settings.phone || process.env.COMPANY_PHONE || '(555) 123-4567',
    email: settings.email || process.env.COMPANY_EMAIL || 'info@minnahelectricals.com'
  });

  await sendSms(lead.phone, message);
  return true;
}

module.exports = {
  sendAutoResponder,
  isWithinBusinessHours,
  getAutoResponderSettings,
  getTemplate,
  renderTemplate
};
