// Function to format Rupiah
function rp(amount) {
    if (amount === undefined || amount === null) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

// Function to get Auth Headers
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return {
        'Authorization': `Bearer ${token}`
    };
}

// Toast
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.background = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#3b82f6');
    toast.style.color = 'white';
    toast.style.padding = '1rem';
    toast.style.borderRadius = '0.5rem';
    toast.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    toast.style.marginBottom = '0.5rem';
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    
    toast.innerHTML = `<div style="display: flex; align-items: center; gap: 0.5rem;"><i data-lucide="${icon}"></i> <span>${message}</span></div>`;
    toastContainer.appendChild(toast);
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Handle close button
function closePrintTab() {
    window.close();
    // Fallback if browser prevents script from closing window
    setTimeout(() => {
        window.location.href = 'dashboard.html';
    }, 300);
}

// Main Logic
document.addEventListener('DOMContentLoaded', async () => {
    // Check Auth
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Get ID from query string
    const urlParams = new URLSearchParams(window.location.search);
    const invoiceId = urlParams.get('id');

    if (!invoiceId) {
        showToast('ID Invoice tidak ditemukan', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/print-data`, { headers: getAuthHeaders() });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                window.location.href = 'index.html';
                return;
            }
            throw new Error('Failed to load print data');
        }
        const data = await res.json();
        
        let currentPpnEnabled = true;
        try {
            const settingsRes = await fetch('/api/settings', { headers: getAuthHeaders() });
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                currentPpnEnabled = settingsData.ppn_enabled;
            }
        } catch(e) {}

        // Populate Company
        const comp = data.company;
        document.getElementById('print-company-name').textContent = comp.name || 'Nama Bisnis';
        document.getElementById('print-company-address').textContent = comp.address || '-';
        document.getElementById('print-company-email').textContent = comp.email || '-';
        document.getElementById('print-company-phone').textContent = comp.phone || '-';

        if (comp.logo) {
            document.getElementById('print-company-logo').src = comp.logo;
            document.getElementById('print-company-logo').style.display = 'block';
        } else {
            document.getElementById('print-company-logo').style.display = 'none';
        }

        // Populate Customer
        document.getElementById('print-customer-name').textContent = data.customer.name;
        document.getElementById('print-customer-address').textContent = data.customer.address || '-';

        // Populate Invoice
        const inv = data.invoice;
        document.getElementById('print-invoice-id').textContent = inv.id;
        // Format dates to DD/MM/YYYY
        const formatDate = (ds) => {
            if (!ds) return '-';
            const p = ds.split('-');
            if (p.length < 3) return ds;
            return `${p[2]}/${p[1]}/${p[0]}`;
        };
        document.getElementById('print-invoice-date').textContent = formatDate(inv.date);

        const trDueDate = document.getElementById('print-row-due-date');
        if (inv.payment_type_name && inv.payment_type_name.toLowerCase().includes('tempo')) {
            document.getElementById('print-invoice-due-date').textContent = formatDate(inv.due_date);
            trDueDate.style.display = 'table-row';
        } else {
            trDueDate.style.display = 'none';
        }

        document.getElementById('print-invoice-payment-type').textContent = inv.payment_type_name;

        // Items
        const tbody = document.getElementById('print-invoice-items');
        tbody.innerHTML = data.items.map((it, idx) => `
            <tr>
                <td style="border: 1px solid #000; padding: 0.5rem; text-align: center;">${idx + 1}</td>
                <td style="border: 1px solid #000; padding: 0.5rem;">${it.product_name}</td>
                <td style="border: 1px solid #000; padding: 0.5rem; text-align: center;">${it.unit_name}</td>
                <td style="border: 1px solid #000; padding: 0.5rem; text-align: center;">${it.quantity}</td>
                <td style="border: 1px solid #000; padding: 0.5rem; text-align: right;">${rp(it.price).replace('Rp', '').trim()}</td>
                <td style="border: 1px solid #000; padding: 0.5rem; text-align: right;">${rp(it.total).replace('Rp', '').trim()}</td>
            </tr>
        `).join('');

        // Totals
        const subtotal = inv.subtotal; // Use real subtotal from API
        document.getElementById('print-invoice-subtotal').textContent = rp(subtotal).replace('Rp', '').trim();
        document.getElementById('print-invoice-tax').textContent = rp(inv.tax).replace('Rp', '').trim();
        document.getElementById('print-invoice-grand-total').textContent = rp(inv.total).replace('Rp', '').trim();
        
        const taxRow = document.getElementById('print-invoice-tax').closest('tr');
        if (taxRow) {
            taxRow.style.display = currentPpnEnabled ? 'table-row' : 'none';
        }

    } catch (err) {
        console.error(err);
        showToast('Gagal menyiapkan print data', 'error');
    }
});
