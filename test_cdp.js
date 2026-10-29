const { spawn } = require('child_process');
const http = require('http');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browserPath = require('fs').existsSync(chromePath) ? chromePath : edgePath;

console.log('Using browser:', browserPath);

const browser = spawn(browserPath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--disable-gpu',
  '--no-sandbox'
]);

setTimeout(async () => {
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version');
    const data = await res.json();
    console.log('CDP Version:', data);
    browser.kill();
  } catch (err) {
    console.error('CDP failed:', err.message);
    browser.kill();
  }
}, 1500);

