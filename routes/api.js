const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const r2Sync = require('../config/r2-sync');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { sendLeadSms } = require('../config/sms');
const { sendAutoResponder } = require('../config/auto-responder');
const { sendOrderConfirmationEmail, sendAdminNotificationEmail } = require('../config/email');
const { processLoyaltyForNewOrder } = require('../config/loyalty');
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
    const result = await pool.query(
      `INSERT INTO leads (full_name, phone, email, service_needed, urgency, message) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, created_at`,
      [sanitizedData.full_name, sanitizedData.phone, sanitizedData.email, sanitizedData.service_needed, sanitizedData.urgency, sanitizedData.message]
    );
    
    const leadId = result.rows[0].id;
    const created_at = result.rows[0].created_at;

    const newLead = {
      id: leadId,
      ...sanitizedData,
      status: 'New',
      created_at: created_at,
    };

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
router.get('/products', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE in_stock = true ORDER BY created_at DESC'
    );
    
    const products = result.rows.map(row => {
      // Return image_url as-is from database (R2 URLs are already complete)
      const imageUrl = row.image_url;
      
      // Debug logging
      if (process.env.NODE_ENV === 'production') {
        console.log(`Product ${row.id} (${row.name}): image_url = ${imageUrl || 'NULL/EMPTY'}`);
      }
      
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        price: parseFloat(row.price),
        image_url: imageUrl, // R2 public URL from database
        category: row.category,
        in_stock: row.in_stock,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });

    console.log(`✓ Fetched ${products.length} products from database`);
    
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
router.get('/products/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND in_stock = true',
      [productId]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const row = result.rows[0];
    let imageUrl = row.image_url;
    if (imageUrl && !imageUrl.startsWith('http')) {
      const cleanPath = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
      imageUrl = `${req.protocol}://${req.get('host')}/${cleanPath}`;
    }
    
    const product = {
      id: row.id,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      image_url: imageUrl,
      category: row.category,
      in_stock: row.in_stock,
      created_at: row.created_at,
      updated_at: row.updated_at
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
    const productResult = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND in_stock = true',
      [product_id]
    );
    
    if (!productResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or out of stock',
      });
    }

    const product = productResult.rows[0];

    // Insert order into database
    const orderResult = await pool.query(
      `INSERT INTO orders (customer_name, customer_phone, customer_email, product_id, product_name, product_price, quantity, notes, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING id, created_at`,
      [customer_name, customer_phone, customer_email || null, product_id, product.name, product.price, quantity || 1, notes || null, 'Pending']
    );
    
    const orderId = orderResult.rows[0].id;
    const created_at = orderResult.rows[0].created_at;

    // Auto-award loyalty points (auto-enrolls customer if not a member)
    const orderTotal = parseFloat(product.price) * (quantity || 1);
    processLoyaltyForNewOrder(customer_phone, customer_name, customer_email, orderTotal, orderId)
      .catch(err => console.error('Loyalty processing error:', err.message));

    const newOrder = {
      id: orderId,
      customer_name,
      customer_phone,
      customer_email,
      product_id,
      product_name: product.name,
      product_price: parseFloat(product.price),
      quantity: quantity || 1,
      notes,
      status: 'Pending',
      created_at: created_at,
    };

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
 * SECURITY: This endpoint should be protected in production
 * Currently public for demo purposes - add authMiddleware if needed
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
 * SECURITY: This endpoint should be protected in production
 * Currently public for demo purposes - add authMiddleware if needed
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
router.get('/portfolio', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM portfolio ORDER BY display_order ASC, created_at DESC'
    );
    
    const portfolio = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      image_url: row.image_url,
      category: row.category,
      client_name: row.client_name,
      project_date: row.project_date,
      featured: row.featured,
      display_order: row.display_order,
      created_at: row.created_at
    }));

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
router.get('/portfolio/featured', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM portfolio WHERE featured = true ORDER BY display_order ASC, created_at DESC'
    );
    
    const portfolio = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      image_url: row.image_url,
      category: row.category,
      client_name: row.client_name,
      project_date: row.project_date,
      featured: row.featured,
      display_order: row.display_order,
      created_at: row.created_at
    }));

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
router.get('/gallery', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM gallery ORDER BY display_order ASC, created_at DESC'
    );
    
    const gallery = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      image_url: row.image_url,
      category: row.category,
      description: row.description,
      display_order: row.display_order,
      created_at: row.created_at
    }));

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
router.get('/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });

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
router.get('/orders/track', async (req, res) => {
  try {
    const { phone, orderId } = req.query;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    let query = 'SELECT * FROM orders WHERE customer_phone = $1';
    const params = [phone];

    // If orderId is provided, filter by it too
    if (orderId) {
      query += ' AND id = $2';
      params.push(parseInt(orderId));
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    
    const orders = result.rows.map(row => ({
      id: row.id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      customer_email: row.customer_email,
      product_id: row.product_id,
      product_name: row.product_name,
      product_price: parseFloat(row.product_price),
      quantity: row.quantity,
      notes: row.notes,
      order_source: row.order_source,
      status: row.status,
      created_at: row.created_at
    }));

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
router.get('/products/:id/reviews', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM reviews WHERE product_id = $1 AND status = $2 ORDER BY created_at DESC',
      [productId, 'approved']
    );
    
    const reviews = result.rows.map(row => ({
      id: row.id,
      product_id: row.product_id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      rating: row.rating,
      review_text: row.review_text,
      status: row.status,
      created_at: row.created_at
    }));

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
    const productResult = await pool.query(
      'SELECT id FROM products WHERE id = $1',
      [productId]
    );
    if (!productResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Insert review
    const result = await pool.query(
      `INSERT INTO reviews (product_id, customer_name, customer_email, rating, review_text) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id`,
      [productId, customer_name.trim(), customer_email?.trim() || null, rating, review_text?.trim() || null]
    );

    const reviewId = result.rows[0].id;

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
router.get('/wishlist/:session_id', async (req, res) => {
  try {
    const sessionId = req.params.session_id;
    
    const result = await pool.query(`
      SELECT w.*, p.name, p.price, p.image_url, p.category 
      FROM wishlist w 
      LEFT JOIN products p ON w.product_id = p.id 
      WHERE w.session_id = $1 
      ORDER BY w.created_at DESC
    `, [sessionId]);

    const wishlistItems = result.rows.map(row => ({
      id: row.id,
      product_id: row.product_id,
      session_id: row.session_id,
      created_at: row.created_at,
      name: row.name,
      price: parseFloat(row.price),
      image_url: row.image_url,
      category: row.category
    }));

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
router.post('/wishlist/:session_id/add', async (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const { product_id } = req.body;

    if (!product_id) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required',
      });
    }

    // Verify product exists
    const productResult = await pool.query(
      'SELECT id FROM products WHERE id = $1',
      [product_id]
    );
    if (!productResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Add to wishlist (ignore if already exists due to UNIQUE constraint)
    try {
      await pool.query(
        'INSERT INTO wishlist (product_id, session_id) VALUES ($1, $2)',
        [product_id, sessionId]
      );
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
router.delete('/wishlist/:session_id/remove/:product_id', async (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const productId = parseInt(req.params.product_id);

    await pool.query(
      'DELETE FROM wishlist WHERE session_id = $1 AND product_id = $2',
      [sessionId, productId]
    );

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
router.get('/customer-info/:session_id', async (req, res) => {
  try {
    const sessionId = req.params.session_id;
    
    const result = await pool.query(
      'SELECT * FROM customer_info WHERE session_id = $1',
      [sessionId]
    );

    let customerInfo = null;
    if (result.rows[0]) {
      const row = result.rows[0];
      customerInfo = {
        id: row.id,
        session_id: row.session_id,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        customer_email: row.customer_email,
        created_at: row.created_at,
        updated_at: row.updated_at
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
router.post('/customer-info/:session_id', async (req, res) => {
  try {
    const sessionId = req.params.session_id;
    const { customer_name, customer_phone, customer_email } = req.body;
    
    // Check if record exists
    const existingResult = await pool.query(
      'SELECT id FROM customer_info WHERE session_id = $1',
      [sessionId]
    );

    if (existingResult.rows[0]) {
      // Update existing record
      await pool.query(
        `UPDATE customer_info 
         SET customer_name = $1, customer_phone = $2, customer_email = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE session_id = $4`,
        [customer_name?.trim() || null, customer_phone?.trim() || null, customer_email?.trim() || null, sessionId]
      );
    } else {
      // Insert new record
      await pool.query(
        `INSERT INTO customer_info (session_id, customer_name, customer_phone, customer_email) 
         VALUES ($1, $2, $3, $4)`,
        [sessionId, customer_name?.trim() || null, customer_phone?.trim() || null, customer_email?.trim() || null]
      );
    }

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

    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const order = result.rows[0];

    // Get settings
    const settingsResult = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    settingsResult.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    const total = parseFloat(order.product_price) * order.quantity;

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
 * POST /api/push/subscribe
 * Save push subscription to database
 */
router.post('/push/subscribe', async (req, res) => {
  try {
    const { session_id, endpoint, keys } = req.body;

    if (!session_id || !endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and endpoint are required'
      });
    }

    // Use INSERT ... ON CONFLICT for PostgreSQL (equivalent to INSERT OR IGNORE)
    await pool.query(
      `INSERT INTO push_subscriptions (session_id, endpoint, keys) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (session_id, endpoint) DO NOTHING`,
      [session_id, endpoint, keys || '{}']
    );

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

/**
 * GET /api/loyalty/check
 * Check loyalty program status by phone number (public route)
 */
router.get('/loyalty/check', async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    // Look up loyalty member
    const result = await pool.query(
      'SELECT * FROM loyalty_program WHERE customer_phone = $1',
      [phone]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'No loyalty membership found for this phone number',
      });
    }

    const member = result.rows[0];

    // Get recent transactions
    const transactionsResult = await pool.query(
      `SELECT id, points, transaction_type, description, order_id, created_at 
       FROM loyalty_transactions 
       WHERE customer_phone = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [phone]
    );

    const transactions = transactionsResult.rows.map(row => ({
      id: row.id,
      points: row.points,
      transaction_type: row.transaction_type,
      description: row.description,
      order_id: row.order_id,
      created_at: row.created_at
    }));

    return res.status(200).json({
      success: true,
      member: {
        customer_name: member.customer_name,
        customer_phone: member.customer_phone,
        customer_email: member.customer_email,
        points: member.points,
        tier: member.tier,
        total_spent: parseFloat(member.total_spent || 0),
        total_orders: member.total_orders || 0,
        created_at: member.created_at,
        updated_at: member.updated_at
      },
      recent_transactions: transactions
    });

  } catch (error) {
    console.error('✗ Error checking loyalty status:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while checking loyalty status.',
    });
  }
});

module.exports = router;
