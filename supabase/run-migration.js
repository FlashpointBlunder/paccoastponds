#!/usr/bin/env node
// Usage: node run-migration.js <sql-file>
const fs = require('fs');
const https = require('https');

const PAT = 'sbp_7d786f2915bf70e789ec1f44ca16b8a15d9705bd';
const PROJECT_REF = 'wxrifqyqhgkllslprtai';

const sqlFile = process.argv[2];
if (!sqlFile) { console.error('Usage: node run-migration.js <sql-file>'); process.exit(1); }

const sql = fs.readFileSync(sqlFile, 'utf8');
const body = JSON.stringify({ query: sql });

const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('Migration successful');
    } else {
      console.error('Migration failed:', res.statusCode, data);
      process.exit(1);
    }
  });
});

req.on('error', err => { console.error('Request error:', err); process.exit(1); });
req.write(body);
req.end();
