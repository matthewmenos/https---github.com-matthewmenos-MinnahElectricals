const { pool } = require('../config/db');
require('dotenv').config();

// SMS Service Module
// Supports Twilio and generic HTTP API gateways

let smsProvider = null;

function initializeSms() {
  if (process.env.SMS_PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    smsProvider = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('✓ SMS service initialized (Twilio)');
  } else if (process.env.SMS_PROVIDER === 'arkasel' && process.env.ARKASEL_API_KEY) {
    smsProvider = 'arkasel';
    console.log('✓ SMS service initialized (Arkasel)');
  } else if (process.env.SMS_API_URL && process.env.SMS_API_KEY) {
    // Generic HTTP API gateway
    smsProvider = 'generic';
    console.log('✓ SMS service initialized (Generic API)');
  } else {
    console.log('⚠️  SMS service not configured (SMS credentials missing)');
  }
}

// Initialize on load
initializeSms();

/**
 * Send SMS message
 * @param {string} phone - Recipient phone number
 * @param {string} message - SMS message content
 * @returns {Promise<boolean>} - Success status
 */
async function sendSms(phone, message) {
  if (!smsProvider) {
    console.log('⚠️  SMS not sent - provider not configured');
    logSms(phone, message, 'failed', 'SMS provider not configured');
    return false;
  }

  // Clean phone number (remove non-digits)
  const cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 7) {
    console.error('✗ Invalid phone number for SMS:', phone);
    logSms(phone, message, 'failed', 'Invalid phone number');
    return false;
  }

  try {
    let result;

    if (smsProvider === 'arkasel') {
      // Arkasel SMS API
      const fetch = require('node-fetch');
      const response = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.ARKASEL_API_KEY
        },
        body: JSON.stringify({
          sender: process.env.ARKASEL_SENDER_ID || 'MinnahElec',
          message: message,
          recipients: [cleanPhone]
        })
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || 'Arkasel API error');
    } else if (smsProvider === 'generic') {
      // Generic HTTP API
      const fetch = require('node-fetch');
      const response = await fetch(process.env.SMS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SMS_API_KEY}`
        },
        body: JSON.stringify({
          to: cleanPhone,
          from: process.env.SMS_FROM || process.env.TWILIO_PHONE_NUMBER,
          message: message
        })
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.error || 'SMS API error');
    } else {
      // Twilio
      const from = process.env.TWILIO_PHONE_NUMBER;
      result = await smsProvider.messages.create({
        body: message,
        from: from,
        to: cleanPhone
      });
    }

    console.log(`✓ SMS sent to ${cleanPhone}`);
    logSms(cleanPhone, message, 'sent');
    return true;

  } catch (error) {
    console.error('✗ Failed to send SMS:', error.message);
    logSms(cleanPhone, message, 'failed', error.message);
    return false;
  }
}

/**
 * Log SMS to database
 */
async function logSms(phone, message, status, errorMessage = null) {
  try {
    await pool.query(
      'INSERT INTO sms_logs (phone, message, status, error_message) VALUES ($1, $2, $3, $4)',
      [phone, message, status, errorMessage]
    );
  } catch (error) {
    console.error('✗ Failed to log SMS:', error.message);
  }
}

/**
 * Get SMS settings from database
 */
async function getSmsSettings() {
  try {
    const result = await pool.query('SELECT key, value FROM settings WHERE key LIKE $1', ['sms_%']);
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  } catch (error) {
    console.error('✗ Failed to get SMS settings:', error.message);
    return {};
  }
}

/**
 * Check if SMS notifications are enabled for a specific event
 */
async function isSmsEnabled(event) {
  const settings = await getSmsSettings();
  return settings[`sms_notify_${event}`] === 'true' || settings[`sms_notify_${event}`] === true;
}

/**
 * Send SMS notification for new lead
 */
async function sendLeadSms(lead) {
  if (!await isSmsEnabled('leads')) return false;

  const settings = await getSmsSettings();
  const adminPhone = settings.sms_admin_phone || process.env.SMS_ADMIN_PHONE;
  if (!adminPhone) return false;

  const message = `New Lead: ${lead.full_name} - ${lead.service_needed} (${lead.urgency}) - ${lead.phone}`;
  return await sendSms(adminPhone, message);
}

/**
 * Send SMS notification for order status change
 */
async function sendOrderStatusSms(order, newStatus) {
  if (!await isSmsEnabled('orders')) return false;

  const message = `Order #${order.id} status updated to: ${newStatus}. Thank you for your business!`;
  return await sendSms(order.customer_phone, message);
}

module.exports = {
  sendSms,
  sendLeadSms,
  sendOrderStatusSms,
  getSmsSettings,
  isSmsEnabled,
  initializeSms
};
