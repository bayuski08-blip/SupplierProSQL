const fs = require('fs');
const mysql = require('mysql2/promise');

async function inspect() {
  console.log('=== Inspecting Dashboard.html Roles and Navigation ===');
  const html = fs.readFileSync('dashboard.html', 'utf8');
  html.split('\n').forEach((l, i) => {
    if (l.includes('data-page="roles"') || l.includes('id="page-roles"') || l.includes('Otoritas')) {
      console.log(`dashboard.html:${i+1}: ${l.trim().slice(0, 120)}`);
    }
  });

  console.log('\n=== Inspecting Server.js Role Middlewares & Access Control ===');
  const server = fs.readFileSync('server.js', 'utf8');
  server.split('\n').forEach((l, i) => {
    if (l.includes('authorize(') || l.includes('authenticateToken') || l.includes('canSeeFinance')) {
      console.log(`server.js:${i+1}: ${l.trim().slice(0, 120)}`);
    }
  });

  console.log('\n=== Inspecting Stock updates in Server.js ===');
  server.split('\n').forEach((l, i) => {
    if (l.toLowerCase().includes('update products set stock') || l.toLowerCase().includes('stock = stock') || l.toLowerCase().includes('stock = ?')) {
      console.log(`server.js:${i+1}: ${l.trim().slice(0, 120)}`);
    }
  });

  console.log('\n=== Inspecting Cost Price / HPP in Server.js ===');
  server.split('\n').forEach((l, i) => {
    if (l.toLowerCase().includes('cost_price') && (l.includes('=') || l.includes('UPDATE'))) {
      console.log(`server.js:${i+1}: ${l.trim().slice(0, 120)}`);
    }
  });

  console.log('\n=== Inspecting Modal handling in Dashboard.js ===');
  const dash = fs.readFileSync('dashboard.js', 'utf8');
  dash.split('\n').forEach((l, i) => {
    if (l.includes('closeModal') || l.includes('openModal') || l.includes('showModal')) {
      console.log(`dashboard.js:${i+1}: ${l.trim().slice(0, 120)}`);
    }
  });
}

inspect().catch(console.error);

