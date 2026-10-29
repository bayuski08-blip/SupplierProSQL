const jwt = require('./node_modules/jsonwebtoken');
const http = require('http');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECRET_KEY = process.env.JWT_SECRET || 'supplierpro_secret_key_demo';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, SECRET_KEY);

console.log('Generated test token:', token.substring(0, 20) + '...');

