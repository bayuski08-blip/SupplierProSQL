const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'dashboard.js');
let content = fs.readFileSync(filePath, 'utf8');
// Normalize to LF for easier manipulation
let c = content.replace(/\r\n/g, '\n');

let patchCount = 0;

function patch(oldStr, newStr, label) {
    const oLF = oldStr.replace(/\r\n/g, '\n');
    const nLF = newStr.replace(/\r\n/g, '\n');
    if (c.includes(oLF)) {
        c = c.replace(oLF, nLF);
        patchCount++;
        console.log(`✓ Patched: ${label}`);
    } else {
        console.log(`✗ NOT FOUND: ${label}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. updateCartPrice – set manual_override = true
// ─────────────────────────────────────────────────────────────────────────────
patch(
`    window.updateCartPrice = (id, newPrice) => {
        const item = cart.find(c => c.id === id);
        if (item) {
            item.price = parseFloat(newPrice) || 0;
            renderCart();
        }
    };`,
`    window.updateCartPrice = (id, newPrice) => {
        const item = cart.find(c => c.id === id);
        if (item) {
            item.price = parseFloat(newPrice) || 0;
            item.manual_override = true; // R3: track manual edit
            // Re-render without full re-render so input focus is kept
        }
    };`,
'updateCartPrice manual_override'
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. renderCart cart-item-name – add source badge
// ─────────────────────────────────────────────────────────────────────────────
patch(
`                    <div class="cart-item-name">\${item.emoji} \${item.name}</div>
                    <div class="cart-item-price-edit" style="display:flex; align-items:center; gap:0.25rem;">
                        <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                        <input type="number" value="\${item.price}" onchange="updateCartPrice('\${item.id}', this.value)" style="width:70px; padding:0.1rem 0.25rem; font-size:0.875rem; border:1px solid var(--gray-200); border-radius:0.25rem;" />
                        <span style="font-size:0.75rem; color:var(--gray-500);">/ \${item.unit}</span>
                    </div>`,
`                    <div class="cart-item-name">
                        \${item.emoji} \${item.name}
                        \${item.manual_override ? '<span class="badge-manual-source" style="font-size:0.65rem; margin-left:4px;">✏️ Manual</span>' : (item.sumberHarga === 'pricelist' ? \`<span class="badge-pricelist-source" style="font-size:0.65rem; margin-left:4px;">\${item.pricelistNama || 'Pricelist'}</span>\` : '')}
                        \${(item.cost > 0 && item.price < item.cost) ? '<span class="badge-hpp-warning" style="font-size:0.65rem; margin-left:4px;">⚠️ Bawah HPP</span>' : ''}
                    </div>
                    <div class="cart-item-price-edit" style="display:flex; align-items:center; gap:0.25rem;">
                        <span style="font-size:0.75rem; color:var(--gray-500);">Rp</span>
                        <input type="number" value="\${item.price}" onchange="updateCartPrice('\${item.id}', this.value)" style="width:70px; padding:0.1rem 0.25rem; font-size:0.875rem; border:1px solid var(--gray-200); border-radius:0.25rem;" />
                        <span style="font-size:0.75rem; color:var(--gray-500);">/ \${item.unit}</span>
                    </div>`,
'renderCart badge for pricelist/manual/hpp'
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. POS customer dropdown – add handlePOSCustomerChange on click
// ─────────────────────────────────────────────────────────────────────────────
patch(
`            document.getElementById('pos-customer-search').value = name;
            document.getElementById('pos-customer-id').value = id;
            dropdown.style.display = 'none';`,
`            document.getElementById('pos-customer-search').value = name;
            document.getElementById('pos-customer-id').value = id;
            dropdown.style.display = 'none';
            handlePOSCustomerChange(id);`,
'populateCustomerSelect click -> handlePOSCustomerChange'
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Checkout reset – clear POS effective prices
// ─────────────────────────────────────────────────────────────────────────────
patch(
`            cart = [];
            document.getElementById('pos-customer-id').value = '';
            document.getElementById('pos-customer-search').value = '';`,
`            cart = [];
            currentPOSCustomerEffectivePrices = {};
            document.getElementById('pos-customer-id').value = '';
            document.getElementById('pos-customer-search').value = '';
            const posBadge = document.getElementById('pos-customer-pricelist-badge');
            if (posBadge) posBadge.innerHTML = '';`,
'checkout reset POS effective prices'
);

// ─────────────────────────────────────────────────────────────────────────────
// Write result
// ─────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, c.replace(/\n/g, '\r\n'), 'utf8');
console.log(`\nDone: ${patchCount} patches applied`);
