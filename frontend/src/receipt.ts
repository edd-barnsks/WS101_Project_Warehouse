import { esc, formatServerDate, peso } from './api';

/* The printable sales receipt. It only builds HTML text from an order that the server already calculated:
   no totals are worked out here, so the paper always matches what was charged. Every value goes through esc(). */

export type ReceiptLine = { name: string; sku: string; qty: number; returned: number; unitPrice: number; lineTotal: number };
export type Receipt = {
  orderNo: string; reference: string; date: string; cashier: string; customer: string; lines: ReceiptLine[];
  subtotal: number; discountRate: number; discount: number; vatRate: number; vat: number; total: number;
  payment: { method: string; paid: number; change: number } | null;
};

export function buildReceiptHtml(r: Receipt): string {
  const meta: Array<[string, string]> = [['Order', r.orderNo]];
  if (r.reference) meta.push(['Reference', r.reference]);
  meta.push(['Date', formatServerDate(r.date, 'medium')], ['Cashier', r.cashier || '—'], ['Customer', r.customer || 'Walk-in customer']);

  const lines = r.lines.map((l) => `<tr>
      <td class="receipt-item"><span>${esc(l.name)}</span><small>${esc(l.sku)}${l.returned > 0 ? ` · ${l.returned} returned` : ''}</small></td>
      <td class="num">${l.qty}</td><td class="num">${peso(l.unitPrice)}</td><td class="num">${peso(l.lineTotal)}</td></tr>`).join('');

  const totals: Array<[string, string, string]> = [['Subtotal', peso(r.subtotal), '']];
  if (r.discount > 0) totals.push([`Discount (${r.discountRate}%)`, `-${peso(r.discount)}`, '']);
  totals.push([`VAT (${r.vatRate}%)`, peso(r.vat), ''], ['Total', peso(r.total), 'receipt-grand']);
  if (r.payment) {
    totals.push([`Paid (${r.payment.method})`, peso(r.payment.paid), 'receipt-first'], ['Change', peso(r.payment.change), '']);
  }

  const units = r.lines.reduce((sum, l) => sum + l.qty, 0);
  return `
    <div class="receipt-head"><strong>STOCKLOGGER</strong><span>Warehouse sales receipt</span></div>
    <dl class="receipt-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="receipt-rule"></div>
    <table class="receipt-lines"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="receipt-rule"></div>
    <dl class="receipt-totals">${totals.map(([k, v, cls]) => `<div class="${cls}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="receipt-rule"></div>
    <p class="receipt-foot">${units} ${units === 1 ? 'unit' : 'units'} · Thank you for your purchase.<br>Keep this receipt for returns.</p>`;
}
