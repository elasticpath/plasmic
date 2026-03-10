module.exports = {
  displayName: 'Elastic Path Checkout Tests',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/checkout/__tests__/setup.ts'],
  testMatch: [
    '<rootDir>/src/checkout/**/__tests__/**/*.test.{ts,tsx}',
    '<rootDir>/src/api/endpoints/checkout/**/__tests__/**/*.test.{ts,tsx}',
    '<rootDir>/src/api/endpoints/checkout-session/**/__tests__/**/*.test.{ts,tsx}'
  ],
  collectCoverageFrom: [
    'src/checkout/**/*.{ts,tsx}',
    'src/api/endpoints/checkout/**/*.{ts,tsx}',
    'src/api/endpoints/checkout-session/**/*.{ts,tsx}',
    '!src/checkout/**/__tests__/**',
    '!src/checkout/**/*.test.{ts,tsx}',
    '!src/checkout/index.ts',
    '!src/checkout/types.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transform: {
    "\\.tsx?$": "<rootDir>/../../../jest-transform-esbuild.js",
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testTimeout: 10000,
  verbose: true
};