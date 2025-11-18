import '@testing-library/jest-dom';

// Mock fetch globally for all tests
global.fetch = jest.fn();

// Mock console methods to avoid noise in tests (keeping log for debugging)
global.console = {
  ...console,
  // log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock environment variables for tests
process.env = {
  ...process.env,
  EP_CLIENT_ID: 'test-client-id',
  EP_HOST: 'https://api.moltin.com',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  NODE_ENV: 'test'
};

// Mock window.print for confirmation component tests
Object.defineProperty(window, 'print', {
  value: jest.fn(),
  writable: true
});

// Mock location for URL-related tests
Object.defineProperty(window, 'location', {
  value: {
    href: 'http://localhost:3000/checkout',
    hostname: 'localhost',
    pathname: '/checkout'
  },
  writable: true
});

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset fetch mock
  (global.fetch as jest.MockedFunction<typeof fetch>).mockClear();
});

// Clean up after each test
afterEach(() => {
  jest.restoreAllMocks();
});

// Add custom matchers for better test assertions
expect.extend({
  toBeValidOrder(received) {
    const pass = received && 
      typeof received.id === 'string' &&
      typeof received.type === 'string' &&
      received.total &&
      typeof received.total.amount === 'number' &&
      typeof received.total.currency === 'string';
    
    return {
      message: () => `expected ${received} to be a valid order object`,
      pass
    };
  },
  
  toBeValidAddress(received) {
    const pass = received &&
      typeof received.first_name === 'string' &&
      typeof received.last_name === 'string' &&
      typeof received.line_1 === 'string' &&
      typeof received.city === 'string' &&
      typeof received.country === 'string' &&
      typeof received.postcode === 'string';
    
    return {
      message: () => `expected ${received} to be a valid address object`,
      pass
    };
  }
});

// Type augmentation for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidOrder(): R;
      toBeValidAddress(): R;
    }
  }
}

export {};