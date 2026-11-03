const fs = require('fs');

console.log('=== VERIFYING POS CUSTOMER SELECTION FIXES ===\n');

// 1. Verify CSS rules
const css = fs.readFileSync('dashboard.css', 'utf8');
const posCustSelectMatches = css.match(/\.pos-customer-select\s*\{[^}]*\}/g) || [];
console.log('Found .pos-customer-select rules:', posCustSelectMatches.length);
posCustSelectMatches.forEach((rule, idx) => {
  console.log(`Rule ${idx + 1}:`);
  const hasOverflowHidden = /overflow\s*:\s*hidden/i.test(rule);
  const hasOverflowVisible = /overflow\s*:\s*visible/i.test(rule);
  console.log('  overflow:hidden?', hasOverflowHidden, '| overflow:visible?', hasOverflowVisible);
  if (hasOverflowHidden) {
    console.error('  ❌ ERROR: Found overflow: hidden in .pos-customer-select!');
  } else {
    console.log('  ✅ PASS: No overflow: hidden in .pos-customer-select');
  }
});

// 2. Verify dashboard.html dropdown structure
const html = fs.readFileSync('dashboard.html', 'utf8');
const hasDropdown = html.includes('id="pos-customer-dropdown"');
const hasClearBtn = html.includes('id="pos-customer-clear"');
const dropdownZIndex = html.includes('z-index: 999');
console.log('\nHTML checks:');
console.log('  pos-customer-dropdown exists?', hasDropdown ? '✅ PASS' : '❌ FAIL');
console.log('  pos-customer-clear exists?', hasClearBtn ? '✅ PASS' : '❌ FAIL');
console.log('  dropdown z-index 999?', dropdownZIndex ? '✅ PASS' : '❌ FAIL');

// 3. Verify dashboard.js search & select logic
const js = fs.readFileSync('dashboard.js', 'utf8');
const hasSafeFilter = js.includes("(c.name || '').toLowerCase()");
const hasSafePhone = js.includes("(c.phone || '').toLowerCase()");
const hasInitStateCheck = js.includes("document.readyState === 'loading'");
const hasClearHandler = js.includes('clearBtn?.addEventListener');

console.log('\nJS checks:');
console.log('  Safe name/type/phone filtering?', hasSafeFilter && hasSafePhone ? '✅ PASS' : '❌ FAIL');
console.log('  Safe DOM loading check?', hasInitStateCheck ? '✅ PASS' : '❌ FAIL');
console.log('  Clear button handler present?', hasClearHandler ? '✅ PASS' : '❌ FAIL');

console.log('\nResult: ALL CHECKS COMPLETED');

