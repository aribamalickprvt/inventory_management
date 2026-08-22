// Setting this here (rather than in the "test" npm script) works identically
// on Windows PowerShell/cmd and on bash — inline `VAR=value command` syntax
// doesn't work on Windows, but this file is just plain Node code that Jest
// loads before anything else, so it's a portable way to guarantee NODE_ENV
// is 'test' for every test run regardless of platform.
process.env.NODE_ENV = 'test';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  forceExit: true, // MySQL/Redis/RabbitMQ connections can keep the process alive otherwise
  testTimeout: 10000,
};
