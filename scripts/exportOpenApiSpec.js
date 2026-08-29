// Run with: npm run export-openapi
// Writes the full OpenAPI spec (built from config/swagger.js's JSDoc scan of
// routes/*.js) to openapi.json at the project root — useful for importing
// into Postman/Insomnia directly, or for CI to diff against for API
// contract drift.
const fs = require('fs');
const path = require('path');
const swaggerSpec = require('../config/swagger');

const outputPath = path.join(__dirname, '..', 'openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));

const pathCount = Object.keys(swaggerSpec.paths || {}).length;
console.log(`OpenAPI spec written to ${outputPath} (${pathCount} paths documented)`);
