const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

// Initialize S3 client for Cloudflare R2 (for media files only)
// Note: Database is now stored in PostgreSQL, not R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const MEDIA_BUCKET_NAME = process.env.R2_MEDIA_BUCKET_NAME;

/**
 * Check if R2 is configured for media storage
 */
function isConfigured() {
  return !!(process.env.R2_ACCOUNT_ID && 
            process.env.R2_ACCESS_KEY_ID && 
            process.env.R2_SECRET_ACCESS_KEY && 
            process.env.R2_MEDIA_BUCKET_NAME);
}

/**
 * Initialize R2 - check configuration
 * Note: Only used for media file storage (product images, gallery, etc.)
 * Database is now stored in PostgreSQL
 */
async function initialize() {
  if (!isConfigured()) {
    console.log('⚠️  R2 not configured. Media files will not be uploaded to cloud storage.');
    console.log('   To enable cloud media storage, configure R2 credentials in .env');
    return;
  }

  console.log('✓ R2 initialized (for media files only)');
  console.log('  Database is now stored in PostgreSQL');
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

module.exports = {
  initialize,
  isConfigured,
  uploadMediaToR2,
  deleteMediaFromR2,
};