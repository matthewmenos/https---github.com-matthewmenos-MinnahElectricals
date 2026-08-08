const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const DB_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const MEDIA_BUCKET_NAME = process.env.R2_MEDIA_BUCKET_NAME;
const DB_KEY = 'electrical.db';

let syncInProgress = false;
let lastSyncTime = null;

/**
 * Check if R2 is configured
 */
function isConfigured() {
  return !!(process.env.R2_ACCOUNT_ID && 
            process.env.R2_ACCESS_KEY_ID && 
            process.env.R2_SECRET_ACCESS_KEY && 
            process.env.R2_BUCKET_NAME);
}

/**
 * Sync database to R2 (with debouncing)
 * @deprecated This function is deprecated. Use uploadDatabaseToR2() from db.js instead.
 */
async function sync() {
  console.log('⚠️  sync() is deprecated. Database is now saved directly via saveDatabase() in db.js');
  return false;
}

/**
 * Initialize R2 sync - check configuration
 * Note: Database loading is now handled by db.js using downloadDatabaseFromR2()
 */
async function initialize() {
  if (!isConfigured()) {
    console.log('⚠️  R2 not configured. Database will be stored in memory only.');
    console.log('   To enable cloud backup, configure R2 credentials in .env');
    return;
  }

  console.log('✓ R2 sync initialized (database loading handled by db.js)');
  console.log('  Database will be loaded from R2 on first saveDatabase() call');
}

/**
 * Upload media file to R2 media bucket
 */
async function uploadMediaToR2(fileBuffer, fileName, contentType) {
  if (!MEDIA_BUCKET_NAME) {
    console.log('⚠️  R2 media bucket not configured');
    return null;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: MEDIA_BUCKET_NAME,
      Key: `media/${fileName}`,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: {
        'uploaded-at': new Date().toISOString(),
      },
    });

    await s3Client.send(command);
    
    // Return the public URL
    let mediaUrl;
    if (process.env.R2_PUBLIC_URL) {
      // Use custom public URL (e.g., CDN or custom domain)
      const publicUrl = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
      mediaUrl = `${publicUrl}/${fileName}`;
    } else if (process.env.R2_ACCOUNT_ID) {
      // Use R2.dev public endpoint (requires bucket to be public)
      // Format: https://{account}.r2.dev/{bucket}/{key}
      const accountId = process.env.R2_ACCOUNT_ID;
      mediaUrl = `https://${accountId}.r2.dev/${MEDIA_BUCKET_NAME}/media/${fileName}`;
    } else {
      // Fallback to API endpoint (won't work for public access without auth)
      const endpoint = process.env.R2_ENDPOINT.replace(/\/$/, '');
      mediaUrl = `${endpoint}/${MEDIA_BUCKET_NAME}/media/${fileName}`;
    }
    
    console.log(`✓ Media uploaded to R2: ${fileName}`);
    console.log(`  URL: ${mediaUrl}`);
    return mediaUrl;
  } catch (error) {
    console.error('✗ Failed to upload media to R2:', error.message);
    return null;
  }
}

/**
 * Delete media file from R2 media bucket
 */
async function deleteMediaFromR2(fileName) {
  if (!MEDIA_BUCKET_NAME) {
    console.log('⚠️  R2 media bucket not configured');
    return false;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: MEDIA_BUCKET_NAME,
      Key: `media/${fileName}`,
    });

    await s3Client.send(command);
    console.log(`✓ Media deleted from R2: ${fileName}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to delete media from R2:', error.message);
    return false;
  }
}

/**
 * Download database from R2 and return as Buffer
 */
async function downloadDatabaseFromR2() {
  try {
    const command = new GetObjectCommand({
      Bucket: DB_BUCKET_NAME,
      Key: DB_KEY,
    });

    const response = await s3Client.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    console.log(`✓ Database downloaded from R2 (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      console.log('ℹ️  No existing database found in R2');
      return null;
    }
    console.error('✗ Failed to download database from R2:', error.message);
    return null;
  }
}

/**
 * Upload database buffer directly to R2
 */
async function uploadDatabaseToR2(buffer) {
  if (!DB_BUCKET_NAME) {
    console.log('⚠️  R2 database bucket not configured');
    return false;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: DB_BUCKET_NAME,
      Key: DB_KEY,
      Body: buffer,
      ContentType: 'application/octet-stream',
      Metadata: {
        'uploaded-at': new Date().toISOString(),
        'size': buffer.length.toString(),
      },
    });

    await s3Client.send(command);
    lastSyncTime = new Date();
    console.log(`✓ Database synced to R2 (${buffer.length} bytes)`);
    return true;
  } catch (error) {
    console.error('✗ Failed to sync database to R2:', error.message);
    return false;
  }
}

/**
 * Get last sync time
 */
function getLastSyncTime() {
  return lastSyncTime;
}

module.exports = {
  sync,
  initialize,
  isConfigured,
  getLastSyncTime,
  uploadMediaToR2,
  deleteMediaFromR2,
  downloadDatabaseFromR2,
  uploadDatabaseToR2,
};
