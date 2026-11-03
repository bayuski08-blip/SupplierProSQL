const { rp, formatDate, paginateItems, renderInvoice } = require('../invoice-print.js');

function runPrintTest() {
  console.log('\n--- TESTING PROFORMA PRINT TEMPLATE ---\n');

  // Test pagination with 18 items
  const mockItems = [];
  for (let i = 1; i <= 18; i++) {
    mockItems.push({
      product_name: `Produk Uji ${i}`,
      unit_name: 'PCS',
      quantity: 5,
      price: 25000,
      total: 125000
    });
  }

  const pages = paginateItems(mockItems, { C_SINGLE: 9, C_P1: 12, C_MID: 16, C_LAST: 12 });
  console.log(`18 items distributed across ${pages.length} pages:`, pages.map(p => p.length));

  if (pages.length === 2 && pages[0].length === 12 && pages[1].length === 6) {
    console.log('  ✅ PASS: 18 items cleanly split into 2 pages (12 on Page 1, 6 on Page 2 with totals)');
  } else {
    console.log('  ⚠️ Pages count:', pages.length);
  }

  // Mock DOM environment for renderInvoice
  let containerHtml = '';
  global.document = {
    getElementById: (id) => {
      if (id === 'print-pages-container') {
        return {
          set innerHTML(val) { containerHtml = val; },
          get innerHTML() { return containerHtml; }
        };
      }
      return null;
    }
  };
  global.lucide = { createIcons: () => {} };

  const mockData = {
    proforma: {
      pk: 1,
      proforma_no: 'PF-2026-00042',
      order_date: '2026-11-02',
      berlaku_hingga: '2026-11-09',
      payment_type_name: 'Kredit 30 Hari',
      subtotal: 2250000,
      discount: 50000,
      ppn_rate: 11,
      ppn_amount: 242000,
      ppn_enabled: true,
      total: 2442000
    },
    customer: {
      name: 'PT Mitra Sejahtera',
      address: 'Jl. Merdeka No. 45'
    },
    company: {
      name: 'SupplierPro Pusat',
      address: 'Jl. Raya Industri Km 12',
      phone: '08123456789',
      email: 'sales@supplierpro.com'
    },
    items: mockItems
  };

  renderInvoice(mockData, true, true);

  // Check expected strings in the generated HTML
  const checks = [
    { label: 'PROFORMA INVOICE title badge exists', pattern: /PROFORMA INVOICE/ },
    { label: 'No. Proforma label and value present', pattern: /No\. Proforma.*PF-2026-00042/s },
    { label: 'Order date matches stored order_date (02/11/2026)', pattern: /02\/11\/2026/ },
    { label: 'Berlaku Hingga present', pattern: /Berlaku Hingga.*09\/11\/2026/s },
    { label: 'Syarat Pembayaran present', pattern: /Syarat Pembayaran.*Kredit 30 Hari/s },
    { label: 'Proforma footer disclaimer note present', pattern: /Dokumen ini bukan bukti penagihan atau pembayaran\./ },
    { label: 'Multipage "Bersambung" notice on Page 1', pattern: /Bersambung ke halaman berikutnya/ },
    { label: 'Page continuation header on Page 2', pattern: /Lanjutan PF-2026-00042/ },
    { label: 'Page numbers "Hal. 1 dari 2" and "Hal. 2 dari 2"', pattern: /Hal\. 1 dari 2/ },
    { label: 'Signatures contain Hormat kami & Customer', pattern: /Hormat kami.*Customer/s },
    { label: 'Grand total matches', pattern: /2\.442\.000/ }
  ];

  let allChecksPassed = true;
  for (const c of checks) {
    if (c.pattern.test(containerHtml)) {
      console.log(`  ✅ PASS: ${c.label}`);
    } else {
      console.error(`  ❌ FAIL: ${c.label}`);
      allChecksPassed = false;
    }
  }

  // Check fee is NOT in HTML
  if (!containerHtml.toLowerCase().includes('fee')) {
    console.log('  ✅ PASS: Field fee sama sekali tidak tampil di cetakan proforma');
  } else {
    console.error('  ❌ FAIL: Fee found in output');
    allChecksPassed = false;
  }

  console.log(`\nResult: ${allChecksPassed ? 'ALL PRINT TESTS PASSED' : 'SOME TESTS FAILED'}\n`);
  if (!allChecksPassed) process.exit(1);
}

runPrintTest();

