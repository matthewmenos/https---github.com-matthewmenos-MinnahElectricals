const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();
const r2Sync = require('./config/r2-sync');
const { initializeDatabase } = require('./config/db');

// Import routes
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads (store in memory for R2 upload)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Inject push-notifications.js script into HTML responses (public pages only)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && !req.path.includes('/admin/')) {
    const originalSend = res.send;
    res.send = function(content) {
      if (typeof content === 'string' && content.includes('</body>')) {
        content = content.replace('</body>', '<script src="/js/push-notifications.js"></script></body>');
      }
      return originalSend.call(this, content);
    };
  }
  next();
});

// API Routes
app.use('/api', apiRoutes);

// Admin API Routes
app.use('/api/admin', adminRoutes);

// Note: Multer upload middleware is applied within the route handlers
// in routes/api.js and routes/admin.js for /upload endpoints

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    r2_configured: r2Sync.isConfigured(),
  });
});

// Serve admin pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

// Serve all other HTML files
app.get('/*.html', (req, res) => {
  const page = req.path.replace('/', '');
  res.sendFile(path.join(__dirname, 'public', page + '.html'));
});

// Catch-all for SPA-like routing (optional, for future expansion)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

// Initialize R2 sync and start server
async function startServer() {
  try {
    // Initialize database first
    await initializeDatabase();
    console.log('✓ Database initialized');
    
    // Initialize R2 sync (download database if exists)
    await r2Sync.initialize();

    // Start Express server
    app.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('⚡ Electrical Company Website Server');
      console.log('='.repeat(60));
      console.log(`✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ R2 Backup: ${r2Sync.isConfigured() ? 'Enabled' : 'Disabled'}`);
      console.log('='.repeat(60));
      console.log('Available pages:');
      console.log(`  - Home: http://localhost:${PORT}/`);
      console.log(`  - Services: http://localhost:${PORT}/services.html`);
      console.log(`  - Contact: http://localhost:${PORT}/contact.html`);
      console.log(`  - Admin Login: http://localhost:${PORT}/admin/login`);
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('✗ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();