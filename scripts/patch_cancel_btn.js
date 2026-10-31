const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'dashboard.html');
let content = fs.readFileSync(targetPath, 'utf8');

// Fix 1: Replace the cancel button in modal-edit-invoice footer
// Change class from btn-toolbar primary with rose-600 inline style to btn-toolbar danger
const oldBtn = '<button class="btn-toolbar primary"\r\n                        style="background: var(--rose-600); border-color: var(--rose-600); color: white;"\r\n                        onclick="cancelInvoice()">\r\n                        <i data-lucide="x-circle"></i> Cancel Invoice\r\n                    </button>';

const newBtn = '<button class="btn-toolbar danger"\r\n                        onclick="cancelInvoice()">\r\n                        <i data-lucide="x-circle"></i> Cancel Invoice\r\n                    </button>';

if (content.includes(oldBtn)) {
    content = content.replace(oldBtn, newBtn);
    console.log('✓ Patched Cancel Invoice button to use .btn-toolbar.danger class');
} else {
    console.log('! Old button not found, trying alternative...');
    // Try with LF line endings
    const oldBtnLF = '<button class="btn-toolbar primary"\n                        style="background: var(--rose-600); border-color: var(--rose-600); color: white;"\n                        onclick="cancelInvoice()">\n                        <i data-lucide="x-circle"></i> Cancel Invoice\n                    </button>';
    const newBtnLF = '<button class="btn-toolbar danger"\n                        onclick="cancelInvoice()">\n                        <i data-lucide="x-circle"></i> Cancel Invoice\n                    </button>';
    if (content.includes(oldBtnLF)) {
        content = content.replace(oldBtnLF, newBtnLF);
        console.log('✓ Patched with LF line endings');
    } else {
        // Fallback: regex replacement
        const btnRegex = /<button class="btn-toolbar primary"\s+style="background: var\(--rose-600\); border-color: var\(--rose-600\); color: white;"\s+onclick="cancelInvoice\(\)">([\s\S]*?)<\/button>/;
        if (btnRegex.test(content)) {
            content = content.replace(btnRegex, '<button class="btn-toolbar danger" onclick="cancelInvoice()">\r\n                        <i data-lucide="x-circle"></i> Cancel Invoice\r\n                    </button>');
            console.log('✓ Patched with regex fallback');
        } else {
            console.log('✗ FAILED: Could not find cancel invoice button');
        }
    }
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Done!');

