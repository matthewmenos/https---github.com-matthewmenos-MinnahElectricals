const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const r2Sync = require('../config/r2-sync');
const { authMiddleware } = require('../middleware/auth');
const { sendOrderConfirmationEmail, sendAdminNotificationEmail } = require('../config/email');
require('dotenv').config();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
    }
  }
});

/**
 * POST /api/admin/login
 * Authenticate admin user and return JWT token
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
      });
    }

    // Find user in database
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0] || null;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    // Verify password
    const passwordMatch = bcrypt.compareSync(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✓ Admin login successful: ${username}`);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        username: user.username,
      },
    });

  } catch (error) {
    console.error('✗ Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login. Please try again.',
    });
  }
});

/**
 * POST /api/admin/upload
 * Upload image to R2 media bucket (protected route)
 */
router.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const image = req.file;
    
    // Validate file type (already validated by multer, but double-check)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(image.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.',
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = image.originalname.split('.').pop();
    const fileName = `product_${timestamp}_${randomString}.${extension}`;

    // Upload to R2
    const mediaUrl = await r2Sync.uploadMediaToR2(image.buffer, fileName, image.mimetype);

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
 * GET /api/admin/products
 * Get all products (protected route)
 */
router.get('/products', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products ORDER BY created_at DESC'
    );
    
    const products = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      image_url: row.image_url,
      category: row.category,
      in_stock: row.in_stock,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    console.log(`✓ Fetched ${products.length} products`);

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
 * POST /api/admin/products
 * Create a new product (protected route)
 */
router.post('/products', authMiddleware, async (req, res) => {
  try {
    const { name, description, price, category, image_url, in_stock } = req.body;

    // Validate required fields
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, and category are required',
      });
    }

    // Insert product into database
    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, image_url, in_stock) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, created_at`,
      [
        name,
        description || null,
        price,
        category,
        image_url || null,
        in_stock !== undefined ? in_stock : true
      ]
    );

    const productId = result.rows[0].id;
    const created_at = result.rows[0].created_at;

    const newProduct = {
      id: productId,
      name,
      description,
      price: parseFloat(price),
      category,
      image_url: image_url,
      in_stock: in_stock !== undefined ? in_stock : true,
      created_at: created_at,
      updated_at: created_at
    };

    console.log(`✓ New product created: #${newProduct.id} - ${name}`);

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: newProduct,
    });

  } catch (error) {
    console.error('✗ Error creating product:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the product.',
    });
  }
});

/**
 * PUT /api/admin/products/:id
 * Update a product (protected route)
 */
router.put('/products/:id', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { name, description, price, category, image_url, in_stock } = req.body;

    // Validate required fields
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, and category are required',
      });
    }

    // Check if product exists
    const checkResult = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Update product
    await pool.query(
      `UPDATE products 
       SET name = $1, description = $2, price = $3, category = $4, image_url = $5, in_stock = $6, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $7`,
      [
        name,
        description || null,
        price,
        category,
        image_url || null,
        in_stock !== undefined ? in_stock : true,
        productId
      ]
    );

    console.log(`✓ Product updated: #${productId}`);

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product: {
        id: productId,
        name,
        description,
        price: parseFloat(price),
        category,
        image_url: image_url,
        in_stock: in_stock !== undefined ? in_stock : true,
      }
    });

  } catch (error) {
    console.error('✗ Error updating product:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the product.',
    });
  }
});

/**
 * DELETE /api/admin/products/:id
 * Delete a product (protected route)
 */
router.delete('/products/:id', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    // Check if product exists
    const checkResult = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Delete product
    await pool.query('DELETE FROM products WHERE id = $1', [productId]);

    console.log(`✓ Product deleted: #${productId}`);

    return res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
    });

  } catch (error) {
    console.error('✗ Error deleting product:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the product.',
    });
  }
});

/**
 * GET /api/admin/leads
 * Get all leads (protected route)
 */
router.get('/leads', authMiddleware, async (req, res) => {
  try {
    const { status, urgency } = req.query;
    
    let query = 'SELECT * FROM leads';
    const conditions = [];
    const params = [];

    // Filter by status if provided
    if (status && status !== 'all') {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    // Filter by urgency if provided
    if (urgency && urgency !== 'all') {
      conditions.push(`urgency = $${params.length + 1}`);
      params.push(urgency);
    }

    // Add WHERE clause if conditions exist
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Order by most recent first
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    const leads = result.rows.map(row => ({
      id: row.id,
      full_name: row.full_name,
      phone: row.phone,
      email: row.email,
      service_needed: row.service_needed,
      urgency: row.urgency,
      message: row.message,
      status: row.status,
      created_at: row.created_at
    }));

    // Format dates for display
    const formattedLeads = leads.map(lead => ({
      ...lead,
      created_at: new Date(lead.created_at).toISOString(),
    }));

    console.log(`✓ Fetched ${formattedLeads.length} leads`);

    return res.status(200).json({
      success: true,
      count: formattedLeads.length,
      leads: formattedLeads,
    });

  } catch (error) {
    console.error('✗ Error fetching leads:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching leads.',
    });
  }
});

/**
 * PATCH /api/admin/leads/:id
 * Update lead status (protected route)
 */
router.patch('/leads/:id', authMiddleware, async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    const { status } = req.body;

    // Validate status
    const validStatuses = ['New', 'Contacted', 'Scheduled', 'Completed', 'Archived'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    // Check if lead exists
    const checkResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    const existingLead = checkResult.rows[0] || null;

    if (!existingLead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found',
      });
    }

    // Update lead status
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', [status, leadId]);

    console.log(`✓ Lead #${leadId} status updated to: ${status}`);

    return res.status(200).json({
      success: true,
      message: 'Lead status updated successfully',
      lead: {
        id: leadId,
        status: status,
      },
    });

  } catch (error) {
    console.error('✗ Error updating lead:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the lead.',
    });
  }
});

/**
 * DELETE /api/admin/leads/:id
 * Delete a lead (protected route)
 */
router.delete('/leads/:id', authMiddleware, async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);

    // Check if lead exists
    const checkResult = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    const existingLead = checkResult.rows[0] || null;

    if (!existingLead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found',
      });
    }

    // Delete lead
    await pool.query('DELETE FROM leads WHERE id = $1', [leadId]);

    console.log(`✓ Lead #${leadId} deleted`);

    return res.status(200).json({
      success: true,
      message: 'Lead deleted successfully',
    });

  } catch (error) {
    console.error('✗ Error deleting lead:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the lead.',
    });
  }
});

/**
 * GET /api/admin/stats
 * Get dashboard statistics (protected route)
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    // Total leads
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM leads');
    const totalLeads = parseInt(totalResult.rows[0].count) || 0;

    // Leads by status
    const statusResult = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM leads 
      GROUP BY status
    `);
    const leadsByStatus = statusResult.rows.map(row => ({
      status: row.status,
      count: parseInt(row.count)
    }));

    // Recent leads (last 7 days)
    const recentResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM leads 
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    const recentLeads = parseInt(recentResult.rows[0].count) || 0;

    // Emergency leads
    const emergencyResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM leads 
      WHERE urgency = 'Emergency' AND status = 'New'
    `);
    const emergencyLeads = parseInt(emergencyResult.rows[0].count) || 0;

    return res.status(200).json({
      success: true,
      stats: {
        total: totalLeads,
        recent: recentLeads,
        emergency: emergencyLeads,
        byStatus: leadsByStatus,
      },
    });

  } catch (error) {
    console.error('✗ Error fetching stats:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching statistics.',
    });
  }
});

/**
 * DELETE /api/admin/portfolio/:id
 * Delete portfolio item (protected route)
 */
router.delete('/portfolio/:id', authMiddleware, async (req, res) => {
  try {
    const portfolioId = parseInt(req.params.id);

    const checkResult = await pool.query('SELECT * FROM portfolio WHERE id = $1', [portfolioId]);
    
    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found',
      });
    }

    await pool.query('DELETE FROM portfolio WHERE id = $1', [portfolioId]);

    console.log(`✓ Portfolio item deleted: #${portfolioId}`);

    return res.status(200).json({
      success: true,
      message: 'Portfolio item deleted successfully',
    });

  } catch (error) {
    console.error('✗ Error deleting portfolio item:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the portfolio item.',
    });
  }
});

/**
 * GET /api/admin/gallery
 * Get all gallery items (protected route)
 */
router.get('/gallery', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM gallery ORDER BY display_order ASC, created_at DESC');
    
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
 * POST /api/admin/gallery
 * Create a new gallery item (protected route)
 */
router.post('/gallery', authMiddleware, async (req, res) => {
  try {
    const { title, image_url, category, description, display_order } = req.body;

    if (!image_url) {
      return res.status(400).json({
        success: false,
        message: 'Gallery image is required',
      });
    }

    const result = await pool.query(
      `INSERT INTO gallery (title, image_url, category, description, display_order) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id`,
      [title || '', image_url, category || '', description || '', display_order || 0]
    );
    
    const galleryId = result.rows[0].id;

    console.log(`✓ Gallery item created: #${galleryId}`);

    return res.status(201).json({
      success: true,
      message: 'Gallery item created successfully',
      gallery: { id: galleryId, title, image_url, category, description, display_order }
    });

  } catch (error) {
    console.error('✗ Error creating gallery item:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the gallery item.',
    });
  }
});

/**
 * PUT /api/admin/gallery/:id
 * Update a gallery item (protected route)
 */
router.put('/gallery/:id', authMiddleware, async (req, res) => {
  try {
    const galleryId = parseInt(req.params.id);
    const { title, image_url, category, description, display_order } = req.body;

    const checkResult = await pool.query('SELECT * FROM gallery WHERE id = $1', [galleryId]);
    
    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found',
      });
    }

    await pool.query(
      `UPDATE gallery SET title = $1, image_url = $2, category = $3, description = $4, display_order = $5 WHERE id = $6`,
      [title || '', image_url, category || '', description || '', display_order || 0, galleryId]
    );

    console.log(`✓ Gallery item updated: #${galleryId}`);

    return res.status(200).json({
      success: true,
      message: 'Gallery item updated successfully',
    });

  } catch (error) {
    console.error('✗ Error updating gallery item:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the gallery item.',
    });
  }
});

/**
 * DELETE /api/admin/gallery/:id
 * Delete a gallery item (protected route)
 */
router.delete('/gallery/:id', authMiddleware, async (req, res) => {
  try {
    const galleryId = parseInt(req.params.id);

    const checkResult = await pool.query('SELECT * FROM gallery WHERE id = $1', [galleryId]);
    
    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found',
      });
    }

    await pool.query('DELETE FROM gallery WHERE id = $1', [galleryId]);

    console.log(`✓ Gallery item deleted: #${galleryId}`);

    return res.status(200).json({
      success: true,
      message: 'Gallery item deleted successfully',
    });

  } catch (error) {
    console.error('✗ Error deleting gallery item:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the gallery item.',
    });
  }
});


/**
 * GET /api/admin/analytics
 * Get advanced analytics (protected route)
 */
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const { period = '30' } = req.query; // days, default 30
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Total revenue
    const revenueResult = await pool.query(`
      SELECT COALESCE(SUM(product_price * quantity), 0) as total_revenue 
      FROM orders 
      WHERE status = 'Completed' AND created_at >= $1
    `, [startDate.toISOString()]);
    const totalRevenue = parseFloat(revenueResult.rows[0].total_revenue) || 0;

    // Total orders
    const ordersResult = await pool.query(`
      SELECT COUNT(*) as count, 
             SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
             SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM orders 
      WHERE created_at >= $1
    `, [startDate.toISOString()]);
    const ordersStats = ordersResult.rows[0] ? {
      total: parseInt(ordersResult.rows[0].count) || 0,
      completed: parseInt(ordersResult.rows[0].completed) || 0,
      pending: parseInt(ordersResult.rows[0].pending) || 0,
      confirmed: parseInt(ordersResult.rows[0].confirmed) || 0
    } : { total: 0, completed: 0, pending: 0, confirmed: 0 };

    // Top selling products
    const topProductsResult = await pool.query(`
      SELECT product_id, product_name, SUM(quantity) as total_qty, SUM(product_price * quantity) as total_sales
      FROM orders
      WHERE created_at >= $1
      GROUP BY product_id, product_name
      ORDER BY total_qty DESC
      LIMIT 10
    `, [startDate.toISOString()]);
    const topProducts = topProductsResult.rows.map(row => ({
      product_id: row.product_id,
      product_name: row.product_name,
      total_quantity: parseInt(row.total_qty),
      total_sales: parseFloat(row.total_sales)
    }));

    // Daily sales for chart
    const dailySalesResult = await pool.query(`
      SELECT DATE(created_at) as date, COALESCE(SUM(product_price * quantity), 0) as daily_total
      FROM orders
      WHERE created_at >= $1 AND status = 'Completed'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [startDate.toISOString()]);
    const dailySales = dailySalesResult.rows.map(row => ({
      date: row.date,
      total: parseFloat(row.daily_total) || 0
    }));

    // Customer statistics
    const customerStatsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT customer_phone) as unique_customers,
        COUNT(DISTINCT CASE WHEN customer_email != '' THEN customer_email END) as with_email,
        SUM(CASE WHEN customer_email != '' THEN 1 ELSE 0 END) as email_subscribers
      FROM orders
      WHERE created_at >= $1
    `, [startDate.toISOString()]);
    const customerStats = customerStatsResult.rows[0] ? {
      unique_customers: parseInt(customerStatsResult.rows[0].unique_customers) || 0,
      with_email: parseInt(customerStatsResult.rows[0].with_email) || 0,
      email_subscribers: parseInt(customerStatsResult.rows[0].email_subscribers) || 0
    } : { unique_customers: 0, with_email: 0, email_subscribers: 0 };

    // Appointment statistics (gracefully handle missing table)
    let appointmentStats = { total: 0, confirmed: 0, pending: 0, completed: 0, cancelled: 0 };
    try {
      const appointmentStatsResult = await pool.query(`
        SELECT 
          COUNT(*) as total_appointments,
          SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM appointments
        WHERE created_at >= $1
      `, [startDate.toISOString()]);
      if (appointmentStatsResult.rows[0]) {
        appointmentStats = {
          total: parseInt(appointmentStatsResult.rows[0].total_appointments) || 0,
          confirmed: parseInt(appointmentStatsResult.rows[0].confirmed) || 0,
          pending: parseInt(appointmentStatsResult.rows[0].pending) || 0,
          completed: parseInt(appointmentStatsResult.rows[0].completed) || 0,
          cancelled: parseInt(appointmentStatsResult.rows[0].cancelled) || 0
        };
      }
    } catch (e) {
      // appointments table doesn't exist yet
    }

    // Service request statistics (gracefully handle missing table)
    let serviceRequestStats = { total: 0, open: 0, in_progress: 0, completed: 0, urgent: 0 };
    try {
      const serviceRequestStatsResult = await pool.query(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent
        FROM service_requests
        WHERE created_at >= $1
      `, [startDate.toISOString()]);
      if (serviceRequestStatsResult.rows[0]) {
        serviceRequestStats = {
          total: parseInt(serviceRequestStatsResult.rows[0].total_requests) || 0,
          open: parseInt(serviceRequestStatsResult.rows[0].open) || 0,
          in_progress: parseInt(serviceRequestStatsResult.rows[0].in_progress) || 0,
          completed: parseInt(serviceRequestStatsResult.rows[0].completed) || 0,
          urgent: parseInt(serviceRequestStatsResult.rows[0].urgent) || 0
        };
      }
    } catch (e) {
      // service_requests table doesn't exist yet
    }

    // Loyalty program statistics
    const loyaltyStatsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_members,
        COALESCE(SUM(points), 0) as total_points_issued,
        COALESCE(SUM(total_spent), 0) as total_loyalty_spent,
        COALESCE(SUM(total_orders), 0) as total_loyalty_orders,
        COALESCE(AVG(points), 0) as avg_points_per_member
      FROM loyalty_program
    `);
    const loyaltyStats = loyaltyStatsResult.rows[0] ? {
      total_members: parseInt(loyaltyStatsResult.rows[0].total_members) || 0,
      total_points_issued: parseInt(loyaltyStatsResult.rows[0].total_points_issued) || 0,
      total_loyalty_spent: parseFloat(loyaltyStatsResult.rows[0].total_loyalty_spent) || 0,
      total_loyalty_orders: parseInt(loyaltyStatsResult.rows[0].total_loyalty_orders) || 0,
      avg_points_per_member: parseFloat(loyaltyStatsResult.rows[0].avg_points_per_member) || 0
    } : { total_members: 0, total_points_issued: 0, total_loyalty_spent: 0, total_loyalty_orders: 0, avg_points_per_member: 0 };

    // Newsletter statistics (gracefully handle missing table)
    let newsletterStats = { total_subscribers: 0, active_subscribers: 0 };
    try {
      const newsletterStatsResult = await pool.query(`
        SELECT 
          COUNT(*) as total_subscribers,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_subscribers
        FROM newsletter_subscribers
      `);
      if (newsletterStatsResult.rows[0]) {
        newsletterStats = {
          total_subscribers: parseInt(newsletterStatsResult.rows[0].total_subscribers) || 0,
          active_subscribers: parseInt(newsletterStatsResult.rows[0].active_subscribers) || 0
        };
      }
    } catch (e) {
      // newsletter_subscribers table doesn't exist yet
    }

    // Lead statistics
    const leadStatsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_leads,
        SUM(CASE WHEN urgency = 'Emergency' THEN 1 ELSE 0 END) as emergency_leads,
        SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN status = 'Contacted' THEN 1 ELSE 0 END) as contacted_leads
      FROM leads
      WHERE created_at >= $1
    `, [startDate.toISOString()]);
    const leadStats = leadStatsResult.rows[0] ? {
      total: parseInt(leadStatsResult.rows[0].total_leads) || 0,
      emergency: parseInt(leadStatsResult.rows[0].emergency_leads) || 0,
      new: parseInt(leadStatsResult.rows[0].new_leads) || 0,
      contacted: parseInt(leadStatsResult.rows[0].contacted_leads) || 0
    } : { total: 0, emergency: 0, new: 0, contacted: 0 };

    return res.status(200).json({
      success: true,
      analytics: {
        period_days: days,
        revenue: {
          total_revenue: totalRevenue,
          orders: ordersStats
        },
        customers: customerStats,
        appointments: appointmentStats,
        service_requests: serviceRequestStats,
        loyalty_program: loyaltyStats,
        newsletter: newsletterStats,
        leads: leadStats,
        top_products: topProducts,
        daily_sales: dailySales
      }
    });

  } catch (error) {
    console.error('✗ Error fetching analytics:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching analytics.',
    });
  }
});

/**
 * GET /api/admin/customers
 * Get all customers with order history (protected route)
 */
router.get('/customers', authMiddleware, async (req, res) => {
  try {
    const { search = '' } = req.query;

    let query = `
      SELECT 
        customer_name,
        customer_phone,
        customer_email,
        COUNT(*) as order_count,
        COALESCE(SUM(product_price * quantity), 0) as total_spent,
        MAX(created_at) as last_order_date,
        MIN(created_at) as first_order_date
      FROM orders
    `;
    const params = [];

    if (search) {
      query += ` WHERE customer_name ILIKE $1 OR customer_phone ILIKE $1 OR customer_email ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY customer_phone ORDER BY last_order_date DESC`;

    const result = await pool.query(query, params);
    const customers = result.rows.map(row => ({
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      customer_email: row.customer_email,
      order_count: parseInt(row.order_count),
      total_spent: parseFloat(row.total_spent) || 0,
      last_order_date: row.last_order_date,
      first_order_date: row.first_order_date
    }));

    return res.status(200).json({
      success: true,
      count: customers.length,
      customers: customers,
    });

  } catch (error) {
    console.error('✗ Error fetching customers:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching customers.',
    });
  }
});

/**
 * GET /api/admin/inventory
 * Get inventory status (protected route)
 */
router.get('/inventory', authMiddleware, async (req, res) => {
  try {
    const { low_stock = 'false' } = req.query;

    let query = 'SELECT * FROM products';
    if (low_stock === 'true') {
      query += ' WHERE in_stock = false';
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query);
    const products = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      image_url: row.image_url,
      category: row.category,
      in_stock: row.in_stock,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    // Get order counts for each product
    const productsWithStats = [];
    for (const product of products) {
      const orderStats = await pool.query(`
        SELECT COUNT(*) as order_count, COALESCE(SUM(quantity), 0) as total_ordered
        FROM orders
        WHERE product_id = $1
      `, [product.id]);
      
      const stats = orderStats.rows[0] ? {
        order_count: parseInt(orderStats.rows[0].order_count) || 0,
        total_ordered: parseInt(orderStats.rows[0].total_ordered) || 0
      } : { order_count: 0, total_ordered: 0 };

      productsWithStats.push({
        ...product,
        ...stats
      });
    }

    return res.status(200).json({
      success: true,
      count: productsWithStats.length,
      products: productsWithStats,
    });

  } catch (error) {
    console.error('✗ Error fetching inventory:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching inventory.',
    });
  }
});

/**
 * GET /api/admin/orders
 * Get all orders (protected route)
 */
router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { status, source, start_date, end_date } = req.query;
    
    let query = 'SELECT * FROM orders';
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (source && source !== 'all') {
      conditions.push(`order_source = $${params.length + 1}`);
      params.push(source);
    }

    if (start_date) {
      conditions.push(`created_at >= $${params.length + 1}`);
      params.push(start_date);
    }

    if (end_date) {
      conditions.push(`created_at <= $${params.length + 1}`);
      params.push(end_date);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
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

    console.log(`✓ Fetched ${orders.length} orders`);

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders: orders,
    });

  } catch (error) {
    console.error('✗ Error fetching orders:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching orders.',
    });
  }
});

/**
 * PATCH /api/admin/orders/:id
 * Update order status (protected route)
 */
router.patch('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;

    // Validate status
    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    // Check if order exists
    const checkResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Update order status
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);

    console.log(`✓ Order #${orderId} status updated to: ${status}`);

    return res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
    });

  } catch (error) {
    console.error('✗ Error updating order:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the order.',
    });
  }
});

/**
 * POST /api/admin/orders/manual
 * Create a manual order (protected route)
 */
router.post('/orders/manual', authMiddleware, async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_email, notes, order_source, products } = req.body;

    if (!customer_name || !customer_phone || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, and at least one product are required',
      });
    }

    if (!order_source || !['manual', 'website'].includes(order_source)) {
      return res.status(400).json({
        success: false,
        message: 'Valid order source is required (manual or website)',
      });
    }

    // Create orders for each product
    const createdOrders = [];
    for (const product of products) {
      const productId = product.product_id;
      const quantity = parseInt(product.quantity) || 1;

      // Get product details
      const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
      if (!productResult.rows[0]) {
        return res.status(404).json({
          success: false,
          message: `Product #${productId} not found`,
        });
      }

      const productData = productResult.rows[0];

      const orderResult = await pool.query(
        `INSERT INTO orders (customer_name, customer_phone, customer_email, product_id, product_name, product_price, quantity, notes, order_source, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING id, created_at`,
        [customer_name, customer_phone, customer_email || null, productId, productData.name, productData.price, quantity, notes || null, order_source, 'Pending']
      );

      const orderId = orderResult.rows[0].id;
      createdOrders.push({
        id: orderId,
        customer_name,
        customer_phone,
        customer_email,
        product_id: productId,
        product_name: productData.name,
        product_price: parseFloat(productData.price),
        quantity,
        notes,
        order_source,
        status: 'Pending',
        created_at: orderResult.rows[0].created_at
      });
    }

    console.log(`✓ Created ${createdOrders.length} manual order(s) for ${customer_name}`);

    return res.status(201).json({
      success: true,
      message: `Successfully created ${createdOrders.length} order(s)`,
      orders: createdOrders,
    });

  } catch (error) {
    console.error('✗ Error creating manual order:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the order.',
    });
  }
});

/**
 * PATCH /api/admin/orders/bulk-status
 * Update multiple orders status at once (protected route)
 */
router.patch('/orders/bulk-status', authMiddleware, async (req, res) => {
  try {
    const { order_ids, status } = req.body;

    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order IDs array is required',
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    const placeholders = order_ids.map((_, i) => `$${i + 2}`).join(',');
    await pool.query(
      `UPDATE orders SET status = $1 WHERE id IN (${placeholders})`,
      [status, ...order_ids]
    );

    console.log(`✓ Bulk updated ${order_ids.length} orders to status: ${status}`);

    return res.status(200).json({
      success: true,
      message: `Successfully updated ${order_ids.length} order(s) to ${status}`,
      updated_count: order_ids.length,
    });

  } catch (error) {
    console.error('✗ Error bulk updating orders:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating orders.',
    });
  }
});

/**
 * GET /api/admin/settings
 * Get all settings (protected route)
 */
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return res.status(200).json({ success: true, settings: settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return res.status(500).json({ success: false, message: 'An error occurred while fetching settings.' });
  }
});

/**
 * PUT /api/admin/settings
 * Update settings (protected route)
 */
router.put('/settings', authMiddleware, async (req, res) => {
  try {
    const { phone, email, location, whatsapp } = req.body;
    const existingCount = await pool.query('SELECT COUNT(*) as count FROM settings');
    if (parseInt(existingCount.rows[0].count) === 0) {
      const defaults = [
        ['phone', phone || process.env.COMPANY_PHONE || '(555) 123-4567'],
        ['email', email || process.env.COMPANY_EMAIL || 'info@minnahelectricals.com'],
        ['location', location || process.env.COMPANY_LOCATION || 'Serving the Local Area'],
        ['whatsapp', whatsapp || ''],
      ];
      for (const [key, value] of defaults) {
        await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
      }
    } else {
      if (phone !== undefined) await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['phone', phone]);
      if (email !== undefined) await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['email', email]);
      if (location !== undefined) await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['location', location]);
      if (whatsapp !== undefined) await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['whatsapp', whatsapp]);
    }
    console.log('Settings updated');
    return res.status(200).json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error updating settings:', error);
    return res.status(500).json({ success: false, message: 'An error occurred while updating settings.' });
  }
});

/**
 * GET /api/admin/templates
 * Get all communication templates
 */
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const { type } = req.query;
    let query = 'SELECT * FROM templates';
    const params = [];

    if (type) {
      query += ' WHERE type = $1';
      params.push(type);
    }

    query += ' ORDER BY name, created_at DESC';

    const result = await pool.query(query, params);

    const templates = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      subject: row.subject,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return res.status(200).json({
      success: true,
      count: templates.length,
      templates: templates,
    });
  } catch (error) {
    console.error('✗ Error fetching templates:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching templates.',
    });
  }
});

/**
 * POST /api/admin/templates
 * Create a new communication template
 */
router.post('/templates', authMiddleware, async (req, res) => {
  try {
    const { name, type, subject, content } = req.body;

    if (!name || !type || !content) {
      return res.status(400).json({
        success: false,
        message: 'Template name, type, and content are required',
      });
    }

    const validTypes = ['email', 'sms', 'whatsapp'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template type. Must be one of: ' + validTypes.join(', '),
      });
    }

    const result = await pool.query(
      'INSERT INTO templates (name, type, subject, content) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, type, subject || null, content]
    );

    const templateId = result.rows[0].id;

    console.log(`✓ Template created: #${templateId} - ${name}`);

    return res.status(201).json({
      success: true,
      message: 'Template created successfully',
      template: { id: templateId, name, type, subject, content },
    });
  } catch (error) {
    console.error('✗ Error creating template:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the template.',
    });
  }
});

/**
 * PUT /api/admin/templates/:id
 * Update a communication template
 */
router.put('/templates/:id', authMiddleware, async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const { name, type, subject, content } = req.body;

    const checkResult = await pool.query('SELECT id FROM templates WHERE id = $1', [templateId]);

    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    await pool.query(
      'UPDATE templates SET name = $1, type = $2, subject = $3, content = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
      [name, type, subject || null, content, templateId]
    );

    console.log(`✓ Template updated: #${templateId}`);

    return res.status(200).json({
      success: true,
      message: 'Template updated successfully',
    });
  } catch (error) {
    console.error('✗ Error updating template:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the template.',
    });
  }
});

/**
 * DELETE /api/admin/templates/:id
 * Delete a communication template
 */
router.delete('/templates/:id', authMiddleware, async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);

    const checkResult = await pool.query('SELECT id FROM templates WHERE id = $1', [templateId]);

    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    await pool.query('DELETE FROM templates WHERE id = $1', [templateId]);

    console.log(`✓ Template deleted: #${templateId}`);

    return res.status(200).json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (error) {
    console.error('✗ Error deleting template:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the template.',
    });
  }
});

/**
 * GET /api/admin/sms-logs
 * Get SMS delivery logs
 */
router.get('/sms-logs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT 100');

    const logs = result.rows.map(row => ({
      id: row.id,
      phone: row.phone,
      message: row.message,
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at
    }));

    return res.status(200).json({
      success: true,
      count: logs.length,
      logs: logs,
    });
  } catch (error) {
    console.error('✗ Error fetching SMS logs:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching SMS logs.',
    });
  }
});

/**
 * GET /api/admin/newsletter/subscribers
 * Get newsletter subscribers
 */
router.get('/newsletter/subscribers', authMiddleware, async (req, res) => {
  try {
    const { status = 'active' } = req.query;

    let query = 'SELECT * FROM newsletter_subscribers';
    const params = [];

    if (status !== 'all') {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY subscribed_at DESC';

    const result = await pool.query(query, params);
    const subscribers = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      subscribed_at: row.subscribed_at,
      unsubscribed_at: row.unsubscribed_at
    }));

    return res.status(200).json({
      success: true,
      count: subscribers.length,
      subscribers: subscribers,
    });

  } catch (error) {
    console.error('✗ Error fetching newsletter subscribers:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching newsletter subscribers.',
    });
  }
});

/**
 * GET /api/admin/newsletter/campaigns
 * Get all newsletter campaigns (protected route)
 */
router.get('/newsletter/campaigns', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC');

    const campaigns = result.rows.map(row => ({
      id: row.id,
      subject: row.subject,
      content: row.content,
      recipient_filter: row.recipient_filter,
      sent_count: row.sent_count,
      opened_count: row.opened_count,
      clicked_count: row.clicked_count,
      status: row.status,
      sent_at: row.sent_at,
      created_at: row.created_at
    }));

    return res.status(200).json({
      success: true,
      count: campaigns.length,
      campaigns: campaigns,
    });

  } catch (error) {
    console.error('✗ Error fetching newsletter campaigns:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching newsletter campaigns.',
    });
  }
});

/**
 * POST /api/admin/newsletter/campaigns
 * Create a new newsletter campaign (protected route)
 */
router.post('/newsletter/campaigns', authMiddleware, async (req, res) => {
  try {
    const { subject, content, recipient_filter } = req.body;

    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: 'Subject and content are required',
      });
    }

    const result = await pool.query(
      'INSERT INTO newsletter_campaigns (subject, content, recipient_filter, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [subject, content, recipient_filter || 'all', 'draft']
    );

    const campaignId = result.rows[0].id;

    console.log(`✓ Newsletter campaign created: #${campaignId}`);

    return res.status(201).json({
      success: true,
      message: 'Newsletter campaign created successfully',
      campaign_id: campaignId,
    });

  } catch (error) {
    console.error('✗ Error creating newsletter campaign:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the newsletter campaign.',
    });
  }
});

/**
 * POST /api/admin/newsletter/campaigns/:id/send
 * Send a newsletter campaign (protected route)
 */
router.post('/newsletter/campaigns/:id/send', authMiddleware, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);

    // Get campaign details
    const campaignResult = await pool.query('SELECT * FROM newsletter_campaigns WHERE id = $1', [campaignId]);

    if (!campaignResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    const campaign = {
      id: campaignResult.rows[0].id,
      subject: campaignResult.rows[0].subject,
      content: campaignResult.rows[0].content,
      recipient_filter: campaignResult.rows[0].recipient_filter,
      status: campaignResult.rows[0].status
    };

    if (campaign.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Campaign has already been sent',
      });
    }

    // Get subscribers based on filter
    let subscriberQuery = 'SELECT email, name FROM newsletter_subscribers WHERE status = $1';
    const subscriberParams = ['active'];

    if (campaign.recipient_filter !== 'all') {
      // Add more filters as needed
    }

    const subscriberResult = await pool.query(subscriberQuery, subscriberParams);
    const subscribers = subscriberResult.rows;

    if (subscribers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active subscribers found',
      });
    }

    // Update campaign status to sending
    await pool.query(
      'UPDATE newsletter_campaigns SET status = $1 WHERE id = $2',
      ['sending', campaignId]
    );

    // Send emails (non-blocking)
    let sentCount = 0;
    let failedCount = 0;

    for (const subscriber of subscribers) {
      try {
        const email = subscriber.email;
        const name = subscriber.name;
        
        // Replace placeholders in content
        let personalizedContent = campaign.content.replace(/\{\{name\}\}/g, name || 'Subscriber');
        personalizedContent = personalizedContent.replace(/\{\{email\}\}/g, email);

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: campaign.subject,
          html: personalizedContent,
        });

        sentCount++;
      } catch (error) {
        console.error(`✗ Failed to send to ${subscriber.email}:`, error.message);
        failedCount++;
      }
    }

    // Update campaign with results
    await pool.query(
      `UPDATE newsletter_campaigns 
       SET status = $1, sent_count = $2, sent_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      ['sent', sentCount, campaignId]
    );

    console.log(`✓ Newsletter campaign #${campaignId} sent to ${sentCount} subscribers (${failedCount} failed)`);

    return res.status(200).json({
      success: true,
      message: `Newsletter sent to ${sentCount} subscribers`,
      sent_count: sentCount,
      failed_count: failedCount,
    });

  } catch (error) {
    console.error('✗ Error sending newsletter campaign:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while sending the newsletter campaign.',
    });
  }
});

/**
 * GET /api/admin/loyalty/members
 * Get all loyalty program members (protected route)
 */
router.get('/loyalty/members', authMiddleware, async (req, res) => {
  try {
    const { tier, search = '' } = req.query;

    let query = 'SELECT * FROM loyalty_program';
    const params = [];

    if (tier && tier !== 'all') {
      query += ' WHERE tier = $1';
      params.push(tier);
    } else if (search) {
      query += ' WHERE customer_name ILIKE $1 OR customer_phone ILIKE $1 OR customer_email ILIKE $1';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY points DESC, total_spent DESC';

    const result = await pool.query(query, params);
    const members = result.rows.map(row => ({
      id: row.id,
      customer_phone: row.customer_phone,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      points: row.points,
      tier: row.tier,
      total_spent: parseFloat(row.total_spent),
      total_orders: row.total_orders,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return res.status(200).json({
      success: true,
      count: members.length,
      members: members,
    });

  } catch (error) {
    console.error('✗ Error fetching loyalty members:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching loyalty members.',
    });
  }
});

/**
 * POST /api/admin/loyalty/members
 * Add or update loyalty program member (protected route)
 */
router.post('/loyalty/members', authMiddleware, async (req, res) => {
  try {
    const { customer_phone, customer_name, customer_email, points, tier } = req.body;

    if (!customer_phone || !customer_name) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone and name are required',
      });
    }
    
    // Check if member exists
    const existingResult = await pool.query('SELECT id FROM loyalty_program WHERE customer_phone = $1', [customer_phone]);

    if (existingResult.rows[0]) {
      // Update existing member
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (customer_email !== undefined) {
        updates.push(`customer_email = $${paramIndex}`);
        params.push(customer_email);
        paramIndex++;
      }

      if (points !== undefined) {
        updates.push(`points = $${paramIndex}`);
        params.push(points);
        paramIndex++;
      }

      if (tier) {
        updates.push(`tier = $${paramIndex}`);
        params.push(tier);
        paramIndex++;
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(customer_phone);

      await pool.query(
        `UPDATE loyalty_program SET ${updates.join(', ')} WHERE customer_phone = $${paramIndex}`,
        params
      );
    } else {
      // Create new member
      await pool.query(
        `INSERT INTO loyalty_program (customer_phone, customer_name, customer_email, points, tier) VALUES ($1, $2, $3, $4, $5)`,
        [customer_phone, customer_name, customer_email || null, points || 0, tier || 'bronze']
      );
    }

    console.log(`✓ Loyalty member saved: ${customer_phone}`);

    return res.status(200).json({
      success: true,
      message: 'Loyalty member saved successfully',
    });

  } catch (error) {
    console.error('✗ Error saving loyalty member:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while saving loyalty member.',
    });
  }
});

/**
 * POST /api/admin/loyalty/transactions
 * Add loyalty points transaction (protected route)
 */
router.post('/loyalty/transactions', authMiddleware, async (req, res) => {
  try {
    const { customer_phone, points, transaction_type, description, order_id } = req.body;

    if (!customer_phone || !points || !transaction_type) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone, points, and transaction type are required',
      });
    }

    const validTypes = ['earned', 'redeemed', 'bonus', 'expired'];
    if (!validTypes.includes(transaction_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction type. Must be one of: ' + validTypes.join(', '),
      });
    }

    // Verify customer exists in loyalty program
    const memberResult = await pool.query('SELECT id, points FROM loyalty_program WHERE customer_phone = $1', [customer_phone]);

    if (!memberResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found in loyalty program',
      });
    }

    const currentPoints = memberResult.rows[0].points;

    // Calculate new points
    let newPoints = currentPoints;
    if (transaction_type === 'earned' || transaction_type === 'bonus') {
      newPoints = currentPoints + points;
    } else if (transaction_type === 'redeemed' || transaction_type === 'expired') {
      newPoints = Math.max(0, currentPoints - points);
    }

    // Update member points
    await pool.query(
      'UPDATE loyalty_program SET points = $1, updated_at = CURRENT_TIMESTAMP WHERE customer_phone = $2',
      [newPoints, customer_phone]
    );

    // Record transaction
    await pool.query(
      `INSERT INTO loyalty_transactions (customer_phone, points, transaction_type, description, order_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [customer_phone, points, transaction_type, description || null, order_id || null]
    );

    console.log(`✓ Loyalty transaction recorded: ${customer_phone} - ${transaction_type} ${points} points`);

    return res.status(201).json({
      success: true,
      message: 'Loyalty transaction recorded successfully',
      new_balance: newPoints,
    });

  } catch (error) {
    console.error('✗ Error recording loyalty transaction:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while recording the loyalty transaction.',
    });
  }
});

/**
 * GET /api/admin/service-requests
 * Get all service requests (protected route)
 */
router.get('/service-requests', authMiddleware, async (req, res) => {
  try {
    const { status, priority, assigned_to } = req.query;

    let query = 'SELECT * FROM service_requests';
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (priority && priority !== 'all') {
      conditions.push(`priority = $${params.length + 1}`);
      params.push(priority);
    }

    if (assigned_to) {
      conditions.push(`assigned_to = $${params.length + 1}`);
      params.push(assigned_to);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    const serviceRequests = result.rows.map(row => ({
      id: row.id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      customer_email: row.customer_email,
      service_type: row.service_type,
      description: row.description,
      priority: row.priority,
      status: row.status,
      assigned_to: row.assigned_to,
      scheduled_date: row.scheduled_date,
      scheduled_time: row.scheduled_time,
      completed_at: row.completed_at,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return res.status(200).json({
      success: true,
      count: serviceRequests.length,
      service_requests: serviceRequests,
    });

  } catch (error) {
    console.error('✗ Error fetching service requests:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching service requests.',
    });
  }
});

/**
 * PATCH /api/admin/service-requests/:id
 * Update service request (protected route)
 */
router.patch('/service-requests/:id', authMiddleware, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { status, priority, assigned_to, scheduled_date, scheduled_time, notes } = req.body;

    const checkResult = await pool.query('SELECT * FROM service_requests WHERE id = $1', [requestId]);

    if (!checkResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      const validStatuses = ['open', 'in_progress', 'on_hold', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status',
        });
      }
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;

      if (status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }
    }

    if (priority) {
      updates.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex}`);
      params.push(assigned_to);
      paramIndex++;
    }

    if (scheduled_date) {
      updates.push(`scheduled_date = $${paramIndex}`);
      params.push(scheduled_date);
      paramIndex++;
    }

    if (scheduled_time) {
      updates.push(`scheduled_time = $${paramIndex}`);
      params.push(scheduled_time);
      paramIndex++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      params.push(notes);
      paramIndex++;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(requestId);

    await pool.query(
      `UPDATE service_requests SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    console.log(`✓ Service request #${requestId} updated`);

    return res.status(200).json({
      success: true,
      message: 'Service request updated successfully',
    });

  } catch (error) {
    console.error('✗ Error updating service request:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the service request.',
    });
  }
});

/**
 * GET /api/admin/products/:id/specifications
 * Get product specifications (protected route)
 */
router.get('/products/:id/specifications', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    const result = await pool.query(
      'SELECT * FROM product_specifications WHERE product_id = $1 ORDER BY display_order ASC',
      [productId]
    );

    const specifications = result.rows.map(row => ({
      id: row.id,
      product_id: row.product_id,
      spec_name: row.spec_name,
      spec_value: row.spec_value,
      display_order: row.display_order,
      created_at: row.created_at
    }));

    return res.status(200).json({
      success: true,
      count: specifications.length,
      specifications: specifications,
    });

  } catch (error) {
    console.error('✗ Error fetching product specifications:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching product specifications.',
    });
  }
});

/**
 * POST /api/admin/products/:id/specifications
 * Add product specification (protected route)
 */
router.post('/products/:id/specifications', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { spec_name, spec_value, display_order } = req.body;

    if (!spec_name || !spec_value) {
      return res.status(400).json({
        success: false,
        message: 'Specification name and value are required',
      });
    }

    // Verify product exists
    const productResult = await pool.query('SELECT id FROM products WHERE id = $1', [productId]);
    if (!productResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const result = await pool.query(
      'INSERT INTO product_specifications (product_id, spec_name, spec_value, display_order) VALUES ($1, $2, $3, $4) RETURNING id',
      [productId, spec_name, spec_value, display_order || 0]
    );

    const specId = result.rows[0].id;

    console.log(`✓ Product specification created: #${specId} for product #${productId}`);

    return res.status(201).json({
      success: true,
      message: 'Product specification created successfully',
      spec_id: specId,
    });

  } catch (error) {
    console.error('✗ Error creating product specification:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating product specification.',
    });
  }
});

/**
 * GET /api/admin/products/:id/variants
 * Get product variants (protected route)
 */
router.get('/products/:id/variants', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    const result = await pool.query(
      'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id ASC',
      [productId]
    );

    const variants = result.rows.map(row => ({
      id: row.id,
      product_id: row.product_id,
      variant_name: row.variant_name,
      variant_value: row.variant_value,
      price_adjustment: parseFloat(row.price_adjustment),
      stock: row.stock,
      created_at: row.created_at
    }));

    return res.status(200).json({
      success: true,
      count: variants.length,
      variants: variants,
    });

  } catch (error) {
    console.error('✗ Error fetching product variants:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching product variants.',
    });
  }
});

/**
 * POST /api/admin/products/:id/variants
 * Add product variant (protected route)
 */
router.post('/products/:id/variants', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { variant_name, variant_value, price_adjustment, stock } = req.body;

    if (!variant_name || !variant_value) {
      return res.status(400).json({
        success: false,
        message: 'Variant name and value are required',
      });
    }

    // Verify product exists
    const productResult = await pool.query('SELECT id FROM products WHERE id = $1', [productId]);
    if (!productResult.rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const result = await pool.query(
      'INSERT INTO product_variants (product_id, variant_name, variant_value, price_adjustment, stock) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [productId, variant_name, variant_value, price_adjustment || 0, stock || 0]
    );

    const variantId = result.rows[0].id;

    console.log(`✓ Product variant created: #${variantId} for product #${productId}`);

    return res.status(201).json({
      success: true,
      message: 'Product variant created successfully',
      variant_id: variantId,
    });

  } catch (error) {
    console.error('✗ Error creating product variant:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating product variant.',
    });
  }
});

/**
 * GET /api/admin/push-subscriptions
 * Get all push notification subscriptions
 */
router.get('/push-subscriptions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM push_subscriptions ORDER BY created_at DESC');

    const subscriptions = result.rows.map(row => ({
      id: row.id,
      session_id: row.session_id,
      endpoint: row.endpoint,
      keys: row.keys,
      created_at: row.created_at
    }));

    return res.status(200).json({
      success: true,
      count: subscriptions.length,
      subscriptions: subscriptions,
    });
  } catch (error) {
    console.error('✗ Error fetching push subscriptions:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching push subscriptions.',
    });
  }
});

module.exports = router;
