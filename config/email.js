const nodemailer = require('nodemailer');
const { pool } = require('./db');
require('dotenv').config();

// Create reusable transport object using SMTP
let transporter = null;

function initializeEmail() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log('✓ Email service initialized');
  } else {
    console.log('⚠️  Email service not configured (SMTP credentials missing)');
  }
}

initializeEmail();

/**
 * Get a template from the database
 * @param {string} name - Template name
 * @returns {object|null} - Template object or null
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
 * @param {string} content - Template content
 * @param {object} variables - Key-value pairs of variables
 * @returns {string} - Rendered content
 */
function renderTemplate(content, variables) {
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return rendered;
}

/**
 * Send order confirmation email to customer
 */
async function sendOrderConfirmationEmail(customerEmail, customerName, orderDetails) {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || 'Minnah Electricals <noreply@minnahelectricals.com>',
      to: customerEmail,
      subject: `Order Confirmation - Minnah Electricals`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #0F172A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f5f5f5; padding: 20px; }
            .order-details { background: white; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .footer { background: #0F172A; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; background: #F59E0B; color: #0F172A; text-decoration: none; border-radius: 5px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Minnah Electricals</h1>
              <p>Order Confirmation</p>
            </div>
            <div class="content">
              <p>Dear ${customerName},</p>
              <p>Thank you for your order! We have received your order request and will contact you shortly to confirm the details.</p>
              
              <div class="order-details">
                <h3>Order Details</h3>
                <p><strong>Order ID:</strong> #${orderDetails.orderId}</p>
                <p><strong>Date:</strong> ${new Date(orderDetails.date).toLocaleString()}</p>
                <p><strong>Status:</strong> ${orderDetails.status}</p>
              </div>

              <div class="order-details">
                <h3>Products Ordered</h3>
                ${orderDetails.products.map(product => `
                  <div style="margin: 10px 0; padding: 10px; background: #f9f9f9; border-left: 3px solid #F59E0B;">
                    <p><strong>${product.name}</strong></p>
                    <p>Quantity: ${product.quantity}</p>
                    <p>Price: ₵${product.price.toFixed(2)}</p>
                    <p><strong>Subtotal: ₵${(product.price * product.quantity).toFixed(2)}</strong></p>
                  </div>
                `).join('')}
                <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #0F172A;">
                  <h3>Total: ₵${orderDetails.total.toFixed(2)}</h3>
                </div>
              </div>

              <div class="order-details">
                <h3>Customer Information</h3>
                <p><strong>Name:</strong> ${orderDetails.customerName}</p>
                <p><strong>Phone:</strong> ${orderDetails.customerPhone}</p>
                ${orderDetails.customerEmail ? `<p><strong>Email:</strong> ${orderDetails.customerEmail}</p>` : ''}
              </div>

              ${orderDetails.notes ? `
              <div class="order-details">
                <h3>Notes</h3>
                <p>${orderDetails.notes}</p>
              </div>
              ` : ''}

              <p>If you have any questions, please don't hesitate to contact us.</p>
            </div>
            <div class="footer">
              <p>Thank you for choosing Minnah Electricals!</p>
              <p>Professional Electrical Services</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Order confirmation email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('✗ Error sending order confirmation email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification email to admin
 */
async function sendAdminNotificationEmail(orderDetails) {
  try {
    const adminEmail = process.env.SMTP_TO || 'admin@minnahelectricals.com';
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Minnah Electricals <noreply@minnahelectricals.com>',
      to: adminEmail,
      subject: `New Order Received - Order #${orderDetails.orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #0F172A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f5f5f5; padding: 20px; }
            .order-details { background: white; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .footer { background: #0F172A; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Order Alert</h1>
            </div>
            <div class="content">
              <p>A new order has been placed on your website!</p>
              
              <div class="order-details">
                <h3>Order Information</h3>
                <p><strong>Order ID:</strong> #${orderDetails.orderId}</p>
                <p><strong>Date:</strong> ${new Date(orderDetails.date).toLocaleString()}</p>
                <p><strong>Source:</strong> ${orderDetails.source}</p>
              </div>

              <div class="order-details">
                <h3>Customer Information</h3>
                <p><strong>Name:</strong> ${orderDetails.customerName}</p>
                <p><strong>Phone:</strong> ${orderDetails.customerPhone}</p>
                ${orderDetails.customerEmail ? `<p><strong>Email:</strong> ${orderDetails.customerEmail}</p>` : ''}
              </div>

              <div class="order-details">
                <h3>Products</h3>
                ${orderDetails.products.map(product => `
                  <p>${product.name} - Qty: ${product.quantity} - ₵${(product.price * product.quantity).toFixed(2)}</p>
                `).join('')}
                <h3>Total: ₵${orderDetails.total.toFixed(2)}</h3>
              </div>

              ${orderDetails.notes ? `
              <div class="order-details">
                <h3>Notes</h3>
                <p>${orderDetails.notes}</p>
              </div>
              ` : ''}

              <p>Please log in to the admin dashboard to manage this order.</p>
            </div>
            <div class="footer">
              <p>Minnah Electricals Admin System</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✓ Admin notification email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('✗ Error sending admin notification email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendOrderConfirmationEmail,
  sendAdminNotificationEmail
};