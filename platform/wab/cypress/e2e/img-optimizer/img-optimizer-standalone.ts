/**
 * Standalone image optimizer server for testing
 * 
 * This server runs the img-optimizer routes in isolation for testing purposes.
 * It automatically detects LocalStack and works with both real AWS S3 and LocalStack.
 */

import 'express-async-errors'; // Must be first to catch async errors
import express, { Request, Response, NextFunction } from 'express';
import { optimizeImageHandler, optimizeImageStaticHandler } from '../../routes/img-optimizer';

// Load environment variables
import 'dotenv/config';

const app = express();
const PORT = process.env.IMG_OPTIMIZER_PORT || 3005;

// Add request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Add the image optimizer routes (express-async-errors handles async errors)
app.get('/img-optimizer/v1/img', optimizeImageHandler);
app.get('/img-optimizer/v1/img/:imageId', optimizeImageStaticHandler);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'img-optimizer-standalone',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(`Error handling request ${req.method} ${req.url}:`, err.message);
  
  // Handle custom errors with statusCode
  if (err.statusCode) {
    res.status(err.statusCode).json({
      error: {
        message: err.message
      }
    });
  } else {
    // Generic error
    res.status(500).json({
      error: {
        message: 'Internal server error'
      }
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Image Optimizer standalone server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📊 Environment Configuration:');
  console.log(`   S3_ENDPOINT: ${process.env.S3_ENDPOINT || 'not set'}`);
  console.log(`   SITE_ASSETS_BUCKET: ${process.env.SITE_ASSETS_BUCKET || 'not set'}`);
  console.log(`   SITE_ASSETS_BASE_URL: ${process.env.SITE_ASSETS_BASE_URL || 'not set'}`);
  console.log('');
  console.log('🔗 Example API calls:');
  console.log(`   Width only: http://localhost:${PORT}/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&w=640`);
  console.log(`   Height only: http://localhost:${PORT}/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&h=480`);
  console.log(`   Both + WebP: http://localhost:${PORT}/img-optimizer/v1/img?src=http://localhost:4566/test-bucket/test-image.jpg&w=640&h=480&f=webp&q=85`);
  console.log(`   Static handler: http://localhost:${PORT}/img-optimizer/v1/img/test-image.jpg?w=500&f=webp`);
});