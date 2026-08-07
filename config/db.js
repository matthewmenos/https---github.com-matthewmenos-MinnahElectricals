const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Configure sql.js WASM path for Vercel BEFORE requiring it
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
if (isVercel) {
  // Set the WASM file location for Vercel
  const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (fs.existsSync(wasmPath)) {
    process.env.SQLJS_LOAD_WASM = wasmPath;
  }
}

// Now require sql.js after setting the environment variable
const initSqlJs = require('sql.js');
const r2Sync = require('./r2-sync');

// Use /tmp on Vercel (read-only filesystem), use data/ locally
const dataDir = isVercel ? '/tmp' : path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    console.warn('Could not create data directory:', err.message);
  }
}

const dbPath = path.join(dataDir, 'electrical.db');

// Log database path for debugging
console.log(`📁 Database path: ${dbPath}`);
console.log(`   Environment: ${isVercel ? 'Vercel (production)' : 'Local'}`);
let db = null;

// Initialize database
async function initializeDatabase() {
  // Configure sql.js with WASM location
  const sqlJsConfig = {};
  
  if (isVercel) {
    const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    sqlJsConfig.locateFile = (file) => {
      if (file === 'sql-wasm.wasm') {
        return wasmPath;
      }
      return file;
    };
  }
  
  const SQL = await initSqlJs(sqlJsConfig);

  // If there is no local database yet, try restoring from R2 first.
  // This prevents a redeploy from creating a blank database and overwriting
  // the last known backup in cloud storage.
  if (!fs.existsSync(dbPath)) {
    try {
      await r2Sync.initialize();
    } catch (error) {
      console.warn('R2 initialization warning:', error.message);
    }
  }
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      service_needed TEXT NOT NULL,
      urgency TEXT DEFAULT 'Standard',
      message TEXT,
      status TEXT DEFAULT 'New',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_url TEXT,
      category TEXT,
      in_stock INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      product_id INTEGER NOT NULL,
      product_name TEXT,
      product_price REAL,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      order_source TEXT DEFAULT 'website',
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT NOT NULL,
      category TEXT,
      client_name TEXT,
      project_date TEXT,
      featured INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      image_url TEXT NOT NULL,
      category TEXT,
      description TEXT,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create reviews table
  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review_text TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  // Create wishlist table
  db.run(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, session_id)
    )
  `);

  // Create customer_info table for quick checkout
  db.run(`
    CREATE TABLE IF NOT EXISTS customer_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create templates table for communication templates
  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('email', 'sms', 'whatsapp')),
      subject TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create push_subscriptions table for web push notifications
  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      keys TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, endpoint)
    )
  `);

  // Create sms_logs table for SMS delivery tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create loyalty_program table for customer loyalty program
  db.run(`
    CREATE TABLE IF NOT EXISTS loyalty_program (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      points INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
      total_spent REAL DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create loyalty_transactions table for tracking loyalty point transactions
  db.run(`
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT NOT NULL,
      points INTEGER NOT NULL,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earned', 'redeemed', 'bonus', 'expired')),
      description TEXT,
      order_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `);

  // Create product_specifications table for product catalog enhancements
  db.run(`
    CREATE TABLE IF NOT EXISTS product_specifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      spec_name TEXT NOT NULL,
      spec_value TEXT NOT NULL,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  // Create product_variants table for product variants
  db.run(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      variant_name TEXT NOT NULL,
      variant_value TEXT NOT NULL,
      price_adjustment REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_portfolio_category ON portfolio(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_portfolio_featured ON portfolio(featured)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gallery_category ON gallery(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_loyalty_program_phone ON loyalty_program(customer_phone)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_customer ON loyalty_transactions(customer_phone)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_product_specs_product ON product_specifications(product_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id)`);

  // Seed default admin user if none exists
  const userCount = db.exec('SELECT COUNT(*) as count FROM users')[0];
  if (userCount && userCount.values[0][0] === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'AdminPass123!';
    const passwordHash = bcrypt.hashSync(password);
    
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    
    console.log('✓ Default admin user created:');
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log('  ⚠️  Please change this password immediately after first login!');
  }

  // Seed default settings if none exist
  const settingsCount = db.exec('SELECT COUNT(*) as count FROM settings')[0];
  if (settingsCount && settingsCount.values[0][0] === 0) {
    const defaultSettings = [
      ['phone', process.env.COMPANY_PHONE || '(555) 123-4567'],
      ['email', process.env.COMPANY_EMAIL || 'info@minnahelectricals.com'],
      ['location', process.env.COMPANY_LOCATION || 'Serving the Local Area'],
    ];
    defaultSettings.forEach(([key, value]) => {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    });
    console.log('✓ Default settings created');
  }

  // Seed default communication templates if none exist
  const templatesCount = db.exec('SELECT COUNT(*) as count FROM templates')[0];
  if (templatesCount && templatesCount.values[0][0] === 0) {
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
    defaultTemplates.forEach(t => {
      db.run(
        'INSERT INTO templates (name, type, subject, content) VALUES (?, ?, ?, ?)',
        [t.name, t.type, t.subject, t.content]
      );
    });
    console.log('✓ Default communication templates created');
  }

  // Save database
  saveDatabase();
  
  return db;
}

// Save database to file and sync to R2
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    
    // Sync to R2 (non-blocking)
    if (r2Sync && r2Sync.isConfigured()) {
      r2Sync.sync().catch(err => {
        console.error('R2 sync error:', err.message);
      });
    }
  }
}

// Get database instance
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

// Initialize on load
initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

module.exports = {
  initializeDatabase,
  getDb,
  saveDatabase,
};
//test