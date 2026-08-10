const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// PostgreSQL connection pool for serverless environments
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  // Limit connections for serverless (Vercel)
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection on initialization
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

// Initialize database tables
async function initDB() {
  try {
    // Create tables with PostgreSQL syntax
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        service_needed TEXT NOT NULL,
        urgency VARCHAR(50) DEFAULT 'Standard',
        message TEXT,
        status VARCHAR(50) DEFAULT 'New',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        image_url TEXT,
        category VARCHAR(255),
        in_stock BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, display_order)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        customer_email VARCHAR(255),
        product_id INTEGER NOT NULL,
        product_name VARCHAR(255),
        product_price DECIMAL(10, 2),
        quantity INTEGER DEFAULT 1,
        notes TEXT,
        order_source VARCHAR(50) DEFAULT 'website',
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        image_url TEXT NOT NULL,
        category VARCHAR(255),
        client_name VARCHAR(255),
        project_date VARCHAR(50),
        featured BOOLEAN DEFAULT false,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gallery (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255),
        image_url TEXT NOT NULL,
        category VARCHAR(255),
        description TEXT,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review_text TEXT,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE(product_id, session_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_info (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        customer_email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('email', 'sms', 'whatsapp')),
        subject VARCHAR(255),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        endpoint TEXT NOT NULL,
        keys JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, endpoint)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sms_logs (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(50) NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loyalty_program (
        id SERIAL PRIMARY KEY,
        customer_phone VARCHAR(50) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        points INTEGER DEFAULT 0,
        tier VARCHAR(50) DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
        total_spent DECIMAL(10, 2) DEFAULT 0,
        total_orders INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id SERIAL PRIMARY KEY,
        customer_phone VARCHAR(50) NOT NULL,
        points INTEGER NOT NULL,
        transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('earned', 'redeemed', 'bonus', 'expired')),
        description TEXT,
        order_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_specifications (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        spec_name VARCHAR(255) NOT NULL,
        spec_value TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        variant_name VARCHAR(255) NOT NULL,
        variant_value VARCHAR(255) NOT NULL,
        price_adjustment DECIMAL(10, 2) DEFAULT 0,
        stock INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portfolio_category ON portfolio(category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portfolio_featured ON portfolio(featured)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gallery_category ON gallery(category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_program_phone ON loyalty_program(customer_phone)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_customer ON loyalty_transactions(customer_phone)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_specs_product ON product_specifications(product_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id)`);

    // Migrate existing single images from products table to product_images table
    await pool.query(`
      INSERT INTO product_images (product_id, image_url, display_order)
      SELECT id, image_url, 0
      FROM products
      WHERE image_url IS NOT NULL AND image_url != ''
      ON CONFLICT DO NOTHING
    `);

    console.log('✓ Database tables initialized');

    // Seed default admin user if none exists
    const userResult = await pool.query('SELECT COUNT(*) FROM users');
    if (userResult.rows[0].count === '0') {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'AdminPass123!';
      const passwordHash = await bcrypt.hash(password, 10);
      
      await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        [username, passwordHash]
      );
      
      console.log('✓ Default admin user created:');
      console.log(`  Username: ${username}`);
      console.log(`  Password: ${password}`);
      console.log('  ⚠️  Please change this password immediately after first login!');
    }

    // Seed default settings if none exist
    const settingsResult = await pool.query('SELECT COUNT(*) FROM settings');
    if (settingsResult.rows[0].count === '0') {
      const defaultSettings = [
        ['phone', process.env.COMPANY_PHONE || '(555) 123-4567'],
        ['email', process.env.COMPANY_EMAIL || 'info@minnahelectricals.com'],
        ['location', process.env.COMPANY_LOCATION || 'Serving the Local Area'],
      ];
      
      for (const [key, value] of defaultSettings) {
        await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
      }
      console.log('✓ Default settings created');
    }

    // Seed default communication templates if none exist
    const templatesResult = await pool.query('SELECT COUNT(*) FROM templates');
    if (templatesResult.rows[0].count === '0') {
      const defaultTemplates = [
        {
          name: 'lead_notification',
          type: 'email',
          subject: 'New Lead Received - {{service_needed}}',
          content: 'A new lead has been received.\n\nName: {{customer_name}}\nPhone: {{phone}}\nEmail: {{email}}\nService: {{service_needed}}\nUrgency: {{urgency}}\nMessage: {{message}}\nDate: {{date}}\n\nPlease log in to the admin dashboard to manage this lead.'
        },
        {
          name: 'order_confirmation',
          type: 'email',
          subject: 'Order Confirmation - #{{order_id}}',
          content: 'Dear {{customer_name}},\n\nThank you for your order! We have received your order request and will contact you shortly.\n\nOrder ID: #{{order_id}}\nDate: {{date}}\nStatus: {{status}}\n\nWe will contact you to confirm the details.\n\nThank you for choosing {{company_name}}!'
        },
        {
          name: 'order_status_update',
          type: 'email',
          subject: 'Order #{{order_id}} Status Update',
          content: 'Dear {{customer_name}},\n\nYour order #{{order_id}} has been updated to: {{status}}\n\nThank you for choosing {{company_name}}!'
        },
        {
          name: 'lead_notification_sms',
          type: 'sms',
          subject: null,
          content: 'New Lead: {{customer_name}} - {{service_needed}} ({{urgency}}) - {{phone}}'
        },
        {
          name: 'order_status_sms',
          type: 'sms',
          subject: null,
          content: 'Order #{{order_id}} status updated to: {{status}}. Thank you for your business!'
        },
        {
          name: 'auto_responder',
          type: 'sms',
          subject: null,
          content: 'Thank you for contacting {{company_name}}! We are currently closed. Our business hours are {{open_hour}}AM - {{close_hour}}PM. We will contact you during business hours. Phone: {{phone}}'
        },
        {
          name: 'auto_responder_whatsapp',
          type: 'whatsapp',
          subject: null,
          content: 'Hello {{customer_name}}! Thank you for contacting {{company_name}}. We are currently closed. We will get back to you during business hours ({{open_hour}}AM - {{close_hour}}PM).'
        }
      ];

      for (const t of defaultTemplates) {
        await pool.query(
          'INSERT INTO templates (name, type, subject, content) VALUES ($1, $2, $3, $4)',
          [t.name, t.type, t.subject, t.content]
        );
      }
      console.log('✓ Default communication templates created');
    }

    console.log('✓ Database initialization complete');
  } catch (error) {
    console.error('✗ Database initialization error:', error);
    throw error;
  }
}

// Get pool instance
function getPool() {
  return pool;
}

// Initialize on load
initDB().catch(err => {
  console.error('Failed to initialize database:', err);
});

module.exports = {
  pool,
  initDB,
  getPool,
};