#  Elite Electrical Services - Website & Admin Dashboard

A production-ready, high-converting local service website for an electrical company with a complete lead management system and admin dashboard.

##  Features

### Public Website
- **Responsive Design**: Mobile-first design with Tailwind CSS
- **High-Converting Hero Section**: Trust badges, quick quote form, and clear CTAs
- **Service Showcase**: Detailed service pages with benefits and call-to-actions
- **Contact Page**: Full contact form with emergency service highlighting
- **Mobile Menu**: Hamburger menu with quick-call button
- **SEO Optimized**: Meta descriptions and semantic HTML5

### Admin Dashboard
- **Secure Authentication**: JWT-based login system with bcrypt password hashing
- **Lead Management**: View, filter, update status, and delete leads
- **Statistics Dashboard**: Real-time stats (total leads, new leads, recent leads, emergency leads)
- **Status Filtering**: Filter leads by status (New, Contacted, Scheduled, Completed)
- **Responsive Table**: Mobile-friendly data table with click-to-call functionality

### Backend Features
- **RESTful API**: Clean API endpoints for lead submission and admin operations
- **SQLite Database**: Lightweight, reliable data storage with WAL mode
- **Cloudflare R2 Sync**: Automatic database backup to R2 bucket
- **Email Notifications**: Instant email alerts for new leads via Nodemailer
- **Input Validation**: Server-side validation and sanitization
- **Error Handling**: Comprehensive error handling and logging

## 🛠️ Tech Stack

- **Frontend**: HTML5, Tailwind CSS, Vanilla JavaScript (ES6+)
- **Backend**: Node.js, Express.js
- **Database**: SQLite (better-sqlite3)
- **Authentication**: JWT (jsonwebtoken), bcrypt
- **Email**: Nodemailer
- **Cloud Storage**: Cloudflare R2 (S3-compatible)
- **Environment**: dotenv for configuration management

## 📁 Project Structure

```
electrical-company/
├── package.json
├── server.js                  # Main server entry point
├── .env.example               # Environment variables template
├── config/
│   ├── db.js                  # SQLite database initialization
│   └── r2-sync.js             # Cloudflare R2 sync service
├── middleware/
│   └── auth.js                # JWT authentication middleware
├── routes/
│   ├── api.js                 # Public API endpoints
│   └── admin.js               # Admin API endpoints
├── public/
│   ├── index.html             # Home page with quote form
│   ├── services.html          # Services overview page
│   ├── contact.html           # Contact page
│   ├── admin/
│   │   ├── login.html         # Admin login page
│   │   └── dashboard.html     # Admin dashboard
│   └── js/
│       ├── main.js            # Frontend interactions
│       └── admin.js           # Admin panel functionality
└── data/
    └── electrical.db          # SQLite database (auto-created)
```

## 🚀 Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Cloudflare R2 account (optional, for cloud backup)

### Step 1: Clone or Download the Project

```bash
# If using git
git clone <repository-url>
cd electrical-company

# Or navigate to the project folder
cd c:/Users/DELL/Desktop/Electricals
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and configure the following:

   **Required:**
   - `JWT_SECRET`: A secure random string for JWT token signing
   - `PORT`: Server port (default: 3000)

   **Optional (for email notifications):**
   - `SMTP_HOST`: Your SMTP server (e.g., smtp.gmail.com)
   - `SMTP_PORT`: SMTP port (e.g., 587)
   - `SMTP_USER`: Your email address
   - `SMTP_PASS`: Your email password or app password
   - `SMTP_FROM`: From email address
   - `SMTP_TO`: To email address for notifications

   **Optional (for Cloudflare R2 backup):**
   - `R2_ACCOUNT_ID`: Your Cloudflare account ID
   - `R2_ACCESS_KEY_ID`: R2 access key
   - `R2_SECRET_ACCESS_KEY`: R2 secret key
   - `R2_BUCKET_NAME`: Your R2 bucket name
   - `R2_ENDPOINT`: R2 endpoint URL

### Step 4: Start the Server

```bash
# Development mode
npm start

# Or
node server.js
```

The server will start on `http://localhost:3000` (or your configured PORT).

### Step 5: Access the Application

- **Public Website**: http://localhost:3000/
- **Services Page**: http://localhost:3000/services.html
- **Contact Page**: http://localhost:3000/contact.html
- **Admin Login**: http://localhost:3000/admin/login
- **Admin Dashboard**: http://localhost:3000/admin/dashboard

## 🔐 Default Admin Credentials

**Username:** `admin`  
**Password:** `AdminPass123!`

⚠️ **IMPORTANT**: Change the default password immediately after first login!

## 📡 API Endpoints

### Public Endpoints

#### POST /api/leads
Submit a new lead from the contact form.

**Request Body:**
```json
{
  "full_name": "John Doe",
  "phone": "(555) 123-4567",
  "email": "john@example.com",
  "service_needed": "Panel Upgrade",
  "urgency": "Standard",
  "message": "Need a new electrical panel"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Thank you! We will contact you shortly.",
  "lead": { ... }
}
```

#### GET /api/health
Health check endpoint.

### Admin Endpoints

#### POST /api/admin/login
Authenticate and get JWT token.

**Request Body:**
```json
{
  "username": "admin",
  "password": "AdminPass123!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "admin"
  }
}
```

#### GET /api/admin/leads
Get all leads (requires authentication).

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters (optional):**
- `status`: Filter by status (New, Contacted, Scheduled, Completed, Archived)
- `urgency`: Filter by urgency (Standard, Emergency)

#### PATCH /api/admin/leads/:id
Update lead status (requires authentication).

**Request Body:**
```json
{
  "status": "Contacted"
}
```

#### DELETE /api/admin/leads/:id
Delete a lead (requires authentication).

#### GET /api/admin/stats
Get dashboard statistics (requires authentication).

## 🗄️ Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Leads Table
```sql
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  service_needed TEXT NOT NULL,
  urgency TEXT DEFAULT 'Standard',
  message TEXT,
  status TEXT DEFAULT 'New',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## ☁️ Cloudflare R2 Setup (Optional)

### Step 1: Create R2 Bucket
1. Log in to your Cloudflare dashboard
2. Navigate to R2 Object Storage
3. Create a new bucket (e.g., `electrical-db-backup`)
4. Note your Account ID and bucket name

### Step 2: Create API Credentials
1. Go to R2 → Manage R2 API Tokens
2. Create a new API token with "Edit" permissions
3. Save the Access Key ID and Secret Access Key

### Step 3: Configure .env
Add the R2 credentials to your `.env` file:
```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=your_bucket_name
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

The database will automatically sync to R2 on:
- Server startup (download if exists, then upload)
- After every lead creation
- After every lead status update
- After every lead deletion

## 📧 Email Setup (Optional)

### Gmail Configuration
1. Enable 2-factor authentication on your Google account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the app password in `.env`:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_app_password
   ```

### Other SMTP Providers
- **Outlook/Hotmail**: `smtp.live.com`, port 587
- **Yahoo**: `smtp.mail.yahoo.com`, port 587
- **SendGrid**: `smtp.sendgrid.net`, port 587

## 🎨 Customization

### Update Company Information
Edit these files to customize:
- `public/index.html`: Company name, phone number, services
- `public/services.html`: Service descriptions
- `public/contact.html`: Contact details and business hours
- `.env`: Company information variables

### Change Colors
Modify the Tailwind config in HTML files:
```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        navy: '#0F172A',      // Primary dark color
        amber: '#F59E0B',     // Accent color
        'amber-dark': '#D97706', // Darker accent
      }
    }
  }
}
```

### Add More Services
Edit the service cards in:
- `public/index.html` (services grid section)
- `public/services.html` (detailed services section)

## 🔒 Security Features

- **Password Hashing**: bcrypt with salt rounds (10)
- **JWT Authentication**: Secure token-based authentication
- **Input Sanitization**: All inputs are sanitized and validated
- **SQL Injection Prevention**: Parameterized queries
- **XSS Prevention**: HTML escaping in admin panel
- **CORS Configuration**: Configurable CORS settings
- **Rate Limiting Ready**: Can be easily added with express-rate-limit

## 📊 Lead Management Workflow

1. **New Lead**: Customer submits form → Email notification sent → Lead appears in dashboard
2. **Contacted**: Admin updates status after initial contact
3. **Scheduled**: Admin schedules appointment
4. **Completed**: Work is completed
5. **Archived**: Lead is archived for record-keeping

## 🐛 Troubleshooting

### Server won't start
- Check if port 3000 is already in use
- Verify all dependencies are installed: `npm install`
- Check `.env` file exists and is properly configured

### Database errors
- Ensure the `data/` directory exists and is writable
- Check file permissions on `data/electrical.db`

### Email not sending
- Verify SMTP credentials in `.env`
- Check if your email provider requires app passwords
- Review email provider's SMTP settings

### R2 sync not working
- Verify R2 credentials in `.env`
- Check R2 bucket exists and is accessible
- Ensure API token has correct permissions

## 📝 Development Notes

- **WAL Mode**: SQLite is configured with WAL (Write-Ahead Logging) for better performance
- **Indexes**: Database indexes on `status` and `created_at` for faster queries
- **Non-blocking Operations**: R2 sync and email sending are non-blocking
- **Error Logging**: Comprehensive console logging for debugging
- **Production Ready**: Includes error handling middleware and security best practices

## 🚢 Deployment

### Deploy to VPS/Dedicated Server
1. Install Node.js on your server
2. Clone/download the project
3. Run `npm install --production`
4. Configure `.env` with production settings
5. Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "electrical-website"
   pm2 save
   pm2 startup
   ```

### Deploy to Cloud Platforms
- **Heroku**: Use the provided Procfile (create one: `web: node server.js`)
- **DigitalOcean App Platform**: Connect repository and configure environment variables
- **AWS EC2**: Similar to VPS deployment
- **Railway/Render**: Connect GitHub repo and set environment variables

## 📄 License

MIT License - feel free to use this project for your own business or client projects.

## 🤝 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review console logs for error messages
3. Ensure all environment variables are correctly configured

## 🎯 Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Configure `.env` file
3. ✅ Start server: `npm start`
4. ✅ Access admin panel at `/admin/login`
5. ✅ Change default admin password
6. ✅ Test contact form submission
7. ✅ Configure email notifications (optional)
8. ✅ Setup Cloudflare R2 backup (optional)
9. ✅ Customize content and branding
10. ✅ Deploy to production

---

**Built with ❤️ for local electrical businesses**