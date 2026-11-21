const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'dashboard.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Backup
fs.writeFileSync(cssPath + '.bak_batch_b', css, 'utf8');

const batchBCss = `
/* =========================================================================
   BATCH B: MODAL STACKING, RETUR, DAN STOCK MOVE STYLES
   ========================================================================= */

body.modal-open {
    overflow: hidden !important;
}

/* Modal Stacking Support */
.modal-overlay.active {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Return condition badges */
.badge-status.kembali_ke_stok {
    background: #d1fae5;
    color: #047857;
    border: 1px solid #a7f3d0;
}

.badge-status.rusak {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
}

/* Stock Move Type badges */
.badge-status.penjualan {
    background: #e0f2fe;
    color: #0369a1;
}

.badge-status.pembelian {
    background: #dcfce7;
    color: #15803d;
}

.badge-status.opname {
    background: #fef3c7;
    color: #b45309;
}

.badge-status.retur_penjualan {
    background: #fef08a;
    color: #854d0e;
    font-weight: 600;
}

.badge-status.retur_penjualan_rusak {
    background: #fecdd3;
    color: #9f1239;
    font-weight: 600;
}

.badge-status.retur_pembelian {
    background: #fed7aa;
    color: #9a3412;
    font-weight: 600;
}

.badge-status.cancel_invoice {
    background: #f1f5f9;
    color: #475569;
}

.badge-status.koreksi_edit {
    background: #e2e8f0;
    color: #334155;
}

.badge-status.stok_awal {
    background: #ede9fe;
    color: #6d28d9;
}

/* Return indicator pill on invoice/PO rows */
.badge-retur-indicator {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
    font-size: 0.72rem;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    display: inline-block;
    margin-top: 3px;
}
`;

if (!css.includes('BATCH B: MODAL STACKING')) {
  css += '\n' + batchBCss;
  fs.writeFileSync(cssPath, css, 'utf8');
  console.log('Appended Batch B CSS rules to dashboard.css');
} else {
  console.log('Batch B CSS rules already present, skipping.');
}

