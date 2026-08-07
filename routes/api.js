const express = require('express');
const router = express.Router();
const { getDb, saveDatabase } = require('../config/db');
const r2Sync = require('../config/r2-sync');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { sendLeadSms } = require('../config/sms');
const { sendAutoResponder } = require('../config/auto-responder');
const { sendOrderConfirmationEmail, sendAdminNotificationEmail } = require('../config/email');
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

    // Send SMS notification (non-blocking)
    sendLeadSms(newLead).catch(err => {
      console.error('SMS notification error:', err.message);
    });

    // Send auto-responder (non-blocking)
    sendAutoResponder(newLead).catch(err => {
      console.error('Auto-responder error:', err.message);
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
    
    const products = result[0] ? result[0].values.map(row => {
      let imageUrl = row[4];
      // If image_url is a relative path, make it absolute
      if (imageUrl && !imageUrl.startsWith('http')) {
        // Remove leading slash if present
        const cleanPath = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
        imageUrl = `${req.protocol}://${req.get('host')}/${cleanPath}`;
      }
      
      return {
        id: row[0],
        name: row[1],
        description: row[2],
        price: row[3],
        image_url: imageUrl,
        category: row[5],
        in_stock: row[6],
        created_at: row[7],
        updated_at: row[8]
      };
    }) : [];

    res.set('Cache-Control', 'no-store');
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

    let imageUrl = result[0].values[0][4];
    if (imageUrl && !imageUrl.startsWith('http')) {
      const cleanPath = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
      imageUrl = `${req.protocol}://${req.get('host')}/${cleanPath}`;
    }
    
    const product = {
      id: result[0].values[0][0],
      name: result[0].values[0][1],
      description: result[0].values[0][2],
      price: result[0].values[0][3],
      image_url: imageUrl,
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

    // Send email notifications (non-blocking)
    if (customer_email) {
      sendOrderConfirmationEmail(customer_email, customer_name, {
        orderId: newOrder.id,
        date: newOrder.created_at,
        status: newOrder.status,
        products: [{
          name: product.name,
          price: product.price,
          quantity: newOrder.quantity
        }],
        total: product.price * newOrder.quantity,
        customerName: customer_name,
        customerPhone: customer_phone,
        customerEmail: customer_email,
        notes: notes
      }).catch(err => console.error('Order confirmation email error:', err.message));
    }

    sendAdminNotificationEmail({
      orderId: newOrder.id,
      date: newOrder.created_at,
      source: 'Website',
      customerName: customer_name,
      customerPhone: customer_phone,
      customerEmail: customer_email,
      products: [{
        name: product.name,
        price: product.price,
        quantity: newOrder.quantity
      }],
      total: product.price * newOrder.quantity,
      notes: notes
    }).catch(err => console.error('Admin notification email error:', err.message));

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
    if (!settings.whatsapp) settings.whatsapp = '';

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
 * GET /api/orders/track
 * Track orders by phone number (public route)
 */
router.get('/orders/track', (req, res) => {
  try {
    const { phone, orderId } = req.query;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    const dbInstance = getDb();
    let query = 'SELECT * FROM orders WHERE customer_phone = ?';
    const params = [phone];

    // If orderId is provided, filter by it too
    if (orderId) {
      query += ' AND id = ?';
      params.push(parseInt(orderId));
    }

    query += ' ORDER BY created_at DESC';

    const result = dbInstance.exec(query, params);
    
    const orders = result[0] ? result[0].values.map(row => ({
      id: row[0],
      customer_name: row[1],
      customer_phone: row[2],
      customer_email: row[3],
      product_id: row[4],
      product_name: row[5],
      product_price: row[6],
      quantity: row[7],
      notes: row[8],
      order_source: row[9],
      status: row[10],
      created_at: row[11]
    })) : [];

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders: orders,
    });

  } catch (error) {
    console.error('✗ Error tracking orders:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while tracking orders.',
    });
  }
});

/**
 * GET /api/products/:id/reviews
 * Get approved reviews for a product (public route)
 */
router.get('/products/:id/reviews', (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const dbInstance = getDb();
    const result = dbInstance.exec(
      'SELECT * FROM reviews WHERE product_id = ? AND status = ? ORDER BY created_at DESC',
      [productId, 'approved']
    );
    
    const reviews = result[0] ? result[0].values.map(row => ({
      id: row[0],
      product_id: row[1],
      customer_name: row[2],
      customer_email: row[3],
      rating: row[4],
      review_text: row[5],
      status: row[6],
      created_at: row[7]
    })) : [];

    // Calculate average rating
    const avgRating = reviews.length > 0 
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : 0;

    return res.status(200).json({
      success: true,
      count: reviews.length,
      average_rating: avgRating,
      reviews: reviews,
    });

  } catch (error) {
    console.error('✗ Error fetching reviews:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching reviews.',
    });
  }
});

/**
 * POST /api/products/:id/reviews
 * Submit a review for a product (public route)
 */
router.post('/products/:id/reviews', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { customer_name, customer_email, rating, review_text } = req.body;

    // Validate required fields
    if (!customer_name || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Customer name and rating are required',
      });
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5',
      });
    }

    // Verify product exists
    const dbInstance = getDb();
    const productResult = dbInstance.exec('SELECT id FROM products WHERE id = ?', [productId]);
    if (!productResult[0] || !productResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Insert review
    dbInstance.run(
      `INSERT INTO reviews (product_id, customer_name, customer_email, rating, review_text) VALUES (?, ?, ?, ?, ?)`,
      [productId, customer_name.trim(), customer_email?.trim() || null, rating, review_text?.trim() || null]
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const reviewId = result[0].values[0][0];
    saveDatabase();

    console.log(`✓ Review created: #${reviewId} for product #${productId}`);

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully! It will be published after moderation.',
      review_id: reviewId,
    });

  } catch (error) {
    console.error('✗ Error creating review:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while submitting your review.',
    });
  }
});

/**
 * GET /api/wishlist/:session_id
 * Get wishlist items for a session (public route)
 */
router.get('/wishlist/:session_id', (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const dbInstance = getDb();
    
    const result = dbInstance.exec(`
      SELECT w.*, p.name, p.price, p.image_url, p.category 
      FROM wishlist w 
      LEFT JOIN products p ON w.product_id = p.id 
      WHERE w.session_id = ? 
      ORDER BY w.created_at DESC
    `, [sessionId]);

    const wishlistItems = result[0] ? result[0].values.map(row => ({
      id: row[0],
      product_id: row[1],
      session_id: row[2],
      created_at: row[3],
      name: row[4],
      price: row[5],
      image_url: row[6],
      category: row[7]
    })) : [];

    return res.status(200).json({
      success: true,
      count: wishlistItems.length,
      wishlist: wishlistItems,
    });

  } catch (error) {
    console.error('✗ Error fetching wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching wishlist.',
    });
  }
});

/**
 * POST /api/wishlist/:session_id/add
 * Add item to wishlist (public route)
 */
router.post('/wishlist/:session_id/add', (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const { product_id } = req.body;

    if (!product_id) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required',
      });
    }

    const dbInstance = getDb();
    
    // Verify product exists
    const productResult = dbInstance.exec('SELECT id FROM products WHERE id = ?', [product_id]);
    if (!productResult[0] || !productResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Add to wishlist (ignore if already exists due to UNIQUE constraint)
    try {
      dbInstance.run(
        'INSERT INTO wishlist (product_id, session_id) VALUES (?, ?)',
        [product_id, sessionId]
      );
      saveDatabase();
    } catch (err) {
      // Item already in wishlist
      return res.status(200).json({
        success: true,
        message: 'Item already in wishlist',
        already_exists: true,
      });
    }

    console.log(`✓ Item added to wishlist: product #${product_id}`);

    return res.status(201).json({
      success: true,
      message: 'Item added to wishlist',
    });

  } catch (error) {
    console.error('✗ Error adding to wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while adding to wishlist.',
    });
  }
});

/**
 * DELETE /api/wishlist/:session_id/remove/:product_id
 * Remove item from wishlist (public route)
 */
router.delete('/wishlist/:session_id/remove/:product_id', (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const productId = parseInt(req.params.product_id);

    const dbInstance = getDb();
    dbInstance.run(
      'DELETE FROM wishlist WHERE session_id = ? AND product_id = ?',
      [sessionId, productId]
    );
    saveDatabase();

    console.log(`✓ Item removed from wishlist: product #${productId}`);

    return res.status(200).json({
      success: true,
      message: 'Item removed from wishlist',
    });

  } catch (error) {
    console.error('✗ Error removing from wishlist:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while removing from wishlist.',
    });
  }
});

/**
 * GET /api/customer-info/:session_id
 * Get saved customer info for quick checkout (public route)
 */
router.get('/customer-info/:session_id', (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const dbInstance = getDb();
    
    const result = dbInstance.exec(
      'SELECT * FROM customer_info WHERE session_id = ?',
      [sessionId]
    );

    let customerInfo = null;
    if (result[0] && result[0].values[0]) {
      customerInfo = {
        id: result[0].values[0][0],
        session_id: result[0].values[0][1],
        customer_name: result[0].values[0][2],
        customer_phone: result[0].values[0][3],
        customer_email: result[0].values[0][4],
        created_at: result[0].values[0][5],
        updated_at: result[0].values[0][6]
      };
    }

    return res.status(200).json({
      success: true,
      customer_info: customerInfo,
    });

  } catch (error) {
    console.error('✗ Error fetching customer info:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching customer info.',
    });
  }
});

/**
 * POST /api/customer-info/:session_id
 * Save customer info for quick checkout (public route)
 */
router.post('/customer-info/:session_id', (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const { customer_name, customer_phone, customer_email } = req.body;

    const dbInstance = getDb();
    
    // Check if record exists
    const existingResult = dbInstance.exec(
      'SELECT id FROM customer_info WHERE session_id = ?',
      [sessionId]
    );

    if (existingResult[0] && existingResult[0].values[0]) {
      // Update existing record
      dbInstance.run(
        `UPDATE customer_info 
         SET customer_name = ?, customer_phone = ?, customer_email = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE session_id = ?`,
        [customer_name?.trim() || null, customer_phone?.trim() || null, customer_email?.trim() || null, sessionId]
      );
    } else {
      // Insert new record
      dbInstance.run(
        `INSERT INTO customer_info (session_id, customer_name, customer_phone, customer_email) 
         VALUES (?, ?, ?, ?)`,
        [sessionId, customer_name?.trim() || null, customer_phone?.trim() || null, customer_email?.trim() || null]
      );
    }

    saveDatabase();

    console.log(`✓ Customer info saved for session: ${sessionId}`);

    return res.status(200).json({
      success: true,
      message: 'Customer information saved',
    });

  } catch (error) {
    console.error('✗ Error saving customer info:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while saving customer info.',
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

/**
 * GET /api/orders/:id/invoice
 * Generate PDF invoice for an order (public route)
 */
router.get('/orders/:id/invoice', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const orderId = parseInt(req.params.id);

    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM orders WHERE id = ?', [orderId]);

    if (!result[0] || !result[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const order = {
      id: result[0].values[0][0],
      customer_name: result[0].values[0][1],
      customer_phone: result[0].values[0][2],
      customer_email: result[0].values[0][3],
      product_id: result[0].values[0][4],
      product_name: result[0].values[0][5],
      product_price: result[0].values[0][6],
      quantity: result[0].values[0][7],
      notes: result[0].values[0][8],
      order_source: result[0].values[0][9],
      status: result[0].values[0][10],
      created_at: result[0].values[0][11]
    };

    // Get settings
    const settingsResult = dbInstance.exec('SELECT key, value FROM settings');
    const settings = {};
    if (settingsResult[0]) {
      settingsResult[0].values.forEach(row => {
        settings[row[0]] = row[1];
      });
    }

    const total = order.product_price * order.quantity;

    // Create PDF
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${order.id}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.send(pdfBuffer);
    });

    // Header
    doc.fillColor('#0F172A').rect(0, 0, 600, 120).fill();
    doc.fillColor('#F59E0B').rect(0, 110, 600, 10).fill();

    // Company info
    doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold').text('Minnah Electricals', 50, 30);
    doc.fontSize(10).text(settings.location || 'Serving the Local Area', 50, 55);
    doc.text(`Phone: ${settings.phone || '(555) 123-4567'}`, 50, 70);
    doc.text(`Email: ${settings.email || 'info@minnahelectricals.com'}`, 50, 85);

    // Invoice title
    doc.fillColor('#0F172A').fontSize(20).font('Helvetica-Bold').text('INVOICE', 400, 30);
    doc.fontSize(10).text(`Invoice #: ${order.id}`, 400, 55);
    doc.text(`Date: ${new Date(order.created_at).toLocaleDateString()}`, 400, 70);
    doc.text(`Status: ${order.status}`, 400, 85);

    // Customer info
    doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold').text('Bill To:', 50, 150);
    doc.fontSize(10).font('Helvetica').text(order.customer_name, 50, 170);
    doc.text(`Phone: ${order.customer_phone}`, 50, 185);
    if (order.customer_email) doc.text(`Email: ${order.customer_email}`, 50, 200);

    // Table header
    doc.fillColor('#F59E0B').rect(50, 230, 500, 25).fill();
    doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold')
      .text('Product', 60, 245)
      .text('Qty', 350, 245)
      .text('Price', 420, 245)
      .text('Total', 480, 245);

    // Table row
    doc.fillColor('#FFFFFF').font('Helvetica')
      .text(order.product_name || 'Unknown Product', 60, 270)
      .text(order.quantity.toString(), 350, 270)
      .text(`₵${order.product_price.toFixed(2)}`, 420, 270)
      .text(`₵${total.toFixed(2)}`, 480, 270);

    // Total
    doc.fillColor('#F59E0B').rect(350, 295, 150, 30).fill();
    doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold')
      .text('TOTAL', 360, 310)
      .text(`₵${total.toFixed(2)}`, 480, 310);

    // Notes
    if (order.notes) {
      doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold').text('Notes:', 50, 350);
      doc.fontSize(10).font('Helvetica').text(order.notes, 50, 370);
    }

    // Footer
    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Thank you for choosing Minnah Electricals!', 50, 550)
      .text('Professional Electrical Services', 50, 565);

    doc.end();

  } catch (error) {
    console.error('✗ Error generating invoice:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while generating the invoice.',
    });
  }
});

/**
 * GET /api/push/vapid-key
 * Get VAPID public key for push notifications
 */
router.get('/push/vapid-key', (req, res) => {
  try {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return res.status(200).json({
        success: false,
        message: 'Push notifications not configured'
      });
    }
    return res.status(200).json({
      success: true,
      publicKey: vapidPublicKey
    });
  } catch (error) {
    console.error('✗ Error getting VAPID key:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred'
    });
  }
});

/**
 * POST /api/appointments
 * Book a new appointment (public route)
 */
router.post('/appointments', async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_email, service_type, appointment_date, appointment_time, notes } = req.body;

    // Validate required fields
    if (!customer_name || !customer_phone || !service_type || !appointment_date || !appointment_time) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: customer_name, customer_phone, service_type, appointment_date, and appointment_time are required',
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(appointment_date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD',
      });
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(appointment_time)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time format. Use HH:MM (24-hour format)',
      });
    }

    const dbInstance = getDb();
    dbInstance.run(
      `INSERT INTO appointments (customer_name, customer_phone, customer_email, service_type, appointment_date, appointment_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        customer_name.trim().substring(0, 100),
        customer_phone.trim().substring(0, 20),
        customer_email?.trim() || null,
        service_type.trim().substring(0, 200),
        appointment_date,
        appointment_time,
        notes?.trim() || null
      ]
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const appointmentId = result[0].values[0][0];
    saveDatabase();

    const newAppointment = {
      id: appointmentId,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone.trim(),
      customer_email: customer_email?.trim() || null,
      service_type: service_type.trim(),
      appointment_date,
      appointment_time,
      status: 'Pending',
      notes: notes?.trim() || null,
      created_at: new Date().toISOString(),
    };

    // Trigger R2 sync (non-blocking)
    r2Sync.sync().catch(err => {
      console.error('R2 sync error:', err.message);
    });

    console.log(`✓ New appointment created: #${newAppointment.id} - ${customer_name}`);

    return res.status(201).json({
      success: true,
      message: 'Appointment booked successfully! We will contact you to confirm.',
      appointment: newAppointment,
    });

  } catch (error) {
    console.error('✗ Error creating appointment:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while booking the appointment. Please try again.',
    });
  }
});

/**
 * POST /api/newsletter/subscribe
 * Subscribe to newsletter (public route)
 */
router.post('/newsletter/subscribe', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    const dbInstance = getDb();
    
    // Check if already subscribed
    const existingResult = dbInstance.exec('SELECT id, status FROM newsletter_subscribers WHERE email = ?', [email.toLowerCase()]);
    
    if (existingResult[0] && existingResult[0].values[0]) {
      const existingId = existingResult[0].values[0][0];
      const existingStatus = existingResult[0].values[0][1];
      
      if (existingStatus === 'active') {
        return res.status(200).json({
          success: true,
          message: 'You are already subscribed to our newsletter!',
          already_subscribed: true,
        });
      } else {
        // Resubscribe
        dbInstance.run(
          'UPDATE newsletter_subscribers SET status = ?, subscribed_at = CURRENT_TIMESTAMP, unsubscribed_at = NULL WHERE id = ?',
          ['active', existingId]
        );
        saveDatabase();
        
        return res.status(200).json({
          success: true,
          message: 'Welcome back! You have been resubscribed to our newsletter.',
          resubscribed: true,
        });
      }
    }

    // Add new subscriber
    dbInstance.run(
      'INSERT INTO newsletter_subscribers (email, name, status) VALUES (?, ?, ?)',
      [email.toLowerCase(), name?.trim() || null, 'active']
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const subscriberId = result[0].values[0][0];
    saveDatabase();

    console.log(`✓ New newsletter subscriber: #${subscriberId} - ${email}`);

    return res.status(201).json({
      success: true,
      message: 'Thank you for subscribing to our newsletter!',
      subscriber_id: subscriberId,
    });

  } catch (error) {
    console.error('✗ Error subscribing to newsletter:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while subscribing. Please try again.',
    });
  }
});

/**
 * POST /api/newsletter/unsubscribe
 * Unsubscribe from newsletter (public route)
 */
router.post('/newsletter/unsubscribe', (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT id FROM newsletter_subscribers WHERE email = ? AND status = ?', [email.toLowerCase(), 'active']);

    if (!result[0] || !result[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Email not found in our subscriber list',
      });
    }

    const subscriberId = result[0].values[0][0];
    dbInstance.run(
      'UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['unsubscribed', subscriberId]
    );
    saveDatabase();

    console.log(`✓ Newsletter unsubscribed: #${subscriberId} - ${email}`);

    return res.status(200).json({
      success: true,
      message: 'You have been unsubscribed from our newsletter.',
    });

  } catch (error) {
    console.error('✗ Error unsubscribing from newsletter:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while unsubscribing. Please try again.',
    });
  }
});

/**
 * POST /api/service-requests
 * Submit a service request (public route)
 */
router.post('/service-requests', async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_email, service_type, description, priority } = req.body;

    // Validate required fields
    if (!customer_name || !customer_phone || !service_type || !description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: customer_name, customer_phone, service_type, and description are required',
      });
    }

    const dbInstance = getDb();
    dbInstance.run(
      `INSERT INTO service_requests (customer_name, customer_phone, customer_email, service_type, description, priority) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        customer_name.trim().substring(0, 100),
        customer_phone.trim().substring(0, 20),
        customer_email?.trim() || null,
        service_type.trim().substring(0, 200),
        description.trim().substring(0, 1000),
        priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'medium'
      ]
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const serviceRequestId = result[0].values[0][0];
    saveDatabase();

    const newServiceRequest = {
      id: serviceRequestId,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone.trim(),
      customer_email: customer_email?.trim() || null,
      service_type: service_type.trim(),
      description: description.trim(),
      priority: priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'medium',
      status: 'open',
      created_at: new Date().toISOString(),
    };

    // Trigger R2 sync (non-blocking)
    r2Sync.sync().catch(err => {
      console.error('R2 sync error:', err.message);
    });

    console.log(`✓ New service request created: #${newServiceRequest.id} - ${customer_name}`);

    return res.status(201).json({
      success: true,
      message: 'Service request submitted successfully! We will contact you shortly.',
      service_request: newServiceRequest,
    });

  } catch (error) {
    console.error('✗ Error creating service request:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while submitting your service request. Please try again.',
    });
  }
});

/**
 * GET /api/service-requests/track
 * Track service requests by phone number (public route)
 */
router.get('/service-requests/track', (req, res) => {
  try {
    const { phone, requestId } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    const dbInstance = getDb();
    let query = 'SELECT * FROM service_requests WHERE customer_phone = ?';
    const params = [phone];

    if (requestId) {
      query += ' AND id = ?';
      params.push(parseInt(requestId));
    }

    query += ' ORDER BY created_at DESC';

    const result = dbInstance.exec(query, params);

    const serviceRequests = result[0] ? result[0].values.map(row => ({
      id: row[0],
      customer_name: row[1],
      customer_phone: row[2],
      customer_email: row[3],
      service_type: row[4],
      description: row[5],
      priority: row[6],
      status: row[7],
      assigned_to: row[8],
      scheduled_date: row[9],
      scheduled_time: row[10],
      completed_at: row[11],
      notes: row[12],
      created_at: row[13],
      updated_at: row[14]
    })) : [];

    return res.status(200).json({
      success: true,
      count: serviceRequests.length,
      service_requests: serviceRequests,
    });

  } catch (error) {
    console.error('✗ Error tracking service requests:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while tracking service requests.',
    });
  }
});

/**
 * POST /api/push/subscribe
 * Save push subscription to database
 */
router.post('/push/subscribe', (req, res) => {
  try {
    const { session_id, endpoint, keys } = req.body;

    if (!session_id || !endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and endpoint are required'
      });
    }

    const dbInstance = getDb();
    dbInstance.run(
      'INSERT OR IGNORE INTO push_subscriptions (session_id, endpoint, keys) VALUES (?, ?, ?)',
      [session_id, endpoint, keys || '{}']
    );
    saveDatabase();

    console.log(`✓ Push subscription saved for session: ${session_id}`);

    return res.status(200).json({
      success: true,
      message: 'Push subscription saved successfully'
    });
  } catch (error) {
    console.error('✗ Error saving push subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while saving subscription'
    });
  }
});

module.exports = router;
