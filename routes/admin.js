const express = require('express');
const router = express.Router();
const { getDb, saveDatabase } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const r2Sync = require('../config/r2-sync');
const { authMiddleware } = require('../middleware/auth');
require('dotenv').config();

/**
 * POST /api/admin/login
 * Authenticate admin user and return JWT token
 */
router.post('/login', (req, res) => {
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
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM users WHERE username = ?', [username]);
    const user = result[0] && result[0].values[0] ? {
      id: result[0].values[0][0],
      username: result[0].values[0][1],
      password_hash: result[0].values[0][2],
      created_at: result[0].values[0][3]
    } : null;

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
 * GET /api/admin/leads
 * Get all leads (protected route)
 */
router.get('/leads', authMiddleware, (req, res) => {
  try {
    const { status, urgency } = req.query;
    
    let query = 'SELECT * FROM leads';
    const conditions = [];
    const params = [];

    // Filter by status if provided
    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    // Filter by urgency if provided
    if (urgency && urgency !== 'all') {
      conditions.push('urgency = ?');
      params.push(urgency);
    }

    // Add WHERE clause if conditions exist
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Order by most recent first
    query += ' ORDER BY created_at DESC';

    const dbInstance = getDb();
    const result = dbInstance.exec(query, params);
    const leads = result[0] ? result[0].values.map(row => ({
      id: row[0],
      full_name: row[1],
      phone: row[2],
      email: row[3],
      service_needed: row[4],
      urgency: row[5],
      message: row[6],
      status: row[7],
      created_at: row[8]
    })) : [];

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
router.patch('/leads/:id', authMiddleware, (req, res) => {
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
    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM leads WHERE id = ?', [leadId]);
    const existingLead = checkResult[0] && checkResult[0].values[0] ? {
      id: checkResult[0].values[0][0],
      full_name: checkResult[0].values[0][1],
      phone: checkResult[0].values[0][2],
      email: checkResult[0].values[0][3],
      service_needed: checkResult[0].values[0][4],
      urgency: checkResult[0].values[0][5],
      message: checkResult[0].values[0][6],
      status: checkResult[0].values[0][7],
      created_at: checkResult[0].values[0][8]
    } : null;

    if (!existingLead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found',
      });
    }

    // Update lead status
    dbInstance.run('UPDATE leads SET status = ? WHERE id = ?', [status, leadId]);
    saveDatabase();

    // Trigger R2 sync (non-blocking)
    r2Sync.sync().catch(err => {
      console.error('R2 sync error:', err.message);
    });

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
router.delete('/leads/:id', authMiddleware, (req, res) => {
  try {
    const leadId = parseInt(req.params.id);

    // Check if lead exists
    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM leads WHERE id = ?', [leadId]);
    const existingLead = checkResult[0] && checkResult[0].values[0] ? {
      id: checkResult[0].values[0][0],
      full_name: checkResult[0].values[0][1],
      phone: checkResult[0].values[0][2],
      email: checkResult[0].values[0][3],
      service_needed: checkResult[0].values[0][4],
      urgency: checkResult[0].values[0][5],
      message: checkResult[0].values[0][6],
      status: checkResult[0].values[0][7],
      created_at: checkResult[0].values[0][8]
    } : null;

    if (!existingLead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found',
      });
    }

    // Delete lead
    dbInstance.run('DELETE FROM leads WHERE id = ?', [leadId]);
    saveDatabase();

    // Trigger R2 sync (non-blocking)
    r2Sync.sync().catch(err => {
      console.error('R2 sync error:', err.message);
    });

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
router.get('/stats', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    
    // Total leads
    const totalResult = dbInstance.exec('SELECT COUNT(*) as count FROM leads');
    const totalLeads = totalResult[0] && totalResult[0].values[0] ? totalResult[0].values[0][0] : 0;

    // Leads by status
    const statusResult = dbInstance.exec(`
      SELECT status, COUNT(*) as count 
      FROM leads 
      GROUP BY status
    `);
    const leadsByStatus = statusResult[0] ? statusResult[0].values.map(row => ({
      status: row[0],
      count: row[1]
    })) : [];

    // Recent leads (last 7 days)
    const recentResult = dbInstance.exec(`
      SELECT COUNT(*) as count 
      FROM leads 
      WHERE created_at >= datetime('now', '-7 days')
    `);
    const recentLeads = recentResult[0] && recentResult[0].values[0] ? recentResult[0].values[0][0] : 0;

    // Emergency leads
    const emergencyResult = dbInstance.exec(`
      SELECT COUNT(*) as count 
      FROM leads 
      WHERE urgency = 'Emergency' AND status = 'New'
    `);
    const emergencyLeads = emergencyResult[0] && emergencyResult[0].values[0] ? emergencyResult[0].values[0][0] : 0;

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
 * GET /api/admin/products
 * Get all products (protected route)
 */
router.get('/products', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM products ORDER BY created_at DESC');
    
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
 * POST /api/admin/products
 * Create a new product (protected route)
 */
router.post('/products', authMiddleware, (req, res) => {
  try {
    const { name, description, price, image_url, category, in_stock } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Product name and price are required',
      });
    }

    const dbInstance = getDb();
    dbInstance.run(
      `INSERT INTO products (name, description, price, image_url, category, in_stock) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description || '', price, image_url || '', category || '', in_stock ? 1 : 0]
    );
    
    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const productId = result[0].values[0][0];
    saveDatabase();

    console.log(`✓ Product created: #${productId} - ${name}`);

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: { id: productId, name, description, price, image_url, category, in_stock }
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
router.put('/products/:id', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { name, description, price, image_url, category, in_stock } = req.body;

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM products WHERE id = ?', [productId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    dbInstance.run(
      `UPDATE products SET name = ?, description = ?, price = ?, image_url = ?, category = ?, in_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name, description || '', price, image_url || '', category || '', in_stock ? 1 : 0, productId]
    );
    saveDatabase();

    console.log(`✓ Product updated: #${productId}`);

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
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
router.delete('/products/:id', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM products WHERE id = ?', [productId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    dbInstance.run('DELETE FROM products WHERE id = ?', [productId]);
    saveDatabase();

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
 * GET /api/admin/orders
 * Get all orders (protected route)
 */
router.get('/orders', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec(`
      SELECT o.*, p.name as product_name, p.price as product_price 
      FROM orders o 
      LEFT JOIN products p ON o.product_id = p.id 
      ORDER BY o.created_at DESC
    `);
    
    const orders = result[0] ? result[0].values.map(row => ({
      id: row[0],
      customer_name: row[1],
      customer_phone: row[2],
      customer_email: row[3],
      product_id: row[4],
      quantity: row[5],
      notes: row[6],
      status: row[7],
      created_at: row[8],
      product_name: row[9],
      product_price: row[10]
    })) : [];

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
router.patch('/orders/:id', authMiddleware, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;

    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM orders WHERE id = ?', [orderId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    dbInstance.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    saveDatabase();

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
 * POST /api/admin/upload
 * Upload image to R2 bucket (protected route)
 */
router.post('/upload', authMiddleware, async (req, res) => {
  try {
    if (!req.files || !req.files.image) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const imageFile = req.files.image;
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(imageFile.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPG, PNG, GIF, and WebP are allowed.',
      });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (imageFile.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 5MB.',
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const originalName = imageFile.name.replace(/\s+/g, '-');
    const extension = originalName.split('.').pop();
    const filename = `product_${timestamp}_${randomString}.${extension}`;

    // Upload to R2
    const mediaUrl = await r2Sync.uploadMediaToR2(imageFile.data, filename, imageFile.mimetype);

    if (!mediaUrl) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload image to cloud storage',
      });
    }

    console.log(`✓ Image uploaded to R2: ${filename}`);

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      url: mediaUrl,
      filename: filename,
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
 * GET /api/admin/portfolio
 * Get all portfolio items (protected route)
 */
router.get('/portfolio', authMiddleware, (req, res) => {
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
 * POST /api/admin/portfolio
 * Create a new portfolio item (protected route)
 */
router.post('/portfolio', authMiddleware, async (req, res) => {
  try {
    const { title, description, image_url, category, client_name, project_date, featured, display_order } = req.body;

    if (!title || !image_url) {
      return res.status(400).json({
        success: false,
        message: 'Portfolio title and image are required',
      });
    }

    const dbInstance = getDb();
    dbInstance.run(
      `INSERT INTO portfolio (title, description, image_url, category, client_name, project_date, featured, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || '', image_url, category || '', client_name || '', project_date || '', featured ? 1 : 0, display_order || 0]
    );
    
    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const portfolioId = result[0].values[0][0];
    saveDatabase();

    console.log(`✓ Portfolio item created: #${portfolioId} - ${title}`);

    return res.status(201).json({
      success: true,
      message: 'Portfolio item created successfully',
      portfolio: { id: portfolioId, title, description, image_url, category, client_name, project_date, featured, display_order }
    });

  } catch (error) {
    console.error('✗ Error creating portfolio item:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the portfolio item.',
    });
  }
});

/**
 * PUT /api/admin/portfolio/:id
 * Update a portfolio item (protected route)
 */
router.put('/portfolio/:id', authMiddleware, (req, res) => {
  try {
    const portfolioId = parseInt(req.params.id);
    const { title, description, image_url, category, client_name, project_date, featured, display_order } = req.body;

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM portfolio WHERE id = ?', [portfolioId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found',
      });
    }

    dbInstance.run(
      `UPDATE portfolio SET title = ?, description = ?, image_url = ?, category = ?, client_name = ?, project_date = ?, featured = ?, display_order = ? WHERE id = ?`,
      [title, description || '', image_url, category || '', client_name || '', project_date || '', featured ? 1 : 0, display_order || 0, portfolioId]
    );
    saveDatabase();

    console.log(`✓ Portfolio item updated: #${portfolioId}`);

    return res.status(200).json({
      success: true,
      message: 'Portfolio item updated successfully',
    });

  } catch (error) {
    console.error('✗ Error updating portfolio item:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the portfolio item.',
    });
  }
});

/**
 * DELETE /api/admin/portfolio/:id
 * Delete a portfolio item (protected route)
 */
router.delete('/portfolio/:id', authMiddleware, (req, res) => {
  try {
    const portfolioId = parseInt(req.params.id);

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM portfolio WHERE id = ?', [portfolioId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found',
      });
    }

    dbInstance.run('DELETE FROM portfolio WHERE id = ?', [portfolioId]);
    saveDatabase();

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
router.get('/gallery', authMiddleware, (req, res) => {
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

    const dbInstance = getDb();
    dbInstance.run(
      `INSERT INTO gallery (title, image_url, category, description, display_order) VALUES (?, ?, ?, ?, ?)`,
      [title || '', image_url, category || '', description || '', display_order || 0]
    );
    
    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const galleryId = result[0].values[0][0];
    saveDatabase();

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
router.put('/gallery/:id', authMiddleware, (req, res) => {
  try {
    const galleryId = parseInt(req.params.id);
    const { title, image_url, category, description, display_order } = req.body;

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM gallery WHERE id = ?', [galleryId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found',
      });
    }

    dbInstance.run(
      `UPDATE gallery SET title = ?, image_url = ?, category = ?, description = ?, display_order = ? WHERE id = ?`,
      [title || '', image_url, category || '', description || '', display_order || 0, galleryId]
    );
    saveDatabase();

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
router.delete('/gallery/:id', authMiddleware, (req, res) => {
  try {
    const galleryId = parseInt(req.params.id);

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM gallery WHERE id = ?', [galleryId]);
    
    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found',
      });
    }

    dbInstance.run('DELETE FROM gallery WHERE id = ?', [galleryId]);
    saveDatabase();

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
 * GET /api/admin/settings
 * Get all settings (protected route)
 */
router.get('/settings', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT key, value FROM settings');
    const settings = {};
    if (result[0]) {
      result[0].values.forEach(row => {
        settings[row[0]] = row[1];
      });
    }
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
router.put('/settings', authMiddleware, (req, res) => {
  try {
    const { phone, email, location } = req.body;
    const dbInstance = getDb();
    const existingCount = dbInstance.exec('SELECT COUNT(*) as count FROM settings')[0];
    if (existingCount && existingCount.values[0][0] === 0) {
      const defaults = [
        ['phone', phone || process.env.COMPANY_PHONE || '(555) 123-4567'],
        ['email', email || process.env.COMPANY_EMAIL || 'info@minnahelectricals.com'],
        ['location', location || process.env.COMPANY_LOCATION || 'Serving the Local Area'],
      ];
      defaults.forEach(([key, value]) => {
        dbInstance.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
      });
    } else {
      if (phone !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['phone', phone]);
      if (email !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['email', email]);
      if (location !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['location', location]);
    }
    saveDatabase();
    r2Sync.sync().catch(err => console.error('R2 sync error:', err.message));
    console.log('Settings updated');
    return res.status(200).json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error updating settings:', error);
    return res.status(500).json({ success: false, message: 'An error occurred while updating settings.' });
  }
});
module.exports = router;
