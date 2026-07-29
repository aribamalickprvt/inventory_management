module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  forceExit: true, // MySQL pool can keep the process alive otherwise
  testTimeout: 10000,
};
