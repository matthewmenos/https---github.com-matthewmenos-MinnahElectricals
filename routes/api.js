const express = require('express');
const router = express.Router();
const { getDb, saveDatabase } = require('../config/db');
const r2Sync = require('../config/r2-sync');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Initialize Nodemailer transporter
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
 * Send email notification for new lead
 */
async function sendLeadNotification(lead) {
  if (!transporter) {
    console.log('⚠️  Email not sent - transporter not configured');
    return false;
  }

  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.SMTP_TO || process.env.SMTP_USER,
      subject: `New Lead: ${lead.service_needed} - ${lead.full_name}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #0F172A; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
            .content { background-color: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; }
            .field { margin-bottom: 15px; }
            .label { font-weight: bold; color: #0F172A; }
            .value { color: #495057; }
            .urgent { color: #dc3545; font-weight: bold; }
            .footer { background-color: #0F172A; color: white; padding: 15px; border-radius: 0 0 5px 5px; text-align: center; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>⚡ New Lead Received - ${process.env.COMPANY_NAME || 'Minnah Electricals'}</h2>
            </div>
            <div class="content">
              <div class="field">
                <div class="label">Client Name:</div>
                <div class="value">${lead.full_name}</div>
              </div>
              <div class="field">
                <div class="label">Phone:</div>
                <div class="value"><a href="tel:${lead.phone}">${lead.phone}</a></div>
              </div>
              <div class="field">
                <div class="label">Email:</div>
                <div class="value"><a href="mailto:${lead.email}">${lead.email}</a></div>
              </div>
              <div class="field">
                <div class="label">Service Needed:</div>
                <div class="value">${lead.service_needed}</div>
              </div>
              <div class="field">
                <div class="label">Urgency:</div>
                <div class="value ${lead.urgency === 'Emergency' ? 'urgent' : ''}">${lead.urgency}</div>
              </div>
              ${lead.message ? `
              <div class="field">
                <div class="label">Message:</div>
                <div class="value">${lead.message}</div>
              </div>
              ` : ''}
              <div class="field">
                <div class="label">Submitted:</div>
                <div class="value">${new Date(lead.created_at).toLocaleString()}</div>
              </div>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${process.env.COMPANY_NAME || 'Minnah Electricals'}</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✓ Email notification sent for lead #${lead.id}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to send email:', error.message);
    return false;
  }
}

/**
 * POST /api/leads
 * Submit a new lead from the contact form
 */
router.post('/leads', async (req, res) => {
  try {
    const { full_name, phone, email, service_needed, urgency, message } = req.body;

    // Validate required fields
    if (!full_name || !phone || !service_needed) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: full_name, phone, and service_needed are required',
      });
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    // Sanitize inputs
    const sanitizedData = {
      full_name: full_name.trim().substring(0, 100),
      phone: phone.trim().substring(0, 20),
      email: email ? email.trim().toLowerCase().substring(0, 100) : null,
      service_needed: service_needed.trim().substring(0, 200),
      urgency: urgency === 'Emergency' ? 'Emergency' : 'Standard',
      message: message ? message.trim().substring(0, 1000) : null,
    };

    // Insert lead into database
    const dbInstance = getDb();
    dbInstance.run(
      `INSERT INTO leads (full_name, phone, email, service_needed, urgency, message) VALUES (?, ?, ?, ?, ?, ?)`,
      [sanitizedData.full_name, sanitizedData.phone, sanitizedData.email, sanitizedData.service_needed, sanitizedData.urgency, sanitizedData.message]
    );
    
    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const leadId = result[0].values[0][0];
    
    saveDatabase();

    const newLead = {
      id: leadId,
      ...sanitizedData,
      status: 'New',
      created_at: new Date().toISOString(),
    };

    // Trigger R2 sync (non-blocking)
    r2Sync.sync().catch(err => {
      console.error('R2 sync error:', err.message);
    });

    // Send email notification (non-blocking)
    sendLeadNotification(newLead).catch(err => {
      console.error('Email notification error:', err.message);
    });

    console.log(`✓ New lead created: #${newLead.id} - ${newLead.full_name}`);

    return res.status(201).json({
      success: true,
      message: 'Thank you! We will contact you shortly.',
      lead: newLead,
    });

  } catch (error) {
    console.error('✗ Error creating lead:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while submitting your request. Please try again.',
    });
  }
});

/**
 * GET /api/products
 * Get all products (public route)
 */
router.get('/products', (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM products WHERE in_stock = 1 ORDER BY created_at DESC');
    
    const products = result[0] ? result[0].values.map(row => ({
      id: row[0],
      name: row[1],
      description: row[2],
      price: row[3],
      image_url: row[4],
      category: row[5],
      in_stock: row[6],
      created_at: row[7],
      updated_at: row[8]
    })) : [];

    return res.status(200).json({
      success: true,
      count: products.length,
      products: products,
    });

  } catch (error) {
    console.error('✗ Error fetching products:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching products.',
    });
  }
});

/**
 * GET /api/products/:id
 * Get single product (public route)
 */
router.get('/products/:id', (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM products WHERE id = ? AND in_stock = 1', [productId]);
    
    if (!result[0] || !result[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const product = {
      id: result[0].values[0][0],
      name: result[0].values[0][1],
      description: result[0].values[0][2],
      price: result[0].values[0][3],
      image_url: result[0].values[0][4],
      category: result[0].values[0][5],
      in_stock: result[0].values[0][6],
      created_at: result[0].values[0][7],
      updated_at: result[0].values[0][8]
    };

    return res.status(200).json({
      success: true,
      product: product,
    });

  } catch (error) {
    console.error('✗ Error fetching product:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the product.',
    });
  }
});

/**
 * POST /api/orders
 * Submit a new order (public route)
 */
router.post('/orders', async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_email, product_id, quantity, notes } = req.body;

    // Validate required fields
    if (!customer_name || !customer_phone || !product_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: customer_name, customer_phone, and product_id are required',
      });
    }

    // Validate product exists and is in stock
    const dbInstance = getDb();
    const productResult = dbInstance.exec('SELECT * FROM products WHERE id = ? AND in_stock = 1', [product_id]);
    
    if (!productResult[0] || !productResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or out of stock',
      });
    }

    const product = {
      id: productResult[0].values[0][0],
      name: productResult[0].values[0][1],
      price: productResult[0].values[0][3]
    };

    // Insert order into database
    dbInstance.run(
      `INSERT INTO orders (customer_name, customer_phone, customer_email, product_id, quantity, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [customer_name, customer_phone, customer_email || null, product_id, quantity || 1, notes || null]
    );
    
    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const orderId = result[0].values[0][0];
    saveDatabase();

    const newOrder = {
      id: orderId,
      customer_name,
      customer_phone,
      customer_email,
      product_id,
      product_name: product.name,
      product_price: product.price,
      quantity: quantity || 1,
      notes,
      status: 'Pending',
      created_at: new Date().toISOString(),
    };

    // Trigger R2 sync (non-blocking)
    r2Sync.sync().catch(err => {
      console.error('R2 sync error:', err.message);
    });

    console.log(`✓ New order created: #${newOrder.id} - ${customer_name}`);

    return res.status(201).json({
      success: true,
      message: 'Order submitted successfully! We will contact you shortly.',
      order: newOrder,
    });

  } catch (error) {
    console.error('✗ Error creating order:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while submitting your order. Please try again.',
    });
  }
});

/**
 * POST /api/upload
 * Upload image to R2 media bucket
 */
router.post('/upload', async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.files || !req.files.image) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const image = req.files.image;
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(image.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (image.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 5MB.',
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = image.name.split('.').pop();
    const fileName = `product_${timestamp}_${randomString}.${extension}`;

    // Upload to R2
    const mediaUrl = await r2Sync.uploadMediaToR2(image.data, fileName, image.mimetype);

    if (!mediaUrl) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload image to cloud storage',
      });
    }

    console.log(`✓ Image uploaded successfully: ${fileName}`);

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      url: mediaUrl,
      fileName: fileName,
    });

  } catch (error) {
    console.error('✗ Error uploading image:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while uploading the image.',
    });
  }
});

/**
 * DELETE /api/upload/:filename
 * Delete image from R2 media bucket
 */
router.delete('/upload/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Validate filename format (basic security check)
    if (!filename.match(/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename format',
      });
    }

    const success = await r2Sync.deleteMediaFromR2(filename);

    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete image from cloud storage',
      });
    }

    console.log(`✓ Image deleted successfully: ${filename}`);

    return res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
    });

  } catch (error) {
    console.error('✗ Error deleting image:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the image.',
    });
  }
});

/**
 * GET /api/portfolio
 * Get all portfolio items (public route)
 */
router.get('/portfolio', (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM portfolio ORDER BY display_order ASC, created_at DESC');
    
    const portfolio = result[0] ? result[0].values.map(row => ({
      id: row[0],
      title: row[1],
      description: row[2],
      image_url: row[3],
      category: row[4],
      client_name: row[5],
      project_date: row[6],
      featured: row[7],
      display_order: row[8],
      created_at: row[9]
    })) : [];

    return res.status(200).json({
      success: true,
      count: portfolio.length,
      portfolio: portfolio,
    });

  } catch (error) {
    console.error('✗ Error fetching portfolio:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching portfolio.',
    });
  }
});

/**
 * GET /api/portfolio/featured
 * Get featured portfolio items (public route)
 */
router.get('/portfolio/featured', (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM portfolio WHERE featured = 1 ORDER BY display_order ASC, created_at DESC');
    
    const portfolio = result[0] ? result[0].values.map(row => ({
      id: row[0],
      title: row[1],
      description: row[2],
      image_url: row[3],
      category: row[4],
      client_name: row[5],
      project_date: row[6],
      featured: row[7],
      display_order: row[8],
      created_at: row[9]
    })) : [];

    return res.status(200).json({
      success: true,
      count: portfolio.length,
      portfolio: portfolio,
    });

  } catch (error) {
    console.error('✗ Error fetching featured portfolio:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching featured portfolio.',
    });
  }
});

/**
 * GET /api/gallery
 * Get all gallery items (public route)
 */
router.get('/gallery', (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM gallery ORDER BY display_order ASC, created_at DESC');
    
    const gallery = result[0] ? result[0].values.map(row => ({
      id: row[0],
      title: row[1],
      image_url: row[2],
      category: row[3],
      description: row[4],
      display_order: row[5],
      created_at: row[6]
    })) : [];

    return res.status(200).json({
      success: true,
      count: gallery.length,
      gallery: gallery,
    });

  } catch (error) {
    console.error('✗ Error fetching gallery:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching gallery.',
    });
  }
});

/**
 * GET /api/settings
 * Get all settings (public route)
 */
router.get('/settings', (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT key, value FROM settings');
    
    const settings = {};
    if (result[0]) {
      result[0].values.forEach(row => {
        settings[row[0]] = row[1];
      });
    }

    // Ensure defaults exist if settings table is empty
    if (!settings.phone) settings.phone = process.env.COMPANY_PHONE || '(555) 123-4567';
    if (!settings.email) settings.email = process.env.COMPANY_EMAIL || 'info@minnahelectricals.com';
    if (!settings.location) settings.location = process.env.COMPANY_LOCATION || 'Serving the Local Area';

    return res.status(200).json({
      success: true,
      settings: settings,
    });

  } catch (error) {
    console.error('✗ Error fetching settings:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching settings.',
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
    r2_configured: r2Sync.isConfigured(),
    email_configured: !!transporter,
  });
});

module.exports = router;
