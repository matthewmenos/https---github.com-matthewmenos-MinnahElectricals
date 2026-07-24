const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
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
const DB_PATH = path.join(__dirname, '..', 'data', 'electrical.db');

let syncInProgress = false;
let lastSyncTime = null;

/**
 * Upload database to R2 bucket
 */
async function uploadToR2() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('⚠️  Database file not found, skipping R2 upload');
    return false;
  }

  try {
    const fileStream = fs.createReadStream(DB_PATH);
    const fileStats = fs.statSync(DB_PATH);
    
    const command = new PutObjectCommand({
      Bucket: DB_BUCKET_NAME,
      Key: DB_KEY,
      Body: fileStream,
      ContentType: 'application/octet-stream',
      Metadata: {
        'uploaded-at': new Date().toISOString(),
        'size': fileStats.size.toString(),
      },
    });

    await s3Client.send(command);
    lastSyncTime = new Date();
    console.log(`✓ Database synced to R2 at ${lastSyncTime.toISOString()}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to sync database to R2:', error.message);
    return false;
  }
}

/**
 * Download database from R2 bucket
 */
async function downloadFromR2() {
  try {
    const command = new GetObjectCommand({
      Bucket: DB_BUCKET_NAME,
      Key: DB_KEY,
    });

    const response = await s3Client.send(command);
    
    // Create write stream
    const writeStream = fs.createWriteStream(DB_PATH);
    
    // Pipe response body to file
    response.Body.pipe(writeStream);
    
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        console.log('✓ Database downloaded from R2');
        resolve(true);
      });
      
      writeStream.on('error', (error) => {
        console.error('✗ Failed to write database file:', error.message);
        reject(error);
      });
    });
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      console.log('ℹ️  No existing database found in R2, starting fresh');
      return false;
    }
    console.error('✗ Failed to download database from R2:', error.message);
    return false;
  }
}

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
 */
async function sync() {
  if (!isConfigured()) {
    console.log('⚠️  R2 not configured, skipping sync');
    return false;
  }

  if (syncInProgress) {
    console.log('⏳ Sync already in progress, skipping...');
    return false;
  }

  syncInProgress = true;
  
  try {
    const success = await uploadToR2();
    syncInProgress = false;
    return success;
  } catch (error) {
    syncInProgress = false;
    console.error('✗ Sync failed:', error.message);
    return false;
  }
}

/**
 * Initialize R2 sync - download database on cold start
 */
async function initialize() {
  if (!isConfigured()) {
    console.log('⚠️  R2 not configured. Database will be stored locally only.');
    console.log('   To enable cloud backup, configure R2 credentials in .env');
    return;
  }

  console.log('🔄 Initializing R2 sync...');
  
  try {
    const downloaded = await downloadFromR2();
    
    if (downloaded) {
      // Perform initial sync after download to ensure we have the latest
      await uploadToR2();
    }
  } catch (error) {
    console.error('✗ R2 initialization failed:', error.message);
  }
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
    
    // Return the public URL (assuming public bucket or CDN)
    const mediaUrl = `${process.env.R2_ENDPOINT.replace(/\/$/, '')}/${MEDIA_BUCKET_NAME}/media/${fileName}`;
    console.log(`✓ Media uploaded to R2: ${fileName}`);
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
};
