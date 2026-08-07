const express = require('express');
const router = express.Router();
const { getDb, saveDatabase } = require('../config/db');
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
    // Default to in_stock = 1 if not provided
    const inStockValue = in_stock !== undefined && in_stock !== null ? (in_stock ? 1 : 0) : 1;
    dbInstance.run(
      `INSERT INTO products (name, description, price, image_url, category, in_stock) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description || '', price, image_url || '', category || '', inStockValue]
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
    console.error('✗ Error fetching orders:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching orders.',
    });
  }
});

/**
 * POST /api/admin/orders/manual
 * Create a manual order with multiple products (protected route)
 */
router.post('/orders/manual', authMiddleware, (req, res) => {
  try {
    const { customer_name, customer_phone, customer_email, notes, order_source, products } = req.body;

    if (!customer_name || !customer_phone || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, and at least one product are required',
      });
    }

    const dbInstance = getDb();
    const orderIds = [];

    // Create one order record per product
    products.forEach((productItem, index) => {
      const { product_id, product_name, product_price, quantity } = productItem;

      // Verify product exists in database
      const productResult = dbInstance.exec('SELECT * FROM products WHERE id = ?', [product_id]);
      const dbProduct = productResult[0] && productResult[0].values[0] ? {
        id: productResult[0].values[0][0],
        name: productResult[0].values[0][1],
        price: productResult[0].values[0][3]
      } : null;

      // Use provided product details or fallback to database
      const finalProductName = product_name || (dbProduct ? dbProduct.name : 'Unknown Product');
      const finalProductPrice = product_price || (dbProduct ? dbProduct.price : 0);

      dbInstance.run(
        `INSERT INTO orders (customer_name, customer_phone, customer_email, product_id, product_name, product_price, quantity, notes, order_source, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_name,
          customer_phone,
          customer_email || null,
          product_id,
          finalProductName,
          finalProductPrice,
          quantity || 1,
          notes || null,
          order_source || 'manual',
          'Pending'
        ]
      );

      const result = dbInstance.exec('SELECT last_insert_rowid() as id');
      const orderId = result[0].values[0][0];
      orderIds.push(orderId);
    });

    saveDatabase();

    console.log(`✓ Manual order created: #${orderIds[0]} (${orderIds.length} items) - ${customer_name}`);

    // Send email notifications (non-blocking)
    if (customer_email) {
      sendOrderConfirmationEmail(customer_email, customer_name, {
        orderId: orderIds[0],
        date: new Date().toISOString(),
        status: 'Pending',
        products: products.map(p => ({
          name: p.product_name,
          price: p.product_price,
          quantity: p.quantity
        })),
        total: products.reduce((sum, p) => sum + (p.product_price * p.quantity), 0),
        customerName: customer_name,
        customerPhone: customer_phone,
        customerEmail: customer_email,
        notes: notes
      }).catch(err => console.error('Manual order confirmation email error:', err.message));
    }

    sendAdminNotificationEmail({
      orderId: orderIds[0],
      date: new Date().toISOString(),
      source: order_source || 'Manual',
      customerName: customer_name,
      customerPhone: customer_phone,
      customerEmail: customer_email,
      products: products.map(p => ({
        name: p.product_name,
        price: p.product_price,
        quantity: p.quantity
      })),
      total: products.reduce((sum, p) => sum + (p.product_price * p.quantity), 0),
      notes: notes
    }).catch(err => console.error('Manual order admin notification email error:', err.message));

    return res.status(201).json({
      success: true,
      message: `Manual order created successfully with ${orderIds.length} item(s)`,
      orderIds: orderIds,
      customer_name,
      customer_phone,
      customer_email,
      products_count: orderIds.length
    });

  } catch (error) {
    console.error('✗ Error creating manual order:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while creating the manual order.',
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
 * Upload image to R2 bucket or local storage (protected route)
 */
router.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const imageFile = req.file;
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const originalName = imageFile.originalname.replace(/\s+/g, '-');
    const extension = originalName.split('.').pop();
    const filename = `product_${timestamp}_${randomString}.${extension}`;

    let mediaUrl;

    // Try R2 first if configured
    if (r2Sync.isConfigured()) {
      mediaUrl = await r2Sync.uploadMediaToR2(imageFile.buffer, filename, imageFile.mimetype);
    }

    // Fallback to local storage if R2 fails or not configured
    if (!mediaUrl) {
      try {
        const fs = require('fs');
        const path = require('path');
        
        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
        console.log(`📁 Creating uploads directory: ${uploadsDir}`);
        
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
          console.log(`✓ Directory created`);
        }

        // Save file locally
        const filePath = path.join(uploadsDir, filename);
        console.log(`💾 Saving file to: ${filePath}`);
        fs.writeFileSync(filePath, imageFile.buffer);
        console.log(`✓ File saved successfully`);

        // Return local URL
        mediaUrl = `/uploads/products/${filename}`;
        console.log(`✓ Image saved locally: ${filename}`);
        console.log(`  URL: ${mediaUrl}`);
      } catch (localError) {
        console.error('✗ Local storage failed:', localError);
        mediaUrl = null;
      }
    } else {
      console.log(`✓ Image uploaded to R2: ${filename}`);
    }

    console.log(`  URL: ${mediaUrl}`);

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
 * GET /api/admin/analytics
 * Get advanced analytics (protected route)
 */
router.get('/analytics', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { period = '30' } = req.query; // days, default 30
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Total revenue
    const revenueResult = dbInstance.exec(`
      SELECT SUM(product_price * quantity) as total_revenue 
      FROM orders 
      WHERE status = 'Completed' AND created_at >= ?
    `, [startDate.toISOString()]);
    const totalRevenue = revenueResult[0] && revenueResult[0].values[0] ? revenueResult[0].values[0][0] || 0 : 0;

    // Total orders
    const ordersResult = dbInstance.exec(`
      SELECT COUNT(*) as count, 
             SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
             SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM orders 
      WHERE created_at >= ?
    `, [startDate.toISOString()]);
    const ordersStats = ordersResult[0] && ordersResult[0].values[0] ? {
      total: ordersResult[0].values[0][0] || 0,
      completed: ordersResult[0].values[0][1] || 0,
      pending: ordersResult[0].values[0][2] || 0,
      confirmed: ordersResult[0].values[0][3] || 0
    } : { total: 0, completed: 0, pending: 0, confirmed: 0 };

    // Top selling products
    const topProductsResult = dbInstance.exec(`
      SELECT product_id, product_name, SUM(quantity) as total_qty, SUM(product_price * quantity) as total_sales
      FROM orders
      WHERE created_at >= ?
      GROUP BY product_id
      ORDER BY total_qty DESC
      LIMIT 10
    `, [startDate.toISOString()]);
    const topProducts = topProductsResult[0] ? topProductsResult[0].values.map(row => ({
      product_id: row[0],
      product_name: row[1],
      total_quantity: row[2],
      total_sales: row[3]
    })) : [];

    // Daily sales for chart
    const dailySalesResult = dbInstance.exec(`
      SELECT DATE(created_at) as date, SUM(product_price * quantity) as daily_total
      FROM orders
      WHERE created_at >= ? AND status = 'Completed'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [startDate.toISOString()]);
    const dailySales = dailySalesResult[0] ? dailySalesResult[0].values.map(row => ({
      date: row[0],
      total: row[1] || 0
    })) : [];

    // Customer statistics
    const customerStatsResult = dbInstance.exec(`
      SELECT 
        COUNT(DISTINCT customer_phone) as unique_customers,
        COUNT(DISTINCT CASE WHEN customer_email != '' THEN customer_email END) as with_email,
        SUM(CASE WHEN customer_email != '' THEN 1 ELSE 0 END) as email_subscribers
      FROM orders
      WHERE created_at >= ?
    `, [startDate.toISOString()]);
    const customerStats = customerStatsResult[0] && customerStatsResult[0].values[0] ? {
      unique_customers: customerStatsResult[0].values[0][0] || 0,
      with_email: customerStatsResult[0].values[0][1] || 0,
      email_subscribers: customerStatsResult[0].values[0][2] || 0
    } : { unique_customers: 0, with_email: 0, email_subscribers: 0 };

    // Appointment statistics (gracefully handle missing table)
    let appointmentStats = { total: 0, confirmed: 0, pending: 0, completed: 0, cancelled: 0 };
    try {
      const appointmentStatsResult = dbInstance.exec(`
        SELECT 
          COUNT(*) as total_appointments,
          SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM appointments
        WHERE created_at >= ?
      `, [startDate.toISOString()]);
      if (appointmentStatsResult[0] && appointmentStatsResult[0].values[0]) {
        appointmentStats = {
          total: appointmentStatsResult[0].values[0][0] || 0,
          confirmed: appointmentStatsResult[0].values[0][1] || 0,
          pending: appointmentStatsResult[0].values[0][2] || 0,
          completed: appointmentStatsResult[0].values[0][3] || 0,
          cancelled: appointmentStatsResult[0].values[0][4] || 0
        };
      }
    } catch (e) {
      // appointments table doesn't exist yet
    }

    // Service request statistics (gracefully handle missing table)
    let serviceRequestStats = { total: 0, open: 0, in_progress: 0, completed: 0, urgent: 0 };
    try {
      const serviceRequestStatsResult = dbInstance.exec(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent
        FROM service_requests
        WHERE created_at >= ?
      `, [startDate.toISOString()]);
      if (serviceRequestStatsResult[0] && serviceRequestStatsResult[0].values[0]) {
        serviceRequestStats = {
          total: serviceRequestStatsResult[0].values[0][0] || 0,
          open: serviceRequestStatsResult[0].values[0][1] || 0,
          in_progress: serviceRequestStatsResult[0].values[0][2] || 0,
          completed: serviceRequestStatsResult[0].values[0][3] || 0,
          urgent: serviceRequestStatsResult[0].values[0][4] || 0
        };
      }
    } catch (e) {
      // service_requests table doesn't exist yet
    }

    // Loyalty program statistics
    const loyaltyStatsResult = dbInstance.exec(`
      SELECT 
        COUNT(*) as total_members,
        SUM(points) as total_points_issued,
        SUM(total_spent) as total_loyalty_spent,
        SUM(total_orders) as total_loyalty_orders,
        AVG(points) as avg_points_per_member
      FROM loyalty_program
    `);
    const loyaltyStats = loyaltyStatsResult[0] && loyaltyStatsResult[0].values[0] ? {
      total_members: loyaltyStatsResult[0].values[0][0] || 0,
      total_points_issued: loyaltyStatsResult[0].values[0][1] || 0,
      total_loyalty_spent: loyaltyStatsResult[0].values[0][2] || 0,
      total_loyalty_orders: loyaltyStatsResult[0].values[0][3] || 0,
      avg_points_per_member: loyaltyStatsResult[0].values[0][4] || 0
    } : { total_members: 0, total_points_issued: 0, total_loyalty_spent: 0, total_loyalty_orders: 0, avg_points_per_member: 0 };

    // Newsletter statistics (gracefully handle missing table)
    let newsletterStats = { total_subscribers: 0, active_subscribers: 0 };
    try {
      const newsletterStatsResult = dbInstance.exec(`
        SELECT 
          COUNT(*) as total_subscribers,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_subscribers
        FROM newsletter_subscribers
      `);
      if (newsletterStatsResult[0] && newsletterStatsResult[0].values[0]) {
        newsletterStats = {
          total_subscribers: newsletterStatsResult[0].values[0][0] || 0,
          active_subscribers: newsletterStatsResult[0].values[0][1] || 0
        };
      }
    } catch (e) {
      // newsletter_subscribers table doesn't exist yet
    }

    // Lead statistics
    const leadStatsResult = dbInstance.exec(`
      SELECT 
        COUNT(*) as total_leads,
        SUM(CASE WHEN urgency = 'Emergency' THEN 1 ELSE 0 END) as emergency_leads,
        SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN status = 'Contacted' THEN 1 ELSE 0 END) as contacted_leads
      FROM leads
      WHERE created_at >= ?
    `, [startDate.toISOString()]);
    const leadStats = leadStatsResult[0] && leadStatsResult[0].values[0] ? {
      total: leadStatsResult[0].values[0][0] || 0,
      emergency: leadStatsResult[0].values[0][1] || 0,
      new: leadStatsResult[0].values[0][2] || 0,
      contacted: leadStatsResult[0].values[0][3] || 0
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
router.get('/customers', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { search = '' } = req.query;

    let query = `
      SELECT 
        customer_name,
        customer_phone,
        customer_email,
        COUNT(*) as order_count,
        SUM(product_price * quantity) as total_spent,
        MAX(created_at) as last_order_date,
        MIN(created_at) as first_order_date
      FROM orders
    `;
    const params = [];

    if (search) {
      query += ` WHERE customer_name LIKE ? OR customer_phone LIKE ? OR customer_email LIKE ?`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` GROUP BY customer_phone ORDER BY last_order_date DESC`;

    const result = dbInstance.exec(query, params);
    const customers = result[0] ? result[0].values.map(row => ({
      customer_name: row[0],
      customer_phone: row[1],
      customer_email: row[2],
      order_count: row[3],
      total_spent: row[4] || 0,
      last_order_date: row[5],
      first_order_date: row[6]
    })) : [];

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
router.get('/inventory', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { low_stock = 'false' } = req.query;

    let query = 'SELECT * FROM products';
    if (low_stock === 'true') {
      query += ' WHERE in_stock = 0';
    }
    query += ' ORDER BY created_at DESC';

    const result = dbInstance.exec(query);
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

    // Get order counts for each product
    const productsWithStats = products.map(product => {
      const orderStats = dbInstance.exec(`
        SELECT COUNT(*) as order_count, SUM(quantity) as total_ordered
        FROM orders
        WHERE product_id = ?
      `, [product.id]);
      
      const stats = orderStats[0] && orderStats[0].values[0] ? {
        order_count: orderStats[0].values[0][0] || 0,
        total_ordered: orderStats[0].values[0][1] || 0
      } : { order_count: 0, total_ordered: 0 };

      return {
        ...product,
        ...stats
      };
    });

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
 * PATCH /api/admin/orders/bulk-status
 * Update multiple orders status at once (protected route)
 */
router.patch('/orders/bulk-status', authMiddleware, (req, res) => {
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

    const dbInstance = getDb();
    const placeholders = order_ids.map(() => '?').join(',');
    dbInstance.run(
      `UPDATE orders SET status = ? WHERE id IN (${placeholders})`,
      [status, ...order_ids]
    );
    saveDatabase();

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
    const { phone, email, location, whatsapp } = req.body;
    const dbInstance = getDb();
    const existingCount = dbInstance.exec('SELECT COUNT(*) as count FROM settings')[0];
    if (existingCount && existingCount.values[0][0] === 0) {
      const defaults = [
        ['phone', phone || process.env.COMPANY_PHONE || '(555) 123-4567'],
        ['email', email || process.env.COMPANY_EMAIL || 'info@minnahelectricals.com'],
        ['location', location || process.env.COMPANY_LOCATION || 'Serving the Local Area'],
        ['whatsapp', whatsapp || ''],
      ];
      defaults.forEach(([key, value]) => {
        dbInstance.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
      });
    } else {
      if (phone !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['phone', phone]);
      if (email !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['email', email]);
      if (location !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['location', location]);
      if (whatsapp !== undefined) dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['whatsapp', whatsapp]);
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

/**
 * GET /api/admin/templates
 * Get all communication templates
 */
router.get('/templates', authMiddleware, (req, res) => {
  try {
    const { type } = req.query;
    let query = 'SELECT * FROM templates';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY name, created_at DESC';

    const dbInstance = getDb();
    const result = dbInstance.exec(query, params);

    const templates = result[0] ? result[0].values.map(row => ({
      id: row[0],
      name: row[1],
      type: row[2],
      subject: row[3],
      content: row[4],
      created_at: row[5],
      updated_at: row[6]
    })) : [];

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
router.post('/templates', authMiddleware, (req, res) => {
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

    const dbInstance = getDb();
    dbInstance.run(
      'INSERT INTO templates (name, type, subject, content) VALUES (?, ?, ?, ?)',
      [name, type, subject || null, content]
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const templateId = result[0].values[0][0];
    saveDatabase();

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
router.put('/templates/:id', authMiddleware, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const { name, type, subject, content } = req.body;

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT id FROM templates WHERE id = ?', [templateId]);

    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    dbInstance.run(
      'UPDATE templates SET name = ?, type = ?, subject = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, type, subject || null, content, templateId]
    );
    saveDatabase();

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
router.delete('/templates/:id', authMiddleware, (req, res) => {
  try {
    const templateId = parseInt(req.params.id);

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT id FROM templates WHERE id = ?', [templateId]);

    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    dbInstance.run('DELETE FROM templates WHERE id = ?', [templateId]);
    saveDatabase();

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
router.get('/sms-logs', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT 100');

    const logs = result[0] ? result[0].values.map(row => ({
      id: row[0],
      phone: row[1],
      message: row[2],
      status: row[3],
      error_message: row[4],
      created_at: row[5]
    })) : [];

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
 * GET /api/admin/appointments
 * Get all appointments (protected route)
 */
router.get('/appointments', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { status, date_from, date_to } = req.query;

    let query = 'SELECT * FROM appointments';
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    if (date_from) {
      conditions.push('appointment_date >= ?');
      params.push(date_from);
    }

    if (date_to) {
      conditions.push('appointment_date <= ?');
      params.push(date_to);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY appointment_date DESC, appointment_time DESC';

    const result = dbInstance.exec(query, params);
    const appointments = result[0] ? result[0].values.map(row => ({
      id: row[0],
      customer_name: row[1],
      customer_phone: row[2],
      customer_email: row[3],
      service_type: row[4],
      appointment_date: row[5],
      appointment_time: row[6],
      status: row[7],
      notes: row[8],
      created_at: row[9],
      updated_at: row[10]
    })) : [];

    return res.status(200).json({
      success: true,
      count: appointments.length,
      appointments: appointments,
    });

  } catch (error) {
    console.error('✗ Error fetching appointments:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching appointments.',
    });
  }
});

/**
 * PATCH /api/admin/appointments/:id
 * Update appointment status (protected route)
 */
router.patch('/appointments/:id', authMiddleware, (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const { status, notes, assigned_to } = req.body;

    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
    }

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM appointments WHERE id = ?', [appointmentId]);

    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    const updates = [];
    const params = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (assigned_to !== undefined) {
      updates.push('assigned_to = ?');
      params.push(assigned_to);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(appointmentId);

    dbInstance.run(
      `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    saveDatabase();

    console.log(`✓ Appointment #${appointmentId} updated`);

    return res.status(200).json({
      success: true,
      message: 'Appointment updated successfully',
    });

  } catch (error) {
    console.error('✗ Error updating appointment:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the appointment.',
    });
  }
});

/**
 * DELETE /api/admin/appointments/:id
 * Delete an appointment (protected route)
 */
router.delete('/appointments/:id', authMiddleware, (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id);

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM appointments WHERE id = ?', [appointmentId]);

    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    dbInstance.run('DELETE FROM appointments WHERE id = ?', [appointmentId]);
    saveDatabase();

    console.log(`✓ Appointment #${appointmentId} deleted`);

    return res.status(200).json({
      success: true,
      message: 'Appointment deleted successfully',
    });

  } catch (error) {
    console.error('✗ Error deleting appointment:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the appointment.',
    });
  }
});

/**
 * GET /api/admin/newsletter/subscribers
 * Get all newsletter subscribers (protected route)
 */
router.get('/newsletter/subscribers', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { status = 'active' } = req.query;

    let query = 'SELECT * FROM newsletter_subscribers';
    const params = [];

    if (status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY subscribed_at DESC';

    const result = dbInstance.exec(query, params);
    const subscribers = result[0] ? result[0].values.map(row => ({
      id: row[0],
      email: row[1],
      name: row[2],
      status: row[3],
      subscribed_at: row[4],
      unsubscribed_at: row[5]
    })) : [];

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
router.get('/newsletter/campaigns', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC');

    const campaigns = result[0] ? result[0].values.map(row => ({
      id: row[0],
      subject: row[1],
      content: row[2],
      recipient_filter: row[3],
      sent_count: row[4],
      opened_count: row[5],
      clicked_count: row[6],
      status: row[7],
      sent_at: row[8],
      created_at: row[9]
    })) : [];

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
router.post('/newsletter/campaigns', authMiddleware, (req, res) => {
  try {
    const { subject, content, recipient_filter } = req.body;

    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: 'Subject and content are required',
      });
    }

    const dbInstance = getDb();
    dbInstance.run(
      'INSERT INTO newsletter_campaigns (subject, content, recipient_filter, status) VALUES (?, ?, ?, ?)',
      [subject, content, recipient_filter || 'all', 'draft']
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const campaignId = result[0].values[0][0];
    saveDatabase();

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
    const dbInstance = getDb();

    // Get campaign details
    const campaignResult = dbInstance.exec('SELECT * FROM newsletter_campaigns WHERE id = ?', [campaignId]);

    if (!campaignResult[0] || !campaignResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    const campaign = {
      id: campaignResult[0].values[0][0],
      subject: campaignResult[0].values[0][1],
      content: campaignResult[0].values[0][2],
      recipient_filter: campaignResult[0].values[0][3],
      status: campaignResult[0].values[0][7]
    };

    if (campaign.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Campaign has already been sent',
      });
    }

    // Get subscribers based on filter
    let subscriberQuery = 'SELECT email, name FROM newsletter_subscribers WHERE status = ?';
    const subscriberParams = ['active'];

    if (campaign.recipient_filter !== 'all') {
      // Add more filters as needed
    }

    const subscriberResult = dbInstance.exec(subscriberQuery, subscriberParams);
    const subscribers = subscriberResult[0] ? subscriberResult[0].values : [];

    if (subscribers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active subscribers found',
      });
    }

    // Update campaign status to sending
    dbInstance.run(
      'UPDATE newsletter_campaigns SET status = ? WHERE id = ?',
      ['sending', campaignId]
    );

    // Send emails (non-blocking)
    let sentCount = 0;
    let failedCount = 0;

    for (const subscriber of subscribers) {
      try {
        const [email, name] = subscriber;
        
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
        console.error(`✗ Failed to send to ${subscriber[0]}:`, error.message);
        failedCount++;
      }
    }

    // Update campaign with results
    dbInstance.run(
      `UPDATE newsletter_campaigns 
       SET status = ?, sent_count = ?, sent_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      ['sent', sentCount, campaignId]
    );

    saveDatabase();

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
router.get('/loyalty/members', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { tier, search = '' } = req.query;

    let query = 'SELECT * FROM loyalty_program';
    const params = [];

    if (tier && tier !== 'all') {
      query += ' WHERE tier = ?';
      params.push(tier);
    } else if (search) {
      query += ' WHERE customer_name LIKE ? OR customer_phone LIKE ? OR customer_email LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY points DESC, total_spent DESC';

    const result = dbInstance.exec(query, params);
    const members = result[0] ? result[0].values.map(row => ({
      id: row[0],
      customer_phone: row[1],
      customer_name: row[2],
      customer_email: row[3],
      points: row[4],
      tier: row[5],
      total_spent: row[6],
      total_orders: row[7],
      created_at: row[8],
      updated_at: row[9]
    })) : [];

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
router.post('/loyalty/members', authMiddleware, (req, res) => {
  try {
    const { customer_phone, customer_name, customer_email, points, tier } = req.body;

    if (!customer_phone || !customer_name) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone and name are required',
      });
    }

    const dbInstance = getDb();
    
    // Check if member exists
    const existingResult = dbInstance.exec('SELECT id FROM loyalty_program WHERE customer_phone = ?', [customer_phone]);

    if (existingResult[0] && existingResult[0].values[0]) {
      // Update existing member
      const updates = [];
      const params = [];

      if (customer_email !== undefined) {
        updates.push('customer_email = ?');
        params.push(customer_email);
      }

      if (points !== undefined) {
        updates.push('points = ?');
        params.push(points);
      }

      if (tier) {
        updates.push('tier = ?');
        params.push(tier);
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(customer_phone);

      dbInstance.run(
        `UPDATE loyalty_program SET ${updates.join(', ')} WHERE customer_phone = ?`,
        params
      );
    } else {
      // Create new member
      dbInstance.run(
        `INSERT INTO loyalty_program (customer_phone, customer_name, customer_email, points, tier) VALUES (?, ?, ?, ?, ?)`,
        [customer_phone, customer_name, customer_email || null, points || 0, tier || 'bronze']
      );
    }

    saveDatabase();

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
router.post('/loyalty/transactions', authMiddleware, (req, res) => {
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

    const dbInstance = getDb();

    // Verify customer exists in loyalty program
    const memberResult = dbInstance.exec('SELECT id, points FROM loyalty_program WHERE customer_phone = ?', [customer_phone]);

    if (!memberResult[0] || !memberResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found in loyalty program',
      });
    }

    const memberId = memberResult[0].values[0][0];
    const currentPoints = memberResult[0].values[0][1];

    // Calculate new points
    let newPoints = currentPoints;
    if (transaction_type === 'earned' || transaction_type === 'bonus') {
      newPoints = currentPoints + points;
    } else if (transaction_type === 'redeemed' || transaction_type === 'expired') {
      newPoints = Math.max(0, currentPoints - points);
    }

    // Update member points
    dbInstance.run(
      'UPDATE loyalty_program SET points = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_phone = ?',
      [newPoints, customer_phone]
    );

    // Record transaction
    dbInstance.run(
      `INSERT INTO loyalty_transactions (customer_phone, points, transaction_type, description, order_id) 
       VALUES (?, ?, ?, ?, ?)`,
      [customer_phone, points, transaction_type, description || null, order_id || null]
    );

    saveDatabase();

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
router.get('/service-requests', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const { status, priority, assigned_to } = req.query;

    let query = 'SELECT * FROM service_requests';
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    if (priority && priority !== 'all') {
      conditions.push('priority = ?');
      params.push(priority);
    }

    if (assigned_to) {
      conditions.push('assigned_to = ?');
      params.push(assigned_to);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
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
router.patch('/service-requests/:id', authMiddleware, (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { status, priority, assigned_to, scheduled_date, scheduled_time, notes } = req.body;

    const dbInstance = getDb();
    const checkResult = dbInstance.exec('SELECT * FROM service_requests WHERE id = ?', [requestId]);

    if (!checkResult[0] || !checkResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found',
      });
    }

    const updates = [];
    const params = [];

    if (status) {
      const validStatuses = ['open', 'in_progress', 'on_hold', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status',
        });
      }
      updates.push('status = ?');
      params.push(status);

      if (status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }
    }

    if (priority) {
      updates.push('priority = ?');
      params.push(priority);
    }

    if (assigned_to !== undefined) {
      updates.push('assigned_to = ?');
      params.push(assigned_to);
    }

    if (scheduled_date) {
      updates.push('scheduled_date = ?');
      params.push(scheduled_date);
    }

    if (scheduled_time) {
      updates.push('scheduled_time = ?');
      params.push(scheduled_time);
    }

    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(requestId);

    dbInstance.run(
      `UPDATE service_requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    saveDatabase();

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
router.get('/products/:id/specifications', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const dbInstance = getDb();

    const result = dbInstance.exec(
      'SELECT * FROM product_specifications WHERE product_id = ? ORDER BY display_order ASC',
      [productId]
    );

    const specifications = result[0] ? result[0].values.map(row => ({
      id: row[0],
      product_id: row[1],
      spec_name: row[2],
      spec_value: row[3],
      display_order: row[4],
      created_at: row[5]
    })) : [];

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
router.post('/products/:id/specifications', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { spec_name, spec_value, display_order } = req.body;

    if (!spec_name || !spec_value) {
      return res.status(400).json({
        success: false,
        message: 'Specification name and value are required',
      });
    }

    const dbInstance = getDb();

    // Verify product exists
    const productResult = dbInstance.exec('SELECT id FROM products WHERE id = ?', [productId]);
    if (!productResult[0] || !productResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    dbInstance.run(
      'INSERT INTO product_specifications (product_id, spec_name, spec_value, display_order) VALUES (?, ?, ?, ?)',
      [productId, spec_name, spec_value, display_order || 0]
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const specId = result[0].values[0][0];
    saveDatabase();

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
router.get('/products/:id/variants', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const dbInstance = getDb();

    const result = dbInstance.exec(
      'SELECT * FROM product_variants WHERE product_id = ? ORDER BY id ASC',
      [productId]
    );

    const variants = result[0] ? result[0].values.map(row => ({
      id: row[0],
      product_id: row[1],
      variant_name: row[2],
      variant_value: row[3],
      price_adjustment: row[4],
      stock: row[5],
      created_at: row[6]
    })) : [];

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
router.post('/products/:id/variants', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { variant_name, variant_value, price_adjustment, stock } = req.body;

    if (!variant_name || !variant_value) {
      return res.status(400).json({
        success: false,
        message: 'Variant name and value are required',
      });
    }

    const dbInstance = getDb();

    // Verify product exists
    const productResult = dbInstance.exec('SELECT id FROM products WHERE id = ?', [productId]);
    if (!productResult[0] || !productResult[0].values[0]) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    dbInstance.run(
      'INSERT INTO product_variants (product_id, variant_name, variant_value, price_adjustment, stock) VALUES (?, ?, ?, ?, ?)',
      [productId, variant_name, variant_value, price_adjustment || 0, stock || 0]
    );

    const result = dbInstance.exec('SELECT last_insert_rowid() as id');
    const variantId = result[0].values[0][0];
    saveDatabase();

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
router.get('/push-subscriptions', authMiddleware, (req, res) => {
  try {
    const dbInstance = getDb();
    const result = dbInstance.exec('SELECT * FROM push_subscriptions ORDER BY created_at DESC');

    const subscriptions = result[0] ? result[0].values.map(row => ({
      id: row[0],
      session_id: row[1],
      endpoint: row[2],
      keys: row[3],
      created_at: row[4]
    })) : [];

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
