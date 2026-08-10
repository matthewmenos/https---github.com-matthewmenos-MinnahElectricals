# Multiple Product Images Implementation

## Overview
Added support for up to 5 images per product with a slideshow gallery on the shop page.

## Features Implemented

### 1. Database Schema
- Created `product_images` table to store multiple images per product
- Each image has: `id`, `product_id`, `image_url`, `display_order`, `created_at`
- Existing single images are preserved and migrated to the new table

### 2. Admin Panel (`public/admin/products.html`)
- **Multiple Image Upload**: Admins can now upload up to 5 images per product
- **Image Preview**: Shows thumbnails of uploaded images before saving
- **Image Management**: Admins can remove individual images from a product
- **Legacy Support**: Existing products with single `image_url` continue to work

### 3. Admin API Endpoints (`routes/admin.js`)
- **GET /api/admin/products/:id**: Returns product with all associated images
- **POST /api/admin/products**: Creates product with multiple images
- **PUT /api/admin/products/:id**: Updates product images (replaces or keeps existing)
- **DELETE /api/admin/product-images/:id**: Deletes a specific product image
- **DELETE /api/admin/products/:id**: Deletes product and all associated images

### 4. Public API Endpoints (`routes/api.js`)
- **GET /api/products**: Returns all products with their images
- **GET /api/products/:id**: Returns single product with all images
- Optimized to fetch all product images in a single query

### 5. Shop Page (`public/shop.html`)
- **Slideshow Display**: Products with multiple images show a slideshow
- **Navigation Controls**: 
  - Previous/Next buttons (appear on hover)
  - Dot indicators for direct slide navigation
- **Responsive Design**: Works on mobile and desktop
- **Backward Compatible**: Products with single image or no image still work

## How It Works

### Image Upload Flow
1. Admin selects multiple images (up to 5) in the product form
2. Each image is uploaded to R2 via `/api/admin/upload`
3. URLs are collected and saved with the product
4. First image becomes the main `image_url`, others go to `product_images` table

### Image Display Flow
1. Shop page loads products from `/api/products`
2. Each product includes `image_url` (main) and `images` (additional)
3. If multiple images exist, renders a slideshow with navigation
4. If single image, displays normally without slideshow controls

### Slideshow Features
- **Smooth Transitions**: CSS transform-based sliding animation
- **Touch-Friendly**: Large click targets for mobile
- **Visual Feedback**: Active dot indicator shows current slide
- **Hover Controls**: Navigation buttons appear on hover (desktop)

## Database Migration

Run this SQL to create the product_images table:

```sql
-- migrations/create_product_images_table.sql

CREATE TABLE IF NOT EXISTS product_images (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- Migrate existing single images from products table
INSERT INTO product_images (product_id, image_url, display_order)
SELECT id, image_url, 0
FROM products
WHERE image_url IS NOT NULL AND image_url != ''
ON CONFLICT DO NOTHING;
```

## Usage Instructions

### For Admins
1. Go to Admin Panel → Products
2. Click "Add New Product" or "Edit" existing product
3. In the "Product Images" section, select up to 5 images
4. First image will be the main product image
5. Click "Save Product"
6. To remove an image, click the X button on the image thumbnail

### For Customers
1. Browse products on the shop page
2. Products with multiple images show navigation arrows and dots
3. Click arrows or dots to navigate through images
4. Click anywhere on product card to view details

## Technical Details

### Image URL Format
- Images are stored in R2 with format: `https://pub-0b43ce1eeca8450cbb295d3f6dcf91b0.r2.dev/media/{filename}`
- URLs are saved directly to database
- No transformation needed when serving to frontend

### Performance Optimizations
- Single query fetches all images for all products
- Images grouped in memory by product_id
- Slideshow state managed per-product to avoid conflicts
- CSS transforms for smooth animations (GPU accelerated)

### Browser Compatibility
- Modern browsers (Chrome, Firefox, Safari, Edge)
- CSS Grid and Flexbox for layout
- ES6+ JavaScript syntax
- No external dependencies for slideshow

## Files Modified

1. **Database Migration**: `migrations/create_product_images_table.sql`
2. **Admin Panel**: `public/admin/products.html`
3. **Admin Routes**: `routes/admin.js`
4. **Public API**: `routes/api.js`
5. **Shop Page**: `public/shop.html`

## Backward Compatibility

- ✅ Existing products with single `image_url` continue to work
- ✅ Products without images show placeholder
- ✅ Old URLs in database remain functional
- ✅ API responses include both `image_url` and `images` fields
- ✅ Frontend gracefully handles missing `images` array

## Testing Checklist

- [ ] Run database migration SQL
- [ ] Restart server
- [ ] Test uploading 1 image (should work as before)
- [ ] Test uploading multiple images (2-5)
- [ ] Test removing an image before saving
- [ ] Test editing product and adding more images
- [ ] Test editing product without changing images
- [ ] Verify slideshow appears on shop page
- [ ] Test slideshow navigation (arrows and dots)
- [ ] Test on mobile device
- [ ] Verify existing products still display correctly
- [ ] Check browser console for errors

## Notes

- Maximum 5 images per product (enforced in frontend)
- Images are optional - products can have 0 images
- First uploaded image is set as main image
- Image deletion is immediate (no soft delete)
- R2 URLs must be publicly accessible for slideshow to work