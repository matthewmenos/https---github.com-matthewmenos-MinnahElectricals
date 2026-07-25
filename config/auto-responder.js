const { getDb, saveDatabase } = require('../config/db');
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

  // Check if weekend
  if (settings.weekends_enabled === 'true' && (day === 0 || day === 6)) {
    return false;
  }

  return hour >= openHour && hour < closeHour;
}

/**
 * Get auto-responder settings from database
 */
function getAutoResponderSettings() {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT key, value FROM settings WHERE key LIKE "auto_%"');
    const settings = {};
    if (result[0]) {
      result[0].values.forEach(row => {
        settings[row[0].replace('auto_', '')] = row[1];
      });
    }
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
function wasContactedToday(phone) {
  try {
    const dbInstance = getDb();
    const cleanPhone = phone.replace(/\D/g, '');
    const today = new Date().toISOString().split('T')[0];

    const result = dbInstance.exec(
      'SELECT COUNT(*) as count FROM sms_logs WHERE phone = ? AND status = "sent" AND date(created_at) = ?',
      [cleanPhone, today]
    );

    return result[0] && result[0].values[0][0] > 0;
  } catch (error) {
    console.error('✗ Failed to check contact history:', error.message);
    return false;
  }
}

/**
 * Get template by name
 */
function getTemplate(name) {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM templates WHERE name = ? ORDER BY created_at DESC LIMIT 1', [name]);
    if (result[0] && result[0].values[0]) {
      const row = result[0].values[0];
      return {
        id: row[0],
        name: row[1],
        type: row[2],
        subject: row[3],
        content: row[4],
        created_at: row[5],
        updated_at: row[6]
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
  const settings = getAutoResponderSettings();
  if (settings.enabled !== 'true') {
    return false;
  }

  // Check if within business hours
  if (isWithinBusinessHours()) {
    return false; // Don't auto-respond during business hours
  }

  // Check if already contacted today
  if (wasContactedToday(lead.phone)) {
    return false; // Don't spam the same customer
  }

  // Get template
  const template = getTemplate('auto_responder') || getTemplate('after_hours');
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
