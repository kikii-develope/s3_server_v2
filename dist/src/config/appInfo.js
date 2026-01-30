const path = require('path');
const fs = require('fs');
const packagePath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
module.exports = { pkg };
