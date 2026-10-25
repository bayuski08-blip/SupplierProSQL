const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'dashboard.js');
let content = fs.readFileSync(filePath, 'utf8');

const oldCode = `function addToCart(productId) {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return;

    const existing = cart.find(c => c.id === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        // Initialize with fee fields
        cart.push({ ...product, qty: 1, fee: 0, feeNotes: '' });
    }
    renderCart();
}`;

const newCode = `function addToCart(productId) {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return;

    const existing = cart.find(c => c.id === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        // Apply pricelist effective price if customer is selected
        const eff = currentPOSCustomerEffectivePrices[productId];
        const effectivePrice = eff ? parseFloat(eff.harga_efektif) : parseFloat(product.price);
        const sumberHarga = eff ? eff.sumber_harga : 'master';
        const pricelistNama = eff ? (eff.pricelist_nama || '') : '';
        const cost = parseFloat(product.cost_price || product.cost || 0);
        cart.push({
            ...product,
            price: effectivePrice,
            originalPrice: parseFloat(product.price),
            sumberHarga,
            pricelistNama,
            cost,
            manual_override: false,
            qty: 1,
            fee: 0,
            feeNotes: ''
        });
    }
    renderCart();
}`;

// Normalize CRLF -> LF for matching, then replace
const contentLF = content.replace(/\r\n/g, '\n');
const oldLF = oldCode.replace(/\r\n/g, '\n');
const newLF = newCode.replace(/\r\n/g, '\n');

if (contentLF.includes(oldLF)) {
    const patched = contentLF.replace(oldLF, newLF);
    // Write back with CRLF
    fs.writeFileSync(filePath, patched.replace(/\n/g, '\r\n'), 'utf8');
    console.log('addToCart patched successfully');
} else {
    console.log('Pattern not found!');
    // Show surrounding context
    const idx = contentLF.indexOf('function addToCart');
    console.log('Found at index:', idx);
    console.log('Context:', contentLF.substring(idx, idx + 400));
}
