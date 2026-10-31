const PDFDocument = require('pdfkit');
const fs = require('fs');

function formatRp(num) {
  return 'Rp ' + Math.round(parseFloat(num) || 0).toLocaleString('id-ID');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr).split('T')[0];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function generatePiutangPDF(companyName, records, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
      bufferPages: true
    });

    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    const printDate = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    // Page dimensions
    const pageWidth = doc.page.width; // ~841.89
    const pageHeight = doc.page.height; // ~595.28
    const margin = 36;
    const contentWidth = pageWidth - (margin * 2); // ~769.89

    // Table Column Widths (Total: 765)
    // Nama Customer (170), No. Invoice (115), Tanggal (80), Jatuh Tempo (80), Total (110), Dibayar (105), Sisa (105)
    const cols = [
      { id: 'customer', label: 'Nama Customer', width: 170, align: 'left' },
      { id: 'invoice_id', label: 'No. Invoice', width: 115, align: 'left' },
      { id: 'date', label: 'Tgl Invoice', width: 80, align: 'center' },
      { id: 'due_date', label: 'Jatuh Tempo', width: 80, align: 'center' },
      { id: 'total', label: 'Total Invoice', width: 110, align: 'right' },
      { id: 'paid', label: 'Sudah Dibayar', width: 105, align: 'right' },
      { id: 'sisa', label: 'Sisa Piutang', width: 105, align: 'right' }
    ];

    let currentY = 36;

    function renderHeader() {
      doc.save();
      // Title & Company
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#1e293b')
        .text('LAPORAN PIUTANG', margin, currentY, { align: 'left' });
      
      doc.font('Helvetica').fontSize(10).fillColor('#64748b')
        .text(`Unit Usaha: ${companyName}`, margin, currentY + 20, { align: 'left' });

      doc.fontSize(9).fillColor('#64748b')
        .text(`Tanggal Cetak: ${printDate}`, margin, currentY + 20, { align: 'right', width: contentWidth });

      currentY += 40;

      // Table Header Box
      doc.rect(margin, currentY, contentWidth, 24).fill('#f1f5f9');
      doc.rect(margin, currentY, contentWidth, 24).stroke('#cbd5e1');

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155');
      let curX = margin;
      cols.forEach(col => {
        doc.text(col.label, curX + 4, currentY + 7, { width: col.width - 8, align: col.align });
        curX += col.width;
      });

      currentY += 24;
      doc.restore();
    }

    renderHeader();

    // Group records by Customer
    const grouped = {};
    records.forEach(r => {
      const cust = r.customer_name || 'Tanpa Pelanggan';
      if (!grouped[cust]) grouped[cust] = [];
      grouped[cust].push(r);
    });

    const isMultiCustomer = Object.keys(grouped).length > 1;
    let grandTotal = 0;
    let grandPaid = 0;
    let grandSisa = 0;

    const rowHeight = 20;

    for (const custName of Object.keys(grouped)) {
      const items = grouped[custName];
      let subTotal = 0;
      let subPaid = 0;
      let subSisa = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const tot = parseFloat(item.total) || 0;
        const pd = parseFloat(item.paid_amount) || 0;
        const rem = Math.max(0, tot - pd);

        subTotal += tot;
        subPaid += pd;
        subSisa += rem;

        grandTotal += tot;
        grandPaid += pd;
        grandSisa += rem;

        // Check page break
        if (currentY + rowHeight > pageHeight - 50) {
          doc.addPage();
          currentY = 36;
          renderHeader();
        }

        // Alternate row background
        if (i % 2 === 1) {
          doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f8fafc');
        }
        // Border bottom
        doc.moveTo(margin, currentY + rowHeight).lineTo(margin + contentWidth, currentY + rowHeight).strokeColor('#e2e8f0').stroke();

        doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');
        let curX = margin;

        // Customer Name (only show on first row of group if multi-customer, or on each row)
        doc.text(custName, curX + 4, currentY + 5, { width: cols[0].width - 8, align: cols[0].align, lineBreak: false });
        curX += cols[0].width;

        doc.text(String(item.id), curX + 4, currentY + 5, { width: cols[1].width - 8, align: cols[1].align });
        curX += cols[1].width;

        doc.text(formatDate(item.date), curX + 4, currentY + 5, { width: cols[2].width - 8, align: cols[2].align });
        curX += cols[2].width;

        doc.text(formatDate(item.due_date), curX + 4, currentY + 5, { width: cols[3].width - 8, align: cols[3].align });
        curX += cols[3].width;

        doc.text(formatRp(tot), curX + 4, currentY + 5, { width: cols[4].width - 8, align: cols[4].align });
        curX += cols[4].width;

        doc.text(formatRp(pd), curX + 4, currentY + 5, { width: cols[5].width - 8, align: cols[5].align });
        curX += cols[5].width;

        doc.font('Helvetica-Bold').fillColor(rem > 0 ? '#b91c1c' : '#059669')
          .text(formatRp(rem), curX + 4, currentY + 5, { width: cols[6].width - 8, align: cols[6].align });

        currentY += rowHeight;
      }

      // If multi-customer, print subtotal row
      if (isMultiCustomer) {
        if (currentY + rowHeight > pageHeight - 50) {
          doc.addPage();
          currentY = 36;
          renderHeader();
        }

        doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f1f5f9');
        doc.rect(margin, currentY, contentWidth, rowHeight).stroke('#cbd5e1');

        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155');
        const labelWidth = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
        doc.text(`Subtotal ${custName}:`, margin + 4, currentY + 5, { width: labelWidth - 8, align: 'right' });

        let curX = margin + labelWidth;
        doc.text(formatRp(subTotal), curX + 4, currentY + 5, { width: cols[4].width - 8, align: cols[4].align });
        curX += cols[4].width;
        doc.text(formatRp(subPaid), curX + 4, currentY + 5, { width: cols[5].width - 8, align: cols[5].align });
        curX += cols[5].width;
        doc.fillColor('#b91c1c').text(formatRp(subSisa), curX + 4, currentY + 5, { width: cols[6].width - 8, align: cols[6].align });

        currentY += rowHeight + 4;
      }
    }

    // Grand Total Row
    if (currentY + 24 > pageHeight - 50) {
      doc.addPage();
      currentY = 36;
      renderHeader();
    }

    doc.rect(margin, currentY, contentWidth, 24).fill('#e2e8f0');
    doc.rect(margin, currentY, contentWidth, 24).stroke('#94a3b8');

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
    const labelWidth = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
    doc.text('TOTAL KESELURUHAN:', margin + 4, currentY + 7, { width: labelWidth - 8, align: 'right' });

    let curX = margin + labelWidth;
    doc.text(formatRp(grandTotal), curX + 4, currentY + 7, { width: cols[4].width - 8, align: cols[4].align });
    curX += cols[4].width;
    doc.text(formatRp(grandPaid), curX + 4, currentY + 7, { width: cols[5].width - 8, align: cols[5].align });
    curX += cols[5].width;
    doc.fillColor('#b91c1c').text(formatRp(grandSisa), curX + 4, currentY + 7, { width: cols[6].width - 8, align: cols[6].align });

    // Page Numbers in Footer
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(p);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
        .text(`Halaman ${p + 1} dari ${range.count}`, margin, pageHeight - 26, {
          width: contentWidth,
          align: 'center'
        });
    }

    doc.end();
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

// Test with sample data
const sampleData = [
  { id: 'INV-2026-001', customer_name: 'CV Makmur Sejahtera', date: '2026-10-01', due_date: '2026-10-31', total: 5000000, paid_amount: 2000000 },
  { id: 'INV-2026-002', customer_name: 'CV Makmur Sejahtera', date: '2026-10-15', due_date: '2026-11-14', total: 3500000, paid_amount: 0 },
  { id: 'INV-2026-003', customer_name: 'PT Bintang Terang', date: '2026-10-05', due_date: '2026-11-04', total: 12000000, paid_amount: 6000000 }
];

generatePiutangPDF('SupplierPro Demo', sampleData, 'test_output_piutang.pdf')
  .then(() => console.log('Sample PDF created successfully: test_output_piutang.pdf'))
  .catch(console.error);

