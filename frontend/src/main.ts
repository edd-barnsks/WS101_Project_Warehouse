import { enablePasswordToggles } from './password-toggle';
import './style.css';
import { COLS, SLOTS, createScene } from './scene';
import {
  ApiError, api, downloadCsv, esc, fetchAll, formatServerDate, getSession, goToLogin, humanize, isoDate, peso, percentOfCents, qs,
  removeLegacyCredentials, roleLabel, toBackendRole, toCents, toRole, updateSession, type CsvCell, type ListResult, type Role,
} from './api';
import { buildReceiptHtml, type Receipt } from './receipt';
import { drawBarChart, type ChartPoint } from './report-chart';

enablePasswordToggles();
removeLegacyCredentials();   // the first version of this app kept plain-text passwords in localStorage

/* ---------- auth guard: no valid login on this tab -> back to the login page ---------- */
const startSession = getSession();
if (!startSession) { goToLogin(); throw new Error('Not signed in: redirecting to the login page.'); }
let session = startSession;
const isAdmin = session.role === 'admin';

/* ---------- types ---------- */
type Item = {
  id: number; sku: string; name: string; qty: number; slot: number | null; price: number; category: string; categoryId: number | null;
  size: string; unit: string; reorder: number;
};
/** Low stock means fewer units than the product's own low-stock level (each product has its own). */
const isLow = (item: Pick<Item, 'qty' | 'reorder'>) => item.qty < item.reorder;
type Log = { id: number; time: string; sku: string; type: 'IN' | 'OUT'; qty: number; note: string };
type Move = 'IN' | 'OUT';
type SaleLine = { id: number; productId: number; sku: string; name: string; qty: number; returned: number; unitPrice: number };
type Sale = { id: number; orderNo: string; time: string; customer: string; reference: string; lines: SaleLine[]; total: number };
type ReturnEntry = { id: number; saleId: number; label: string; sku: string; product: string; qty: number; reason: string; handledBy: string; status: 'Subject for review' | 'Reviewed'; time: string };
type User = { id: number; username: string; role: Role; firstName: string; lastName: string; email: string; active: boolean };
type Supplier = { id: number; name: string; contactPerson: string; phone: string; email: string; address: string; active: boolean };
type Category = { id: number; name: string; products: number };
type AuditEntry = { id: number; createdAt: string; handledBy: string; module: string; action: string; description: string; ipAddress: string };

/* What the API sends (PascalCase column names) */
type ApiProduct = {
  ProductID: number; SKU: string; ProductName: string; CategoryID: number | null; Category: string | null; Size: string | null; Price: string;
  RackSlot: number | null; ReorderLevel: number | string; StockQuantity: number | null; Unit: string | null;
};
type ApiMovement = { MovementID: number; CreatedAt: string; MovementType: Move; Quantity: number; Note: string | null; SKU: string };
type ApiOrderItem = { OrderItemID: number; ProductID: number; SKU: string; ProductName: string; Quantity: number; UnitPrice: string; LineTotal: string; ReturnedQuantity: number };
type ApiOrder = {
  OrderID: number; OrderNo: string; OrderDate: string; CustomerName: string | null; Reference: string | null; Total: string; items: ApiOrderItem[];
  Subtotal: string; DiscountRate: string; DiscountAmount: string; VatRate: string; VatAmount: string; StaffName: string;
};
type ApiTransaction = { TransactionDate: string; AmountPaid: string; PaymentMethod: string; Change: string };
type ReceiptOrder = ApiOrder & { transaction?: ApiTransaction | null };
type ApiReturn = { ReturnID: number; CreatedAt: string; Quantity: number; Reason: string; Status: ReturnEntry['status']; OrderID: number; OrderNo: string; Reference: string | null; SKU: string; ProductName: string; HandledBy: string };
type ApiStaff = { StaffID: number; FirstName: string; LastName: string; Email: string | null; Username: string; Role: string; IsActive: number | boolean };
type ApiSupplier = { SupplierID: number; SupplierName: string; ContactPerson: string; Phone: string; Email: string; Address: string; IsActive: number | boolean };
type ApiCategory = { CategoryID: number; CategoryName: string; ProductCount: number };
type ApiAudit = { AuditID: number; CreatedAt: string; HandledBy: string; Module: string; Action: string; Description: string; IpAddress: string };

const mapItem = (p: ApiProduct): Item => ({
  id: Number(p.ProductID), sku: p.SKU, name: p.ProductName, qty: Number(p.StockQuantity ?? 0),
  slot: p.RackSlot === null || p.RackSlot === undefined ? null : Number(p.RackSlot),
  price: Number(p.Price), category: p.Category ?? '', categoryId: p.CategoryID === null ? null : Number(p.CategoryID),
  size: p.Size ?? '', unit: p.Unit ?? 'pcs', reorder: Number(p.ReorderLevel ?? 10),
});
const mapLog = (m: ApiMovement): Log => ({ id: Number(m.MovementID), time: m.CreatedAt, sku: m.SKU, type: m.MovementType, qty: Number(m.Quantity), note: m.Note ?? '' });
const mapSale = (o: ApiOrder): Sale => ({
  id: Number(o.OrderID), orderNo: o.OrderNo, time: o.OrderDate, customer: o.CustomerName ?? '', reference: o.Reference ?? '', total: Number(o.Total),
  lines: o.items.map((l) => ({ id: Number(l.OrderItemID), productId: Number(l.ProductID), sku: l.SKU, name: l.ProductName, qty: Number(l.Quantity), returned: Number(l.ReturnedQuantity), unitPrice: Number(l.UnitPrice) })),
});
const mapReturn = (r: ApiReturn): ReturnEntry => ({
  id: Number(r.ReturnID), saleId: Number(r.OrderID), label: r.Reference || r.OrderNo, sku: r.SKU, product: r.ProductName, qty: Number(r.Quantity),
  reason: r.Reason, handledBy: r.HandledBy, status: r.Status, time: r.CreatedAt,
});
const mapUser = (s: ApiStaff): User => ({
  id: Number(s.StaffID), username: s.Username, role: toRole(s.Role), firstName: s.FirstName, lastName: s.LastName, email: s.Email ?? '', active: Number(s.IsActive) === 1 || s.IsActive === true,
});
const mapSupplier = (s: ApiSupplier): Supplier => ({
  id: Number(s.SupplierID), name: s.SupplierName, contactPerson: s.ContactPerson, phone: s.Phone, email: s.Email, address: s.Address, active: Number(s.IsActive) === 1 || s.IsActive === true,
});
const mapCategory = (c: ApiCategory): Category => ({ id: Number(c.CategoryID), name: c.CategoryName, products: Number(c.ProductCount) });
const mapAudit = (a: ApiAudit): AuditEntry => ({
  id: Number(a.AuditID), createdAt: a.CreatedAt, handledBy: a.HandledBy, module: a.Module, action: a.Action, description: a.Description, ipAddress: a.IpAddress,
});

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

/** Turns any error into a short sentence for the on-screen message areas. */
function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409 && typeof err.details.available === 'number') {
      return `Only ${err.details.available} units${typeof err.details.sku === 'string' ? ` of ${err.details.sku}` : ''} on hand. Lower the quantity.`;
    }
    return humanize(err.message);
  }
  return 'Something went wrong. Please try again.';
}

/** Disables a button while its request is running so a double click can't send things twice. */
async function busy(button: HTMLButtonElement | null | undefined, work: () => Promise<void>) {
  if (button) button.disabled = true;
  try { await work(); } finally { if (button) button.disabled = false; }
}

/* ---------- state ---------- */
let items: Item[] = [];
let logs: Log[] = [];
let salesStats = { orders: 0, sold: 0, returned: 0 };
let recentSales: Sale[] = [];
let historySales: Sale[] = [];
let historyTotal = 0;
let historyLimit = 20;
let returnEntries: ReturnEntry[] = [];
let suppliers: Supplier[] = [];
let categories: Category[] = [];
let users: User[] = [];
let auditEntries: AuditEntry[] = [];
let auditTotal = 0;
let vatRate = 12;
let type: Move = 'IN';

/* ---------- data loading ---------- */
async function loadItems() { items = (await fetchAll<ApiProduct>('/products')).map(mapItem); }
async function loadMovements() { logs = (await api<ListResult<ApiMovement>>('GET', '/movements' + qs({ limit: 50 }))).data.map(mapLog); }
async function loadCategories() { categories = (await fetchAll<ApiCategory>('/categories')).map(mapCategory); fillCategorySelect(); }
async function loadSuppliers() { suppliers = (await fetchAll<ApiSupplier>('/suppliers')).map(mapSupplier); }
async function loadUsers() { users = (await fetchAll<ApiStaff>('/staff')).map(mapUser); }
async function loadReturns() { returnEntries = (await api<ListResult<ApiReturn>>('GET', '/returns' + qs({ limit: 50 }))).data.map(mapReturn); }
async function loadSalesSummary() {
  const s = await api<{ OrderCount: number; UnitsSold: number; UnitsReturned: number }>('GET', '/orders/summary');
  salesStats = { orders: s.OrderCount, sold: s.UnitsSold, returned: s.UnitsReturned };
}
async function loadRecentSales() { recentSales = (await api<ListResult<ApiOrder>>('GET', '/orders' + qs({ status: 'Completed', limit: 5 }))).data.map(mapSale); }
async function loadHistory() {
  const res = await api<ListResult<ApiOrder>>('GET', '/orders' + qs({ status: 'Completed', limit: historyLimit, search: ($<HTMLInputElement>('#returnSearch')?.value ?? '').trim() }));
  historySales = res.data.map(mapSale);
  historyTotal = res.total;
}
/** Everything the Sales page shows, for whichever tab is open. */
async function loadSalesData() {
  await Promise.all([
    loadSalesSummary(),
    salesMode === 'pos' ? loadRecentSales() : Promise.all([loadHistory(), loadReturns()]),
  ]);
}

/* ---------- 3D scene ---------- */
const scene3d = createScene($<HTMLDivElement>('#scene'), $<HTMLDivElement>('#tip'), () => items, (sku) => {
  $<HTMLInputElement>('#sku').value = sku; updateSkuHint(); $<HTMLInputElement>('#qty').focus();
});
const resize = scene3d.resize;

/* ---------- UI ---------- */
const msg = $<HTMLParagraphElement>('#msg');
const say = (t: string, ok = false) => { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); };
const setUsersMessage = (id: string, text: string, kind: 'ok' | 'err' | '' = '') => {
  const el = $(`#${id}`); if (!el) return;
  el.textContent = text; el.className = `users-message${kind ? ' ' + kind : ''}`;
};

function renderUI() {
  const units = items.reduce((a, i) => a + i.qty, 0);
  $('#stats').innerHTML = [
    ['SKUs', items.length], ['Units on hand', units], ['Low stock', items.filter(isLow).length],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  $('#skus').innerHTML = items.map((i) => `<option value="${esc(i.sku)}">${esc(i.name)}</option>`).join('');

  $('#log').innerHTML = logs.length
    ? `<thead><tr><th>Time</th><th>Type</th><th>SKU</th><th style="text-align:right">Qty</th><th>Note</th></tr></thead><tbody>` +
      logs.slice(0, 50).map((l) => `<tr><td>${esc(formatServerDate(l.time))}</td><td><span class="tag ${l.type === 'IN' ? 'IN' : 'OUT'}">${l.type === 'IN' ? 'IN' : 'OUT'}</span></td>
        <td>${esc(l.sku)}</td><td class="num">${l.qty}</td><td>${esc(l.note)}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">Nothing logged yet.</td></tr></tbody>';

  scene3d.sync();
  updateSkuHint();
  renderProducts();
  renderSales();
  renderSuppliers();
  renderCategories();
  renderUsers();
  renderAuditLogs();
}

function fillCategorySelect() {
  const select = $<HTMLSelectElement>('#category');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Uncategorized</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  select.value = categories.some((c) => String(c.id) === current) ? current : '';
}

/* ---------- Users (Admin) ---------- */
let userSort: { field: keyof Pick<User, 'username' | 'role' | 'email' | 'lastName'>; direction: 1 | -1 } = { field: 'username', direction: 1 };
let userPage = 1;
const USERS_PER_PAGE = 10;
function renderUsers() {
  const table = $('#usersTable');
  if (!table || !isAdmin) return;
  const search = ($<HTMLInputElement>('#userSearch')?.value ?? '').trim().toLowerCase();
  const visible = users.filter((user) => user.username.toLowerCase().includes(search)).sort((a, b) => {
    const av = userSort.field === 'lastName' ? a.lastName : a[userSort.field];
    const bv = userSort.field === 'lastName' ? b.lastName : b[userSort.field];
    return String(av).localeCompare(String(bv)) * userSort.direction;
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / USERS_PER_PAGE));
  userPage = Math.min(userPage, pageCount);
  const pageUsers = visible.slice((userPage - 1) * USERS_PER_PAGE, userPage * USERS_PER_PAGE);
  const count = $('#userCount');
  if (count) count.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;
  const headers: Array<[string, string]> = [['username', 'Username'], ['role', 'Role'], ['email', 'Email'], ['lastName', 'Last name']];
  table.innerHTML = pageUsers.length
    ? `<thead><tr>${headers.map(([field, label]) => `<th><button type="button" class="user-sort" data-user-sort="${field}">${label}<span aria-hidden="true">${userSort.field === field ? (userSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Status</th><th class="user-actions-heading">Actions</th></tr></thead><tbody>${pageUsers.map((user) => `<tr>
        <td class="user-name-cell">${esc(user.username)}</td><td>${roleLabel(user.role)}</td><td>${esc(user.email)}</td><td>${esc(user.lastName)}</td>
        <td><span class="user-status ${user.active ? 'is-active' : 'is-inactive'}">${user.active ? 'Active' : 'Inactive'}</span></td>
        <td class="user-actions"><button type="button" class="user-edit" data-edit-user="${user.id}" aria-label="Edit ${esc(user.username)}" title="Edit user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button type="button" class="user-delete" data-delete-user="${user.id}" aria-label="Delete ${esc(user.username)}" title="Delete user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td>
      </tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="6">${users.length ? 'No users match that username.' : 'No users have been added yet.'}</td></tr></tbody>`;
  const pagination = $('#usersPagination');
  if (pagination) {
    const from = visible.length ? (userPage - 1) * USERS_PER_PAGE + 1 : 0;
    const to = Math.min(userPage * USERS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-user-page="prev" ${userPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${userPage} of ${pageCount}</span><button type="button" data-user-page="next" ${userPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

/* ---------- Suppliers (Admin) ---------- */
let supplierSort: { field: keyof Pick<Supplier, 'name' | 'contactPerson' | 'phone' | 'email' | 'address'>; direction: 1 | -1 } = { field: 'name', direction: 1 };
let supplierPage = 1;
const SUPPLIERS_PER_PAGE = 10;
function renderSuppliers() {
  const table = $('#suppliersTable');
  if (!table || !isAdmin) return;
  const search = ($<HTMLInputElement>('#supplierSearch')?.value ?? '').trim().toLowerCase();
  const visible = suppliers.filter((supplier) => supplier.name.toLowerCase().includes(search)).sort((a, b) =>
    a[supplierSort.field].localeCompare(b[supplierSort.field]) * supplierSort.direction);
  const pageCount = Math.max(1, Math.ceil(visible.length / SUPPLIERS_PER_PAGE));
  supplierPage = Math.min(supplierPage, pageCount);
  const pageSuppliers = visible.slice((supplierPage - 1) * SUPPLIERS_PER_PAGE, supplierPage * SUPPLIERS_PER_PAGE);
  const columns: Array<[typeof supplierSort.field, string]> = [
    ['name', 'Name'], ['contactPerson', 'Contact Person'], ['phone', 'Phone Number'], ['email', 'Email'], ['address', 'Address'],
  ];
  table.innerHTML = pageSuppliers.length
    ? `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-supplier-sort="${field}">${label}<span aria-hidden="true">${supplierSort.field === field ? (supplierSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>Status</th></tr></thead><tbody>${pageSuppliers.map((supplier) => `<tr>
        <td><button type="button" class="supplier-name-button" data-edit-supplier="${supplier.id}">${esc(supplier.name)}</button></td>
        <td class="supplier-contact-cell" title="${esc(supplier.contactPerson)}">${esc(supplier.contactPerson)}</td><td>${esc(supplier.phone)}</td><td>${esc(supplier.email)}</td><td>${esc(supplier.address)}</td>
        <td><button type="button" class="user-status ${supplier.active ? 'is-active' : 'is-inactive'}" data-toggle-supplier="${supplier.id}" aria-label="Set ${esc(supplier.name)} ${supplier.active ? 'inactive' : 'active'}">${supplier.active ? 'Active' : 'Inactive'}</button></td>
      </tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="6">${suppliers.length ? 'No suppliers match that name.' : 'No suppliers yet. Add your first supplier to get started.'}</td></tr></tbody>`;
  const pagination = $('#suppliersPagination');
  if (pagination) {
    const from = visible.length ? (supplierPage - 1) * SUPPLIERS_PER_PAGE + 1 : 0;
    const to = Math.min(supplierPage * SUPPLIERS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-supplier-page="prev" ${supplierPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${supplierPage} of ${pageCount}</span><button type="button" data-supplier-page="next" ${supplierPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

/* ---------- Categories (Admin) ---------- */
let categorySortDirection: 1 | -1 = 1;
let categoryPage = 1;
const CATEGORIES_PER_PAGE = 7;
function renderCategories() {
  const table = $('#categoriesTable');
  if (!table || !isAdmin) return;
  const search = ($<HTMLInputElement>('#categorySearch')?.value ?? '').trim().toLowerCase();
  const visible = categories.filter((category) => category.name.toLowerCase().includes(search)).sort((a, b) => a.name.localeCompare(b.name));
  if (categorySortDirection === -1) visible.reverse();
  const pageCount = Math.max(1, Math.ceil(visible.length / CATEGORIES_PER_PAGE));
  categoryPage = Math.min(categoryPage, pageCount);
  const pageCategories = visible.slice((categoryPage - 1) * CATEGORIES_PER_PAGE, categoryPage * CATEGORIES_PER_PAGE);
  table.innerHTML = pageCategories.length
    ? `<thead><tr><th><button type="button" class="user-sort" data-category-sort>Name<span aria-hidden="true">${categorySortDirection === 1 ? '↕' : '↓'}</span></button></th><th class="user-actions-heading">Actions</th></tr></thead><tbody>${pageCategories.map((category) => `<tr><td>${esc(category.name)}</td><td class="user-actions"><button type="button" class="user-edit" data-edit-category="${category.id}" aria-label="Edit ${esc(category.name)}" title="Edit category"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button type="button" class="user-delete" data-delete-category="${category.id}" aria-label="Delete ${esc(category.name)}" title="Delete category"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td></tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="users-empty" colspan="2">${categories.length ? 'No categories match your search.' : 'No categories yet. Add a category to get started.'}</td></tr></tbody>`;
  const pagination = $('#categoriesPagination');
  if (pagination) {
    pagination.innerHTML = `<div class="users-pagination-actions"><button type="button" data-category-page="prev" ${categoryPage <= 1 ? 'disabled' : ''}>Previous</button><button type="button" data-category-page="next" ${categoryPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

/* ---------- Audit logs (Admin). Sorted, filtered and paged by the server. ---------- */
let auditSort: { field: keyof AuditEntry; direction: 1 | -1 } = { field: 'createdAt', direction: -1 };
let auditPage = 1;
const AUDIT_PAGE_SIZE = 10;
const AUDIT_SORT_KEYS: Partial<Record<keyof AuditEntry, string>> = {
  createdAt: 'created_at', handledBy: 'handled_by', module: 'module', action: 'action', description: 'description', ipAddress: 'ip_address',
};
const auditDate = (value: string) => formatServerDate(value);
let auditRequest = 0;
async function loadAudit() {
  const ticket = ++auditRequest;   // ignore answers that arrive after a newer request was sent
  const res = await api<ListResult<ApiAudit>>('GET', '/audit-logs' + qs({
    search: ($<HTMLInputElement>('#auditSearch')?.value ?? '').trim(),
    sort: AUDIT_SORT_KEYS[auditSort.field] ?? 'created_at', dir: auditSort.direction === 1 ? 'asc' : 'desc',
    page: auditPage, limit: AUDIT_PAGE_SIZE,
  }));
  if (ticket !== auditRequest) return;
  auditEntries = res.data.map(mapAudit);
  auditTotal = res.total;
  renderAuditLogs();
}
function renderAuditLogs() {
  const table = $('#auditTable');
  if (!table || !isAdmin) return;
  const pageCount = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
  const columns: Array<[keyof AuditEntry, string]> = [
    ['createdAt', 'Created at'], ['handledBy', 'Handled by'], ['module', 'Module'], ['action', 'Action'], ['description', 'Description'], ['ipAddress', 'IP Address'],
  ];
  const head = `<thead><tr>${columns.map(([field, label]) => `<th><button type="button" class="user-sort" data-audit-sort="${field}">${label}<span aria-hidden="true">${auditSort.field === field ? (auditSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th class="audit-actions-heading">Actions</th></tr></thead>`;
  table.innerHTML = auditEntries.length
    ? `${head}<tbody>${auditEntries.map((entry) => `<tr>
        <td>${esc(auditDate(entry.createdAt))}</td><td>${esc(entry.handledBy)}</td><td><span class="audit-module-tag">${esc(entry.module)}</span></td><td>${esc(entry.action)}</td>
        <td class="audit-description-cell" title="${esc(entry.description)}">${esc(entry.description)}</td><td>${esc(entry.ipAddress || '—')}</td>
        <td class="audit-actions-cell"><button type="button" class="audit-view-button" data-audit-detail="${entry.id}" aria-label="View audit details">View</button></td>
      </tr>`).join('')}</tbody>`
    : `${head}<tbody><tr><td class="audit-no-results" colspan="7">No results.</td></tr></tbody>`;
  const pagination = $('#auditPagination');
  if (pagination) {
    const from = auditTotal ? (auditPage - 1) * AUDIT_PAGE_SIZE + 1 : 0;
    const to = Math.min(auditPage * AUDIT_PAGE_SIZE, auditTotal);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${auditTotal}</span><div class="users-pagination-actions"><button type="button" data-audit-page="prev" ${auditPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${auditPage} of ${pageCount}</span><button type="button" data-audit-page="next" ${auditPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

let auditTimer: number | undefined;
$('#auditSearch')?.addEventListener('input', () => {
  window.clearTimeout(auditTimer);
  auditTimer = window.setTimeout(() => { auditPage = 1; void loadAudit().catch(() => undefined); }, 250);
});
$('#auditTable')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-audit-sort]');
  if (sort) {
    const field = sort.dataset.auditSort as keyof AuditEntry;
    auditSort = { field, direction: auditSort.field === field ? (auditSort.direction === 1 ? -1 : 1) : field === 'createdAt' ? -1 : 1 };
    auditPage = 1; void loadAudit().catch(() => undefined); return;
  }
  const view = target.closest<HTMLButtonElement>('[data-audit-detail]');
  if (view) {
    const entry = auditEntries.find((item) => String(item.id) === view.dataset.auditDetail);
    if (!entry) return;
    const details: Array<[string, string]> = [
      ['Created at', auditDate(entry.createdAt)], ['Handled by', entry.handledBy], ['Module', entry.module],
      ['Action', entry.action], ['Description', entry.description], ['IP address', entry.ipAddress || 'Unknown'],
    ];
    $('#auditDetailContent').innerHTML = details.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    openModal('auditDetailModal');
  }
});
$('#auditPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-audit-page]');
  if (!button || button.disabled) return;
  auditPage += button.dataset.auditPage === 'next' ? 1 : -1;
  void loadAudit().catch(() => undefined);
});
$('#closeAuditDetail')?.addEventListener('click', () => closeModal('auditDetailModal'));
$('#closeAuditDetailButton')?.addEventListener('click', () => closeModal('auditDetailModal'));
$('#auditDetailModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'auditDetailModal') closeModal('auditDetailModal'); });

/* ---------- Supplier editor ---------- */
function openSupplierEditor(supplier?: Supplier) {
  $<HTMLFormElement>('#supplierForm').reset();
  $<HTMLInputElement>('#supplierId').value = supplier ? String(supplier.id) : '';
  $<HTMLInputElement>('#supplierName').value = supplier?.name ?? '';
  $<HTMLInputElement>('#supplierContact').value = supplier?.contactPerson ?? '';
  $<HTMLInputElement>('#supplierPhone').value = supplier?.phone ?? '';
  $<HTMLInputElement>('#supplierEmail').value = supplier?.email ?? '';
  $<HTMLInputElement>('#supplierAddress').value = supplier?.address ?? '';
  $<HTMLInputElement>('#supplierActive').checked = supplier?.active ?? true;
  $('#supplierModalTitle').textContent = supplier ? 'Edit supplier' : 'Add supplier';
  $('#saveSupplierButton').textContent = supplier ? 'Save changes' : 'Add supplier';
  setModalMsg('supplierFormMessage', '');
  openModal('supplierModal');
  setTimeout(() => $<HTMLInputElement>('#supplierName').focus(), 100);
}

$('#supplierSearch')?.addEventListener('input', () => { supplierPage = 1; renderSuppliers(); });
$('#addSupplierButton')?.addEventListener('click', () => openSupplierEditor());
$('#closeSupplierModal')?.addEventListener('click', () => closeModal('supplierModal'));
$('#cancelSupplierModal')?.addEventListener('click', () => closeModal('supplierModal'));
$('#supplierModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'supplierModal') closeModal('supplierModal'); });
$('#suppliersTable')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-supplier-sort]');
  if (sort) {
    const field = sort.dataset.supplierSort as typeof supplierSort.field;
    supplierSort = { field, direction: supplierSort.field === field ? (supplierSort.direction === 1 ? -1 : 1) : 1 };
    supplierPage = 1; renderSuppliers(); return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-supplier]');
  if (edit) { const supplier = suppliers.find((entry) => String(entry.id) === edit.dataset.editSupplier); if (supplier) openSupplierEditor(supplier); return; }
  const status = target.closest<HTMLButtonElement>('[data-toggle-supplier]');
  if (status) {
    const supplier = suppliers.find((entry) => String(entry.id) === status.dataset.toggleSupplier);
    if (!supplier) return;
    await busy(status, async () => {
      try {
        await api('PUT', `/suppliers/${supplier.id}`, { IsActive: !supplier.active });
        await loadSuppliers();
        setUsersMessage('suppliersMessage', '');
      } catch (err) { setUsersMessage('suppliersMessage', errMsg(err), 'err'); }
      renderSuppliers();
    });
  }
});
$('#suppliersPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-supplier-page]');
  if (!button || button.disabled) return;
  supplierPage += button.dataset.supplierPage === 'next' ? 1 : -1;
  renderSuppliers();
});
$<HTMLFormElement>('#supplierForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $<HTMLInputElement>('#supplierId').value;
  const body = {
    SupplierName: $<HTMLInputElement>('#supplierName').value.trim(),
    ContactPerson: $<HTMLInputElement>('#supplierContact').value.trim(),
    Phone: $<HTMLInputElement>('#supplierPhone').value.trim(),
    Email: $<HTMLInputElement>('#supplierEmail').value.trim(),
    Address: $<HTMLInputElement>('#supplierAddress').value.trim(),
    IsActive: $<HTMLInputElement>('#supplierActive').checked,
  };
  await busy($<HTMLButtonElement>('#saveSupplierButton'), async () => {
    try {
      await (id ? api('PUT', `/suppliers/${id}`, body) : api('POST', '/suppliers', body));
      await loadSuppliers();
      supplierPage = 1; renderSuppliers(); closeModal('supplierModal');
      setUsersMessage('suppliersMessage', id ? 'Supplier details saved.' : 'Supplier added successfully.', 'ok');
    } catch (err) { setModalMsg('supplierFormMessage', errMsg(err)); }
  });
});

/* ---------- Category editor ---------- */
function openCategoryEditor(category?: Category) {
  $<HTMLFormElement>('#categoryForm').reset();
  $<HTMLInputElement>('#categoryId').value = category ? String(category.id) : '';
  $<HTMLInputElement>('#categoryName').value = category?.name ?? '';
  $('#categoryModalTitle').textContent = category ? 'Edit category' : 'Add category';
  $('#saveCategoryButton').textContent = category ? 'Save changes' : 'Add category';
  setModalMsg('categoryFormMessage', '');
  openModal('categoryModal');
  setTimeout(() => $<HTMLInputElement>('#categoryName').focus(), 100);
}

$('#categorySearch')?.addEventListener('input', () => { categoryPage = 1; renderCategories(); });
$('#addCategoryButton')?.addEventListener('click', () => openCategoryEditor());
$('#closeCategoryModal')?.addEventListener('click', () => closeModal('categoryModal'));
$('#cancelCategoryModal')?.addEventListener('click', () => closeModal('categoryModal'));
$('#categoryModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'categoryModal') closeModal('categoryModal'); });
$('#categoriesTable')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-category-sort]')) { categorySortDirection = categorySortDirection === 1 ? -1 : 1; renderCategories(); return; }
  const edit = target.closest<HTMLButtonElement>('[data-edit-category]');
  if (edit) { const category = categories.find((entry) => String(entry.id) === edit.dataset.editCategory); if (category) openCategoryEditor(category); return; }
  const remove = target.closest<HTMLButtonElement>('[data-delete-category]');
  if (!remove) return;
  const category = categories.find((entry) => String(entry.id) === remove.dataset.deleteCategory);
  if (!category) return;
  const warning = category.products > 0 ? `\n\n${category.products} product${category.products === 1 ? '' : 's'} will become uncategorized.` : '';
  if (!window.confirm(`Delete category “${category.name}”?${warning}`)) return;
  await busy(remove, async () => {
    try {
      await api('DELETE', `/categories/${category.id}`);
      await Promise.all([loadCategories(), loadItems()]);
      setUsersMessage('categoriesMessage', 'Category deleted.', 'ok');
    } catch (err) { setUsersMessage('categoriesMessage', errMsg(err), 'err'); }
    renderCategories(); renderUI();
  });
});
$('#categoriesPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-category-page]');
  if (!button || button.disabled) return;
  categoryPage += button.dataset.categoryPage === 'next' ? 1 : -1;
  renderCategories();
});
$<HTMLFormElement>('#categoryForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $<HTMLInputElement>('#categoryId').value;
  const name = $<HTMLInputElement>('#categoryName').value.trim();
  if (!name) return setModalMsg('categoryFormMessage', 'Enter a category name.');
  await busy($<HTMLButtonElement>('#saveCategoryButton'), async () => {
    try {
      await (id ? api('PUT', `/categories/${id}`, { CategoryName: name }) : api('POST', '/categories', { CategoryName: name }));
      await Promise.all([loadCategories(), loadItems()]);
      categoryPage = 1; renderCategories(); renderUI(); closeModal('categoryModal');
      setUsersMessage('categoriesMessage', id ? 'Category updated.' : 'Category added.', 'ok');
    } catch (err) { setModalMsg('categoryFormMessage', errMsg(err)); }
  });
});

/* ---------- User editor ---------- */
function openUserEditor(user?: User) {
  const form = $<HTMLFormElement>('#userForm');
  form.reset();
  const editingSelf = !!user && user.id === session.staffId;
  $<HTMLInputElement>('#userId').value = user ? String(user.id) : '';
  $<HTMLInputElement>('#userFirstName').value = user?.firstName ?? '';
  $<HTMLInputElement>('#userLastName').value = user?.lastName ?? '';
  $<HTMLInputElement>('#userEmail').value = user?.email ?? '';
  $<HTMLInputElement>('#userUsername').value = user?.username ?? '';
  $<HTMLSelectElement>('#userRole').value = user?.role ?? 'employee';
  $<HTMLInputElement>('#userActive').checked = user?.active ?? true;
  // You can't change your own username, role or active status here (use Settings): it keeps the last admin from locking everyone out.
  $<HTMLInputElement>('#userUsername').disabled = editingSelf;
  $<HTMLSelectElement>('#userRole').disabled = editingSelf;
  $<HTMLInputElement>('#userActive').disabled = editingSelf;
  $<HTMLInputElement>('#userPassword').required = !user;
  $('#userPasswordLabel').textContent = user ? 'New password (optional)' : 'Password';
  $<HTMLInputElement>('#userPassword').placeholder = user ? 'Leave blank to keep the current password' : 'At least 8 characters';
  $('#userModalTitle').textContent = user ? 'Edit user' : 'Add user';
  $('#saveUserButton').textContent = user ? 'Save changes' : 'Add user';
  setModalMsg('userFormMessage', '');
  openModal('userModal');
  setTimeout(() => $<HTMLInputElement>('#userFirstName').focus(), 100);
}

$('#userSearch')?.addEventListener('input', () => { userPage = 1; renderUsers(); });
$('#addUserButton')?.addEventListener('click', () => openUserEditor());
$('#closeUserModal')?.addEventListener('click', () => closeModal('userModal'));
$('#cancelUserModal')?.addEventListener('click', () => closeModal('userModal'));
$('#userModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'userModal') closeModal('userModal'); });
$('#usersTable')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-user-sort]');
  if (sort) {
    const field = sort.dataset.userSort as typeof userSort.field;
    userSort = { field, direction: userSort.field === field ? (userSort.direction === 1 ? -1 : 1) : 1 };
    userPage = 1;
    renderUsers();
    return;
  }
  const edit = target.closest<HTMLButtonElement>('[data-edit-user]');
  if (edit) { const user = users.find((entry) => String(entry.id) === edit.dataset.editUser); if (user) openUserEditor(user); return; }
  const remove = target.closest<HTMLButtonElement>('[data-delete-user]');
  if (remove) {
    const user = users.find((entry) => String(entry.id) === remove.dataset.deleteUser);
    if (!user) return;
    if (user.id === session.staffId) { setUsersMessage('usersMessage', 'You cannot delete the account you are currently using.', 'err'); return; }
    if (!window.confirm(`Delete user “${user.username}”?`)) return;
    await busy(remove, async () => {
      try {
        await api('DELETE', `/staff/${user.id}`);
        await loadUsers();
        setUsersMessage('usersMessage', `${user.username} was deleted.`);
      } catch (err) { setUsersMessage('usersMessage', errMsg(err), 'err'); }
      renderUsers();
    });
  }
});
$('#usersPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-user-page]');
  if (!button || button.disabled) return;
  userPage += button.dataset.userPage === 'next' ? 1 : -1;
  renderUsers();
});

$<HTMLFormElement>('#userForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $<HTMLInputElement>('#userId').value;
  const existing = users.find((user) => String(user.id) === id);
  const editingSelf = !!existing && existing.id === session.staffId;
  const password = $<HTMLInputElement>('#userPassword').value;
  if (!existing && password.length < 8) return setModalMsg('userFormMessage', 'Password must be at least 8 characters.');
  if (existing && password && password.length < 8) return setModalMsg('userFormMessage', 'New password must be at least 8 characters.');

  const body: Record<string, unknown> = {
    FirstName: $<HTMLInputElement>('#userFirstName').value.trim(),
    LastName: $<HTMLInputElement>('#userLastName').value.trim(),
    Email: $<HTMLInputElement>('#userEmail').value.trim(),
  };
  if (!editingSelf) {
    body.Username = $<HTMLInputElement>('#userUsername').value.trim();
    body.Role = toBackendRole($<HTMLSelectElement>('#userRole').value as Role);
    body.IsActive = $<HTMLInputElement>('#userActive').checked;
  }
  if (password) body.Password = password;

  await busy($<HTMLButtonElement>('#saveUserButton'), async () => {
    try {
      await (existing ? api('PUT', `/staff/${existing.id}`, body) : api('POST', '/staff', body));
      await loadUsers();
      if (editingSelf) {
        const me = users.find((u) => u.id === session.staffId);
        if (me) updateSession({ name: `${me.firstName} ${me.lastName}`.trim() });
      }
      renderUsers(); closeModal('userModal');
      setUsersMessage('usersMessage', existing ? (password ? 'User details saved. Their new password is active and they were signed out.' : 'User details saved.') : 'User added successfully.', 'ok');
    } catch (err) { setModalMsg('userFormMessage', errMsg(err)); }
  });
});

/* ---------- Stock movement form ---------- */
document.querySelectorAll<HTMLButtonElement>('.toggle button').forEach((btn) =>
  btn.addEventListener('click', () => {
    type = btn.dataset.type as Move;
    document.querySelectorAll('.toggle button').forEach((b) => b.classList.toggle('active', b === btn));
    const s = $<HTMLButtonElement>('.submit');
    s.textContent = type === 'IN' ? 'Save stock in' : 'Save stock out';
    s.classList.toggle('out', type === 'OUT');
    updateSkuHint();
    msg.textContent = '';
  }));

/** Says what the typed SKU is, and shows the new-product fields (Admin) only when the SKU isn't in the warehouse yet. */
function updateSkuHint() {
  const hint = $('#skuHint'), fields = $<HTMLElement>('#newProductFields');
  if (!hint) return;
  const sku = $<HTMLInputElement>('#sku').value.trim().toUpperCase();
  const known = sku ? items.find((i) => i.sku === sku) : undefined;
  hint.textContent = known ? `${known.name} · ${known.qty} ${known.unit} on hand${isLow(known) ? ' · low stock' : ''}`
    : !sku ? ''
    : type === 'OUT' ? `${sku} isn't in the warehouse.`
    : isAdmin ? 'New SKU: fill in the product details below.' : 'New SKU: only an Admin can add a new product.';
  hint.classList.toggle('warn', !!known && isLow(known));
  if (fields) fields.style.display = type === 'IN' && !known ? '' : 'none';
}
$('#sku')?.addEventListener('input', updateSkuHint);

$<HTMLFormElement>('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sku = $<HTMLInputElement>('#sku').value.trim().toUpperCase();
  const name = $<HTMLInputElement>('#name').value.trim();
  const qty = Math.floor(Number($<HTMLInputElement>('#qty').value));
  const note = $<HTMLInputElement>('#note').value.trim();
  if (!sku || !(qty > 0)) return say('Enter a SKU and a quantity above zero.');

  const it = items.find((i) => i.sku === sku);
  if (type === 'OUT') {
    if (!it) return say(`SKU ${sku} isn't in the warehouse. Log a stock in first.`);
    if (qty > it.qty) return say(`Only ${it.qty} units of ${sku} on hand. Lower the quantity.`);
  } else if (!it) {
    if (!isAdmin) return say(`SKU ${sku} is new. Only an Admin can add a new product; ask one to log this stock in.`);
    if (!name) return say('New SKU: add an item name.');
  }

  const body: Record<string, unknown> = { SKU: sku, Type: type, Quantity: qty };
  if (note) body.Note = note;
  if (!it) {
    body.ProductName = name;
    const categoryId = $<HTMLSelectElement>('#category').value;
    if (categoryId) body.CategoryID = Number(categoryId);
    const priceText = $<HTMLInputElement>('#newPrice').value.trim();
    if (priceText !== '') {
      if (!(Number(priceText) >= 0)) return say('Enter a unit price of 0 or more.');
      body.Price = (toCents(priceText) / 100).toFixed(2);
    }
    const size = $<HTMLInputElement>('#newSize').value.trim();
    if (size) body.Size = size;
    const unit = $<HTMLInputElement>('#newUnit').value.trim();
    if (unit) body.Unit = unit;
    const reorderText = $<HTMLInputElement>('#newReorder').value.trim();
    if (reorderText !== '') {
      const level = Math.floor(Number(reorderText));
      if (!(level >= 0)) return say('Enter a low-stock level of 0 or more.');
      body.ReorderLevel = level;
    }
  }

  await busy($<HTMLButtonElement>('.submit'), async () => {
    try {
      await api('POST', '/movements', body);
      await Promise.all([loadItems(), loadMovements()]);
      renderUI();
      scene3d.flash(sku, type);
      say(`${type === 'IN' ? 'Stocked in' : 'Stocked out'} ${qty} × ${sku}.`, true);
      $<HTMLInputElement>('#qty').value = '1'; $<HTMLInputElement>('#note').value = '';
      if (!it) {
        for (const id of ['#name', '#newPrice', '#newSize']) $<HTMLInputElement>(id).value = '';
        $<HTMLSelectElement>('#category').value = '';
        $<HTMLInputElement>('#newUnit').value = 'pcs'; $<HTMLInputElement>('#newReorder').value = '10';
      }
      updateSkuHint();
    } catch (err) {
      say(errMsg(err));
      if (err instanceof ApiError && err.status === 409) { await loadItems().catch(() => undefined); renderUI(); }
    }
  });
});

/* 3D tilt on panels */
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!still) document.querySelectorAll<HTMLElement>('.tilt').forEach((el) => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateZ(6px)`;
  });
  el.addEventListener('pointerleave', () => (el.style.transform = ''));
});

/* ---------- Sales workspace ---------- */
let cart: Record<string, number> = {};
let salesMode: 'pos' | 'returns' = 'pos';
const moneylessDate = (value: string) => formatServerDate(value, 'medium');
const setSalesMessage = (id: string, message: string, ok = false) => {
  const el = $<HTMLParagraphElement>(`#${id}`);
  if (el) { el.textContent = message; el.className = `sales-message${message ? (ok ? ' ok' : ' err') : ''}`; }
};
const cartUnits = () => Object.values(cart).reduce((sum, qty) => sum + qty, 0);
const saleLabel = (sale: Sale) => sale.reference || sale.orderNo;

/** What the cart totals come to, in whole cents, using the same rounding as the server. */
function cartTotals() {
  const lines = Object.entries(cart).map(([sku, qty]) => ({ item: items.find((item) => item.sku === sku), qty })).filter((line): line is { item: Item; qty: number } => !!line.item);
  const subtotal = lines.reduce((sum, { item, qty }) => sum + toCents(item.price) * qty, 0);
  const discountInput = $<HTMLInputElement>('#discountRate');
  const discountRate = Math.max(0, Math.min(100, Number(discountInput?.value ?? 0) || 0));
  const discount = percentOfCents(subtotal, discountRate);
  const vat = percentOfCents(subtotal - discount, vatRate);
  return { lines, subtotal, discountRate, discount, vat, total: subtotal - discount + vat };
}

function renderSalesSummary() {
  const summary = $('#salesSummary');
  if (!summary) return;
  summary.innerHTML = `<div class="summary-metric"><strong>${salesStats.orders}</strong><span>Orders recorded</span></div><div class="summary-metric"><strong>${salesStats.sold - salesStats.returned}</strong><span>Net units sold</span></div>`;
}

function renderCatalog() {
  const search = ($<HTMLInputElement>('#productSearch')?.value ?? '').trim().toLowerCase();
  const sortBy = $<HTMLSelectElement>('#productSort')?.value ?? 'name';
  const matches = items.filter((item) => `${item.sku} ${item.name} ${item.category}`.toLowerCase().includes(search)).sort((a, b) =>
    sortBy === 'sku' ? a.sku.localeCompare(b.sku) : sortBy === 'stock' ? b.qty - a.qty : a.name.localeCompare(b.name));
  const catalogCount = $('#catalogCount');
  if (catalogCount) catalogCount.textContent = `${matches.length} ${matches.length === 1 ? 'item' : 'items'}`;
  const readonly = isAdmin ? '' : 'readonly tabindex="-1"';
  const catalog = $('#productCatalog');
  if (catalog) catalog.innerHTML = matches.length
    ? matches.map((item) => `<article class="product-card ${item.qty <= 0 ? 'unavailable' : ''}">
        <span class="stock-badge ${item.qty <= 0 ? 'sold-out' : ''}">${item.qty <= 0 ? 'Sold out' : 'In stock'}</span>
        <div class="product-mark" aria-hidden="true">${esc(item.name.slice(0, 1).toUpperCase())}</div>
        <div class="product-details"><span class="product-sku">${esc(item.sku)}${item.category ? ` · ${esc(item.category)}` : ''}</span><h3>${esc(item.name)}</h3><span class="stock-status ${isLow(item) ? 'stock-low' : ''}"><i></i>${item.qty} units available</span></div>
        <label class="product-price-label">Unit price<input class="product-price" type="number" min="0" step="0.01" value="${item.price.toFixed(2)}" data-price-sku="${esc(item.sku)}" aria-label="Unit price for ${esc(item.name)}" ${readonly} /></label>
        <button type="button" class="add-product" data-add-sku="${esc(item.sku)}" ${item.qty <= (cart[item.sku] ?? 0) ? 'disabled' : ''} aria-label="Add ${esc(item.name)} to order">+</button>
      </article>`).join('')
    : `<div class="sales-empty"><span class="empty-mark">⌕</span><strong>${items.length ? 'No matching products' : 'No inventory yet'}</strong><span>${items.length ? 'Try another name or SKU.' : 'Add stock from the dashboard to start a sale.'}</span></div>`;
}

function renderCart() {
  const { lines, subtotal, discountRate, discount, vat, total } = cartTotals();
  const readonly = isAdmin ? '' : 'readonly tabindex="-1"';
  const cartLines = $('#cartLines');
  if (cartLines) cartLines.innerHTML = lines.length
    ? lines.map(({ item, qty }) => `<div class="cart-line" data-cart-line="${esc(item.sku)}"><div class="cart-line-copy"><strong>${esc(item.name)}</strong><span>${esc(item.sku)}</span></div><div class="quantity-control"><button type="button" data-cart-action="minus" data-cart-sku="${esc(item.sku)}" aria-label="Remove one ${esc(item.name)}">−</button><span>${qty}</span><button type="button" data-cart-action="plus" data-cart-sku="${esc(item.sku)}" aria-label="Add one ${esc(item.name)}" ${qty >= item.qty ? 'disabled' : ''}>+</button></div><label class="sr-only" for="cart-price-${esc(item.sku)}">Unit price for ${esc(item.name)}</label><input id="cart-price-${esc(item.sku)}" class="cart-price" type="number" min="0" step="0.01" value="${item.price.toFixed(2)}" data-price-sku="${esc(item.sku)}" ${readonly} /><strong class="cart-line-total">${peso(toCents(item.price) * qty / 100)}</strong><button type="button" class="remove-line" data-cart-action="remove" data-cart-sku="${esc(item.sku)}" aria-label="Remove ${esc(item.name)} from order">×</button></div>`).join('')
    : `<div class="cart-empty"><div class="cart-empty-icon">＋</div><strong>Your order is empty</strong><span>Add products from the catalog to get started.</span></div>`;
  const itemCount = $('#cartItemCount'); if (itemCount) itemCount.textContent = `${lines.length}`;
  const unitCount = $('#cartUnitCount'); if (unitCount) unitCount.textContent = `${cartUnits()}`;

  const discountInput = $<HTMLInputElement>('#discountRate');
  if (discountInput && Number(discountInput.value) !== discountRate && discountInput.value !== '') discountInput.value = `${discountRate}`;
  const subtotalNode = $('#cartSubtotal'); if (subtotalNode) subtotalNode.textContent = peso(subtotal / 100);
  const discountNode = $('#cartDiscount'); if (discountNode) discountNode.textContent = peso(discount / 100);
  const vatNode = $('#cartVat'); if (vatNode) { vatNode.textContent = peso(vat / 100); const label = vatNode.previousElementSibling; if (label) label.textContent = `VAT (${vatRate}%)`; }
  const totalNode = $('#cartTotal'); if (totalNode) totalNode.textContent = peso(total / 100);

  // Amount received (optional): blank means the customer pays exactly the due amount.
  const amountText = ($<HTMLInputElement>('#amountPaid')?.value ?? '').trim();
  const amountCents = amountText === '' ? null : toCents(amountText);
  const short = amountCents !== null && amountCents < total;
  const changeNode = $('#cartChange'); if (changeNode) changeNode.textContent = peso(amountCents !== null && !short ? (amountCents - total) / 100 : 0);

  const priceMissing = lines.some(({ item }) => !(item.price > 0));
  const checkout = $<HTMLButtonElement>('#completeSale'); if (checkout) checkout.disabled = !lines.length || priceMissing || short;
  const warn = priceMissing ? 'Set a unit price for each product before payment.' : short && lines.length ? 'Amount received is less than the due amount.' : '';
  if (warn) setSalesMessage('saleMessage', warn);
  else if (['Set a unit price for each product before payment.', 'Amount received is less than the due amount.'].includes($('#saleMessage')?.textContent ?? '')) setSalesMessage('saleMessage', '');
}

/** Keeps what someone has typed into a return row when the list is redrawn behind their back. */
function captureReturnInputs() {
  const saved = new Map<string, { qty?: string; reason?: string }>();
  document.querySelectorAll<HTMLInputElement>('#salesHistory .return-qty').forEach((el) => { saved.set(el.dataset.returnLine ?? '', { ...saved.get(el.dataset.returnLine ?? ''), qty: el.value }); });
  document.querySelectorAll<HTMLInputElement>('#salesHistory .return-reason').forEach((el) => { saved.set(el.dataset.returnReason ?? '', { ...saved.get(el.dataset.returnReason ?? ''), reason: el.value }); });
  return saved;
}

function renderHistory() {
  const saved = captureReturnInputs();
  const returnCount = $('#returnCount'); if (returnCount) returnCount.textContent = `${historyTotal} ${historyTotal === 1 ? 'completed sale' : 'completed sales'}`;
  const searching = ($<HTMLInputElement>('#returnSearch')?.value ?? '').trim() !== '';
  const history = $('#salesHistory');
  if (!history) return;
  history.innerHTML = historySales.length
    ? historySales.map((sale) => `<article class="sale-record"><div class="sale-record-head"><div><span class="sale-order-id">${esc(saleLabel(sale))}</span><span class="sale-customer">${esc(sale.customer || 'Walk-in customer')}</span></div><div class="sale-record-meta"><time>${esc(moneylessDate(sale.time))}</time><button type="button" class="text-action receipt-link" data-receipt="${sale.id}">Receipt</button></div></div><div class="return-lines">${sale.lines.map((line) => {
      const remaining = line.qty - line.returned;
      return `<div class="return-line"><div><strong>${esc(line.name)}</strong><span>${esc(line.sku)} · ${line.returned} of ${line.qty} already returned</span></div>${remaining > 0 ? `<div class="return-action"><label class="sr-only" for="ret-${line.id}">Return quantity for ${esc(line.name)}</label><input id="ret-${line.id}" class="return-qty" type="number" min="1" max="${remaining}" value="1" data-return-line="${line.id}" /><label class="sr-only" for="reason-${line.id}">Return reason</label><input id="reason-${line.id}" class="return-reason" maxlength="120" placeholder="Reason" data-return-reason="${line.id}" /><button type="button" class="return-button" data-return-line="${line.id}">Return item</button></div>` : `<span class="returned-label">FULLY RETURNED</span>`}</div>`;
    }).join('')}</div></article>`).join('') + (historyTotal > historySales.length ? `<div class="sales-history-more"><button type="button" class="text-action" id="historyMore">Show more sales (${historyTotal - historySales.length} older)</button></div>` : '')
    : `<div class="sales-empty"><span class="empty-mark">↩</span><strong>${searching ? 'No matching orders' : 'No completed sales yet'}</strong><span>${searching ? 'Try another order, customer or SKU.' : 'Completed POS orders will appear here for returns.'}</span></div>`;
  history.querySelectorAll<HTMLInputElement>('.return-qty').forEach((el) => { const v = saved.get(el.dataset.returnLine ?? '')?.qty; if (v !== undefined) el.value = v; });
  history.querySelectorAll<HTMLInputElement>('.return-reason').forEach((el) => { const v = saved.get(el.dataset.returnReason ?? '')?.reason; if (v !== undefined) el.value = v; });
}

function renderRegister() {
  const returnRegister = $('#returnRegister');
  if (!returnRegister) return;
  returnRegister.innerHTML = returnEntries.length
    ? `<thead><tr><th>Date</th><th>Returned product</th><th>Qty</th><th>Reason</th><th>Handled by</th><th>Status</th><th>Action</th></tr></thead><tbody>${returnEntries.map((entry) => `<tr><td>${esc(moneylessDate(entry.time))}</td><td>${esc(entry.product)}</td><td class="num">${entry.qty}</td><td>${esc(entry.reason)}</td><td>${esc(entry.handledBy)}</td><td><span class="return-status ${entry.status === 'Reviewed' ? 'reviewed' : ''}">${esc(entry.status)}</span></td><td>${entry.status === 'Reviewed' || !isAdmin ? '—' : `<button type="button" class="review-return" data-review-return="${entry.id}">Mark reviewed</button>`}</td></tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="sales-table-empty" colspan="7">No returned items have been recorded yet.</td></tr></tbody>`;
}

function renderRecent() {
  const recent = $('#recentSales');
  if (!recent) return;
  recent.innerHTML = recentSales.length
    ? `<thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Units</th><th>Status</th><th>Receipt</th></tr></thead><tbody>${recentSales.map((sale) => {
        const sold = sale.lines.reduce((sum, line) => sum + line.qty, 0), returned = sale.lines.reduce((sum, line) => sum + line.returned, 0);
        return `<tr><td class="order-cell">${esc(saleLabel(sale))}</td><td>${esc(sale.customer || 'Walk-in customer')}</td><td>${esc(moneylessDate(sale.time))}</td><td class="num">${sold}</td><td><span class="sale-status ${returned ? 'has-returns' : ''}">${returned === 0 ? 'Complete' : returned === sold ? 'Returned' : 'Part returned'}</span></td><td><button type="button" class="text-action receipt-link" data-receipt="${sale.id}">View</button></td></tr>`;
      }).join('')}</tbody>`
    : `<tbody><tr><td class="sales-table-empty" colspan="6">Your completed sales will appear here.</td></tr></tbody>`;
}

function renderSales() {
  if (!$('#salesSummary')) return;
  renderSalesSummary(); renderCatalog(); renderCart(); renderHistory(); renderRegister(); renderRecent();
}

function showSalesView(mode: 'pos' | 'returns') {
  const changed = mode !== salesMode;
  salesMode = mode;
  const posPanel = $('#posPanel'), returnsPanel = $('#returnsPanel'), recentPanel = $('#recentSalesPanel');
  if (posPanel) posPanel.style.display = mode === 'pos' ? '' : 'none';
  if (returnsPanel) returnsPanel.style.display = mode === 'returns' ? '' : 'none';
  if (recentPanel) recentPanel.style.display = mode === 'pos' ? '' : 'none';
  const title = $('#salesPageTitle'); if (title) title.textContent = mode === 'pos' ? 'Point of sale' : 'Sales returns';
  const lead = salesView?.querySelector<HTMLElement>('.sales-lead'); if (lead) lead.textContent = mode === 'pos' ? 'Build an order from available stock and record every dispatch.' : 'Find a completed sale and record returned items for restocking.';
  document.querySelectorAll<HTMLButtonElement>('.sales-tab').forEach((tab) => {
    const active = tab.dataset.salesView === mode;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active));
  });
  renderSales();
  if (changed) void refreshSales();
}

/** Re-reads the Sales page data (and stock, which the catalog shows) from the server. */
async function refreshSales() {
  try { await Promise.all([loadItems(), loadSalesData()]); } catch (err) { setSalesMessage(salesMode === 'pos' ? 'saleMessage' : 'returnMessage', errMsg(err)); }
  scene3d.sync(); renderSales();
}

$('#productSearch')?.addEventListener('input', renderCatalog);
$('#productSort')?.addEventListener('change', renderCatalog);
let returnSearchTimer: number | undefined;
$('#returnSearch')?.addEventListener('input', () => {
  window.clearTimeout(returnSearchTimer);
  returnSearchTimer = window.setTimeout(async () => {
    historyLimit = 20;
    try { await loadHistory(); } catch (err) { setSalesMessage('returnMessage', errMsg(err)); }
    renderHistory();
  }, 250);
});
$('#discountRate')?.addEventListener('input', renderCart);
$('#amountPaid')?.addEventListener('input', renderCart);

/* Only an Admin can change a price. The server enforces it too (PUT /products is Admin only). */
document.addEventListener('change', async (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-price-sku]');
  if (!input || !isAdmin) return;
  const item = items.find((entry) => entry.sku === input.dataset.priceSku);
  const price = Number(input.value);
  if (!item || !Number.isFinite(price) || price < 0) { renderCatalog(); renderCart(); return; }
  try {
    const updated = await api<ApiProduct>('PUT', `/products/${item.id}`, { Price: price.toFixed(2) });
    item.price = Number(updated.Price);
    if (['Set a unit price for each product before payment.'].includes($('#saleMessage')?.textContent ?? '')) setSalesMessage('saleMessage', '');
  } catch (err) { setSalesMessage('saleMessage', errMsg(err)); }
  renderCatalog(); renderCart();
});
$('#productCatalog')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-add-sku]');
  if (!button) return;
  const item = items.find((entry) => entry.sku === button.dataset.addSku);
  if (item && (cart[item.sku] ?? 0) < item.qty) { cart[item.sku] = (cart[item.sku] ?? 0) + 1; setSalesMessage('saleMessage', ''); renderCatalog(); renderCart(); }
});
$('#cartLines')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cart-action]');
  if (!button) return;
  const sku = button.dataset.cartSku!, action = button.dataset.cartAction!, item = items.find((entry) => entry.sku === sku);
  if (action === 'remove') delete cart[sku];
  else if (action === 'minus') { cart[sku] = (cart[sku] ?? 0) - 1; if (cart[sku] <= 0) delete cart[sku]; }
  else if (action === 'plus' && item && (cart[sku] ?? 0) < item.qty) cart[sku] = (cart[sku] ?? 0) + 1;
  renderCatalog(); renderCart();
});
$('#clearCart')?.addEventListener('click', () => { cart = {}; setSalesMessage('saleMessage', ''); renderCatalog(); renderCart(); });

$<HTMLButtonElement>('#completeSale')?.addEventListener('click', async () => {
  const { lines, discountRate } = cartTotals();
  if (!lines.length) return;
  const unavailable = lines.find(({ item, qty }) => qty > item.qty);
  if (unavailable) { setSalesMessage('saleMessage', `${unavailable.item.name} no longer has enough stock. Adjust the order and retry.`); renderSales(); return; }
  if (lines.some(({ item }) => !(item.price > 0))) { setSalesMessage('saleMessage', 'Set a unit price for each product before payment.'); return; }

  const customer = $<HTMLInputElement>('#saleCustomer').value.trim();
  const reference = $<HTMLInputElement>('#saleReference').value.trim();
  const amountText = $<HTMLInputElement>('#amountPaid').value.trim();
  const body: Record<string, unknown> = {
    Items: lines.map(({ item, qty }) => ({ ProductID: item.id, Quantity: qty })),
    DiscountRate: discountRate,
    PaymentMethod: $<HTMLSelectElement>('#paymentMethod').value,
  };
  if (customer) body.CustomerName = customer;
  if (reference) body.Reference = reference;
  if (amountText !== '') body.AmountPaid = (toCents(amountText) / 100).toFixed(2);

  await busy($<HTMLButtonElement>('#completeSale'), async () => {
    try {
      const order = await api<ReceiptOrder>('POST', '/checkout', body);
      const sale = mapSale(order);
      cart = {};
      $<HTMLInputElement>('#saleCustomer').value = ''; $<HTMLInputElement>('#saleReference').value = '';
      $<HTMLInputElement>('#discountRate').value = '0'; $<HTMLInputElement>('#amountPaid').value = '';
      await Promise.all([loadItems(), loadMovements(), loadSalesData()]);
      renderUI();
      const change = Number(order.transaction?.Change ?? 0);
      setSalesMessage('saleMessage', `Sale ${saleLabel(sale)} completed (${peso(sale.total)}).${change > 0 ? ` Change due: ${peso(change)}.` : ''} Inventory has been updated.`, true);
      void openReceipt(sale.id, order);
    } catch (err) {
      setSalesMessage('saleMessage', errMsg(err) + (err instanceof ApiError && err.status === 409 ? ' The stock list was refreshed.' : ''));
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) { await loadItems().catch(() => undefined); scene3d.sync(); renderSales(); }
    }
  });
});

$('#salesHistory')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const receiptButton = target.closest<HTMLButtonElement>('[data-receipt]');
  if (receiptButton) { await busy(receiptButton, () => openReceipt(Number(receiptButton.dataset.receipt))); return; }
  if (target.closest('#historyMore')) {
    historyLimit += 20;
    try { await loadHistory(); } catch (err) { setSalesMessage('returnMessage', errMsg(err)); }
    renderHistory(); return;
  }
  const button = target.closest<HTMLButtonElement>('.return-button[data-return-line]');
  if (!button) return;
  const lineId = Number(button.dataset.returnLine);
  const sale = historySales.find((entry) => entry.lines.some((l) => l.id === lineId));
  const line = sale?.lines.find((l) => l.id === lineId);
  const input = button.parentElement?.querySelector<HTMLInputElement>('.return-qty');
  const reasonInput = button.parentElement?.querySelector<HTMLInputElement>('.return-reason');
  const qty = Math.floor(Number(input?.value));
  const reason = reasonInput?.value.trim() ?? '';
  if (!sale || !line || !(qty > 0) || qty > line.qty - line.returned) { setSalesMessage('returnMessage', 'Enter a return quantity within the remaining order quantity.'); return; }
  if (!reason) { setSalesMessage('returnMessage', 'Enter a reason for the return.'); reasonInput?.focus(); return; }
  await busy(button, async () => {
    try {
      await api('POST', '/returns', { OrderItemID: line.id, Quantity: qty, Reason: reason });
      await Promise.all([loadItems(), loadMovements(), loadSalesData()]);
      renderUI();
      setSalesMessage('returnMessage', `${qty} × ${line.name} restocked from ${saleLabel(sale)}.`, true);
    } catch (err) { setSalesMessage('returnMessage', errMsg(err)); }
  });
});
$('#returnRegister')?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-review-return]');
  if (!button) return;
  await busy(button, async () => {
    try {
      await api('POST', `/returns/${button.dataset.reviewReturn}/review`);
      await loadReturns();
      setSalesMessage('returnMessage', '');
    } catch (err) { setSalesMessage('returnMessage', errMsg(err)); }
    renderRegister();
  });
});
document.querySelectorAll<HTMLButtonElement>('.sales-tab').forEach((tab) => tab.addEventListener('click', () => showSalesView(tab.dataset.salesView as 'pos' | 'returns')));
$('#viewAllReturns')?.addEventListener('click', () => { showSalesView('returns'); switchView('sales'); });

/* ---------- Products ---------- */
type ProductSortField = 'sku' | 'name' | 'category' | 'price' | 'qty' | 'reorder';
let productSort: { field: ProductSortField; direction: 1 | -1 } = { field: 'name', direction: 1 };
let productPage = 1;
const PRODUCTS_PER_PAGE = 10;
const UNCATEGORIZED = '__none';
const slotLabel = (slot: number) => `Shelf ${Math.floor(slot / COLS) + 1} · Bay ${(slot % COLS) + 1}`;
const money = (cents: number) => (cents / 100).toFixed(2);
const stockState = (item: Item): 'out' | 'low' | 'ok' => (item.qty <= 0 ? 'out' : isLow(item) ? 'low' : 'ok');
const STOCK_LABEL = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' } as const;

function visibleProducts(): Item[] {
  const search = ($<HTMLInputElement>('#productsSearch')?.value ?? '').trim().toLowerCase();
  const category = $<HTMLSelectElement>('#productsCategory')?.value ?? '';
  const lowOnly = $<HTMLInputElement>('#productsLowOnly')?.checked ?? false;
  const { field, direction } = productSort;
  return items
    .filter((item) => (!search || `${item.sku} ${item.name} ${item.category} ${item.size}`.toLowerCase().includes(search))
      && (!category || (category === UNCATEGORIZED ? !item.category : item.category === category))
      && (!lowOnly || isLow(item)))
    .sort((a, b) => {
      const cmp = field === 'price' || field === 'qty' || field === 'reorder'
        ? a[field] - b[field]
        : String(a[field]).localeCompare(String(b[field]), undefined, { numeric: true, sensitivity: 'base' });
      return cmp !== 0 ? cmp * direction : a.name.localeCompare(b.name);
    });
}

/** The category filter lists the categories that products actually use, so it never needs its own request. */
function fillProductFilters() {
  const select = $<HTMLSelectElement>('#productsCategory');
  if (!select) return;
  const current = select.value;
  const names = [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = '<option value="">All categories</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    + (items.some((i) => !i.category) ? `<option value="${UNCATEGORIZED}">Uncategorized</option>` : '');
  select.value = [...select.options].some((o) => o.value === current) ? current : '';
}

function renderProducts() {
  const table = $('#productsTable');
  if (!table) return;
  fillProductFilters();
  const visible = visibleProducts();
  const pageCount = Math.max(1, Math.ceil(visible.length / PRODUCTS_PER_PAGE));
  productPage = Math.min(productPage, pageCount);
  const rows = visible.slice((productPage - 1) * PRODUCTS_PER_PAGE, productPage * PRODUCTS_PER_PAGE);
  const count = $('#productsCount');
  if (count) count.textContent = visible.length === items.length ? `${items.length} ${items.length === 1 ? 'product' : 'products'}` : `${visible.length} of ${items.length}`;

  const sortable: Array<[ProductSortField, string, boolean]> = [
    ['sku', 'SKU', false], ['name', 'Product', false], ['category', 'Category', false],
  ];
  const sortHead = ([field, label, right]: [ProductSortField, string, boolean]) =>
    `<th${right ? ' class="num-col"' : ''}><button type="button" class="user-sort${right ? ' right' : ''}" data-product-sort="${field}">${label}<span aria-hidden="true">${productSort.field === field ? (productSort.direction === 1 ? '↑' : '↓') : '↕'}</span></button></th>`;
  const head = `<thead><tr>${sortable.map(sortHead).join('')}<th>Size</th>${sortHead(['price', 'Price', true])}${sortHead(['qty', 'On hand', true])}${sortHead(['reorder', 'Low at', true])}<th>Rack</th><th>Status</th>${isAdmin ? '<th class="user-actions-heading">Actions</th>' : ''}</tr></thead>`;
  const columns = isAdmin ? 10 : 9;

  table.innerHTML = rows.length
    ? `${head}<tbody>${rows.map((item) => {
      const state = stockState(item);
      return `<tr>
        <td class="product-sku-cell">${esc(item.sku)}</td>
        <td class="product-name-cell" title="${esc(item.name)}">${esc(item.name)}</td>
        <td>${item.category ? esc(item.category) : '<span class="dim">—</span>'}</td>
        <td>${item.size ? esc(item.size) : '<span class="dim">—</span>'}</td>
        <td class="num">${peso(item.price)}</td>
        <td class="num">${item.qty} <span class="unit">${esc(item.unit)}</span></td>
        <td class="num">${item.reorder}</td>
        <td>${item.slot === null ? '<span class="dim">—</span>' : esc(slotLabel(item.slot))}</td>
        <td><span class="stock-pill ${state}">${STOCK_LABEL[state]}</span></td>
        ${isAdmin ? `<td class="user-actions"><button type="button" class="user-edit" data-edit-product="${item.id}" aria-label="Edit ${esc(item.name)}" title="Edit product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button type="button" class="user-delete" data-delete-product="${item.id}" aria-label="Delete ${esc(item.name)}" title="Delete product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td>` : ''}
      </tr>`;
    }).join('')}</tbody>`
    : `${head}<tbody><tr><td class="users-empty" colspan="${columns}">${items.length ? 'No products match your filters.' : isAdmin ? 'No products yet. Add your first product to get started.' : 'No products yet.'}</td></tr></tbody>`;

  const pagination = $('#productsPagination');
  if (pagination) {
    const from = visible.length ? (productPage - 1) * PRODUCTS_PER_PAGE + 1 : 0;
    const to = Math.min(productPage * PRODUCTS_PER_PAGE, visible.length);
    pagination.innerHTML = `<span class="users-pagination-summary">Showing ${from}–${to} of ${visible.length}</span><div class="users-pagination-actions"><button type="button" data-product-page="prev" ${productPage <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${productPage} of ${pageCount}</span><button type="button" data-product-page="next" ${productPage >= pageCount ? 'disabled' : ''}>Next</button></div>`;
  }
}

$('#productsSearch')?.addEventListener('input', () => { productPage = 1; renderProducts(); });
$('#productsCategory')?.addEventListener('change', () => { productPage = 1; renderProducts(); });
$('#productsLowOnly')?.addEventListener('change', () => { productPage = 1; renderProducts(); });
$('#productsPagination')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-product-page]');
  if (!button || button.disabled) return;
  productPage += button.dataset.productPage === 'next' ? 1 : -1;
  renderProducts();
});

/* Product editor (Admin). Stock quantities are NOT edited here: they change through Log stock so every change is in the movement log. */
function fillProductSlotSelect(current: number | null, pickFirstFree: boolean) {
  const select = $<HTMLSelectElement>('#pfSlot');
  const taken = new Set(items.filter((i) => i.slot !== null && i.slot !== current).map((i) => i.slot as number));
  const free = Array.from({ length: SLOTS }, (_, slot) => slot).filter((slot) => !taken.has(slot));
  select.innerHTML = '<option value="">Not on the rack</option>' + free.map((slot) => `<option value="${slot}">${esc(slotLabel(slot))}${slot === current ? ' (current)' : ''}</option>`).join('');
  select.value = current !== null ? String(current) : pickFirstFree && free.length ? String(free[0]) : '';
}

function openProductEditor(item?: Item) {
  $<HTMLFormElement>('#productForm').reset();
  $<HTMLInputElement>('#productId').value = item ? String(item.id) : '';
  $<HTMLInputElement>('#pfSku').value = item?.sku ?? '';
  $<HTMLInputElement>('#pfSku').required = !!item;
  $<HTMLInputElement>('#pfName').value = item?.name ?? '';
  $<HTMLInputElement>('#pfPrice').value = item ? item.price.toFixed(2) : '';
  $<HTMLInputElement>('#pfSize').value = item?.size ?? '';
  $<HTMLInputElement>('#pfUnit').value = item?.unit ?? 'pcs';
  $<HTMLInputElement>('#pfReorder').value = String(item?.reorder ?? 10);
  $<HTMLInputElement>('#pfStock').value = '0';
  $('#pfStockField').style.display = item ? 'none' : '';
  $('#pfStockNote').textContent = item
    ? `${item.qty} ${item.unit} on hand. To change the quantity use Inventory › Log stock, so the movement is recorded.`
    : 'Opening stock is recorded as the first stock-in. Leave it at 0 to add the product without stock.';
  const category = $<HTMLSelectElement>('#pfCategory');
  category.innerHTML = '<option value="">Uncategorized</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  category.value = item?.categoryId !== null && item?.categoryId !== undefined && categories.some((c) => c.id === item.categoryId) ? String(item.categoryId) : '';
  fillProductSlotSelect(item?.slot ?? null, !item);
  $('#productModalTitle').textContent = item ? 'Edit product' : 'Add product';
  $('#productModalSub').textContent = item ? 'Change the details, price, size, low-stock level or rack position.' : 'Add a product to the catalog and the 3D rack.';
  $('#saveProductButton').textContent = item ? 'Save changes' : 'Add product';
  setModalMsg('productFormMessage', '');
  openModal('productModal');
  setTimeout(() => $<HTMLInputElement>('#pfName').focus(), 100);
}

$('#addProductButton')?.addEventListener('click', () => { if (isAdmin) openProductEditor(); });
$('#closeProductModal')?.addEventListener('click', () => closeModal('productModal'));
$('#cancelProductModal')?.addEventListener('click', () => closeModal('productModal'));
$('#productModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'productModal') closeModal('productModal'); });
$('#productsTable')?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const sort = target.closest<HTMLButtonElement>('[data-product-sort]');
  if (sort) {
    const field = sort.dataset.productSort as ProductSortField;
    productSort = { field, direction: productSort.field === field ? (productSort.direction === 1 ? -1 : 1) : 1 };
    productPage = 1; renderProducts(); return;
  }
  if (!isAdmin) return;
  const edit = target.closest<HTMLButtonElement>('[data-edit-product]');
  if (edit) { const item = items.find((entry) => String(entry.id) === edit.dataset.editProduct); if (item) openProductEditor(item); return; }
  const remove = target.closest<HTMLButtonElement>('[data-delete-product]');
  if (!remove) return;
  const item = items.find((entry) => String(entry.id) === remove.dataset.deleteProduct);
  if (!item) return;
  if (!window.confirm(`Delete product “${item.name}” (${item.sku})?\n\nIts stock record and movement history are removed too. This cannot be undone.`)) return;
  await busy(remove, async () => {
    try {
      await api('DELETE', `/products/${item.id}`);
      delete cart[item.sku];
      await Promise.all([loadItems(), loadCategories()]);
      renderUI();
      setUsersMessage('productsMessage', `${item.sku} was deleted.`, 'ok');
    } catch (err) { setUsersMessage('productsMessage', errMsg(err), 'err'); }
  });
});

$<HTMLFormElement>('#productForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isAdmin) return;
  const id = $<HTMLInputElement>('#productId').value;
  const existing = items.find((entry) => String(entry.id) === id);
  const fail = (text: string) => setModalMsg('productFormMessage', text);

  const name = $<HTMLInputElement>('#pfName').value.trim();
  if (!name) return fail('Enter a product name.');
  const priceText = $<HTMLInputElement>('#pfPrice').value.trim();
  if (priceText !== '' && !(Number(priceText) >= 0)) return fail('Enter a unit price of 0 or more.');
  const reorderText = $<HTMLInputElement>('#pfReorder').value.trim();
  const reorder = Math.floor(Number(reorderText));
  if (reorderText === '' || !(reorder >= 0)) return fail('Enter a low-stock level of 0 or more.');

  const category = $<HTMLSelectElement>('#pfCategory').value;
  const slot = $<HTMLSelectElement>('#pfSlot').value;
  const sku = $<HTMLInputElement>('#pfSku').value.trim();
  const body: Record<string, unknown> = {
    ProductName: name,
    CategoryID: category ? Number(category) : null,
    Size: $<HTMLInputElement>('#pfSize').value.trim(),
    Price: (toCents(priceText || '0') / 100).toFixed(2),
    Unit: $<HTMLInputElement>('#pfUnit').value.trim() || 'pcs',
    ReorderLevel: reorder,
    RackSlot: slot === '' ? null : Number(slot),
  };
  if (sku) body.SKU = sku;
  if (!existing) {
    const stock = Math.floor(Number($<HTMLInputElement>('#pfStock').value));
    if (!(stock >= 0)) return fail('Opening stock must be 0 or more.');
    body.StockQuantity = stock;
  }

  await busy($<HTMLButtonElement>('#saveProductButton'), async () => {
    try {
      const saved = await (existing ? api<ApiProduct>('PUT', `/products/${existing.id}`, body) : api<ApiProduct>('POST', '/products', body));
      // The cart is keyed by SKU: follow a renamed SKU so an open order doesn't lose the line
      if (existing && existing.sku !== saved.SKU && cart[existing.sku] !== undefined) { cart[saved.SKU] = cart[existing.sku]; delete cart[existing.sku]; }
      await Promise.all([loadItems(), loadCategories()]);
      renderUI(); closeModal('productModal');
      setUsersMessage('productsMessage', existing ? `${saved.SKU} was updated.` : `${saved.SKU} was added${Number(body.StockQuantity) > 0 ? ` with ${body.StockQuantity} ${saved.Unit ?? 'pcs'} in stock` : ''}.`, 'ok');
    } catch (err) { fail(errMsg(err)); }
  });
});

/* ---------- Receipts ---------- */
let receiptNo = '';
function mapReceipt(o: ReceiptOrder): Receipt {
  const t = o.transaction ?? null;
  return {
    orderNo: o.OrderNo, reference: o.Reference ?? '', date: t?.TransactionDate ?? o.OrderDate,
    cashier: o.StaffName, customer: o.CustomerName ?? '',
    lines: o.items.map((l) => ({ name: l.ProductName, sku: l.SKU, qty: Number(l.Quantity), returned: Number(l.ReturnedQuantity), unitPrice: Number(l.UnitPrice), lineTotal: Number(l.LineTotal) })),
    subtotal: Number(o.Subtotal), discountRate: Number(o.DiscountRate), discount: Number(o.DiscountAmount),
    vatRate: Number(o.VatRate), vat: Number(o.VatAmount), total: Number(o.Total),
    payment: t ? { method: t.PaymentMethod, paid: Number(t.AmountPaid), change: Number(t.Change) } : null,
  };
}

/** Shows the receipt for a sale. After checkout the order is already in hand; elsewhere it is fetched. */
async function openReceipt(orderId: number, order?: ReceiptOrder) {
  setModalMsg('receiptMessage', '');
  let data = order;
  if (!data) {
    try { data = await api<ReceiptOrder>('GET', `/orders/${orderId}`); }
    catch (err) { setSalesMessage(salesMode === 'pos' ? 'saleMessage' : 'returnMessage', errMsg(err)); return; }
  }
  const receipt = mapReceipt(data);
  receiptNo = receipt.orderNo;
  $('#receiptPaper').innerHTML = buildReceiptHtml(receipt);
  openModal('receiptModal');
  setTimeout(() => $<HTMLButtonElement>('#printReceiptButton')?.focus(), 100);
}
$('#recentSales')?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-receipt]');
  if (button) await busy(button, () => openReceipt(Number(button.dataset.receipt)));
});
$('#closeReceiptModal')?.addEventListener('click', () => closeModal('receiptModal'));
$('#closeReceiptButton')?.addEventListener('click', () => closeModal('receiptModal'));
$('#receiptModal')?.addEventListener('click', (event) => { if ((event.target as HTMLElement).id === 'receiptModal') closeModal('receiptModal'); });
$('#printReceiptButton')?.addEventListener('click', () => {
  // The browser names a "Save as PDF" file after the page title, so borrow the order number for a moment
  const previousTitle = document.title;
  document.title = `Receipt ${receiptNo}`;
  window.addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
  window.print();
});

/* ---------- CSV exports (Admin) ---------- */
/** Wires a button to a download. `build` returns the file's base name, header and rows. Cells are sanitised in downloadCsv(). */
function wireExport(buttonId: string, messageId: string | null, build: () => Promise<{ file: string; header: string[]; rows: CsvCell[][] }>) {
  const button = $<HTMLButtonElement>(`#${buttonId}`);
  button?.addEventListener('click', async () => {
    if (!isAdmin) return;
    const label = button.textContent;
    await busy(button, async () => {
      try {
        const { file, header, rows } = await build();
        downloadCsv(`${file}-${isoDate()}.csv`, header, rows);
        button.textContent = `Saved ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
        if (messageId) setUsersMessage(messageId, '');
      } catch (err) {
        button.textContent = 'Export failed';
        if (messageId) setUsersMessage(messageId, errMsg(err), 'err');
      }
    });
    window.setTimeout(() => { button.textContent = label; }, 2200);
  });
}

type ApiMovementRow = ApiMovement & { ProductName: string; HandledBy: string };
wireExport('exportProducts', 'productsMessage', async () => ({
  file: 'products', header: ['SKU', 'Product', 'Category', 'Size', 'Unit price (PHP)', 'On hand', 'Unit', 'Low-stock level', 'Status', 'Rack position', 'Stock value (PHP)'],
  rows: visibleProducts().map((i) => [i.sku, i.name, i.category, i.size, money(toCents(i.price)), i.qty, i.unit, i.reorder, STOCK_LABEL[stockState(i)], i.slot === null ? '' : slotLabel(i.slot), money(toCents(i.price) * i.qty)]),
}));
wireExport('exportMovements', null, async () => ({
  file: 'stock-movements', header: ['Date and time', 'Type', 'SKU', 'Product', 'Quantity', 'Note', 'Handled by'],
  rows: (await fetchAll<ApiMovementRow>('/movements')).map((m) => [m.CreatedAt, m.MovementType, m.SKU, m.ProductName, m.Quantity, m.Note ?? '', m.HandledBy]),
}));
wireExport('exportSales', null, async () => ({
  file: 'sales', header: ['Order', 'Reference', 'Date and time', 'Customer', 'Cashier', 'Units', 'Units returned', 'Subtotal (PHP)', 'Discount %', 'Discount (PHP)', 'VAT (PHP)', 'Total (PHP)'],
  rows: (await fetchAll<ApiOrder>('/orders', { status: 'Completed' })).map((o) => [
    o.OrderNo, o.Reference ?? '', o.OrderDate, o.CustomerName ?? '', o.StaffName, o.items.reduce((n, l) => n + Number(l.Quantity), 0), o.items.reduce((n, l) => n + Number(l.ReturnedQuantity), 0),
    o.Subtotal, o.DiscountRate, o.DiscountAmount, o.VatAmount, o.Total,
  ]),
}));
wireExport('exportReturns', 'returnMessage', async () => ({
  file: 'returns', header: ['Date and time', 'Order', 'SKU', 'Product', 'Quantity', 'Reason', 'Handled by', 'Status'],
  rows: (await fetchAll<ApiReturn>('/returns')).map((r) => [r.CreatedAt, r.Reference || r.OrderNo, r.SKU, r.ProductName, r.Quantity, r.Reason, r.HandledBy, r.Status]),
}));
wireExport('exportSuppliers', 'suppliersMessage', async () => ({
  file: 'suppliers', header: ['Name', 'Contact person', 'Phone', 'Email', 'Address', 'Active'],
  rows: (await fetchAll<ApiSupplier>('/suppliers')).map(mapSupplier).map((x) => [x.name, x.contactPerson, x.phone, x.email, x.address, x.active ? 'Yes' : 'No']),
}));
wireExport('exportUsers', 'usersMessage', async () => ({
  file: 'users', header: ['Username', 'First name', 'Last name', 'Role', 'Email', 'Active'],
  rows: (await fetchAll<ApiStaff>('/staff')).map(mapUser).map((u) => [u.username, u.firstName, u.lastName, roleLabel(u.role), u.email, u.active ? 'Yes' : 'No']),
}));
wireExport('exportAudit', null, async () => ({
  file: 'audit-logs', header: ['Created at', 'Handled by', 'Module', 'Action', 'Description', 'IP address'],
  rows: (await fetchAll<ApiAudit>('/audit-logs', {
    search: ($<HTMLInputElement>('#auditSearch')?.value ?? '').trim(), sort: AUDIT_SORT_KEYS[auditSort.field] ?? 'created_at', dir: auditSort.direction === 1 ? 'asc' : 'desc',
  })).map((a) => [a.CreatedAt, a.HandledBy, a.Module, a.Action, a.Description, a.IpAddress]),
}));

/* ---------- Reports (Admin) ---------- */
type Group = 'day' | 'month' | 'year';
type ApiSalesSummary = {
  from: string | null; to: string | null; group: Group;
  totals: { SalesCount: number | string; TotalSales: string; Subtotal: string; Discounts: string; Vat: string; AverageOrder: string; UnitsSold: number | string; UnitsReturned: number | string };
  periods: Array<{ Period: string; SalesCount: number | string; TotalSales: string }>;
  top_products: Array<{ ProductID: number; SKU: string; ProductName: string; UnitsSold: number | string; UnitsReturned: number | string; LineRevenue: string }>;
  payment_methods: Array<{ PaymentMethod: string; SalesCount: number | string; TotalSales: string }>;
  categories: Array<{ Category: string; UnitsSold: number | string; LineRevenue: string }>;
};
let report: ApiSalesSummary | null = null;
let reportLow: Item[] = [];
let reportAsTable = false;
let reportRequest = 0;
let reportChartWidth = 0;

const parseIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const reportInput = (id: string) => $<HTMLInputElement>(`#${id}`);

function applyReportPreset(preset: string) {
  const to = new Date(), from = new Date();
  if (preset === 'year') from.setMonth(0, 1); else from.setDate(from.getDate() - (Number(preset) - 1));
  reportInput('reportFrom').value = isoDate(from);
  reportInput('reportTo').value = isoDate(to);
  $<HTMLSelectElement>('#reportGroup').value = preset === 'year' ? 'month' : 'day';
  document.querySelectorAll<HTMLButtonElement>('#reportPresets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === preset));
}
applyReportPreset('30');

/** Every day / month / year between the two dates, so quiet periods show as empty columns instead of disappearing. */
function periodKeys(from: string, to: string, group: Group): string[] {
  const keys: string[] = [];
  const d = parseIso(from), end = parseIso(to);
  if (group === 'month') d.setDate(1); else if (group === 'year') d.setMonth(0, 1);
  while (d <= end && keys.length < 400) {
    if (group === 'day') { keys.push(isoDate(d)); d.setDate(d.getDate() + 1); }
    else if (group === 'month') { keys.push(isoDate(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); }
    else { keys.push(String(d.getFullYear())); d.setFullYear(d.getFullYear() + 1); }
  }
  return keys;
}
function periodLabel(key: string, group: Group): { label: string; full: string } {
  if (group === 'year') return { label: key, full: key };
  if (group === 'month') { const d = parseIso(`${key}-01`); return { label: d.toLocaleDateString([], { month: 'short', year: 'numeric' }), full: d.toLocaleDateString([], { month: 'long', year: 'numeric' }) }; }
  const d = parseIso(key);
  return { label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), full: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) };
}
function reportSeries() {
  if (!report) return [];
  const byKey = new Map(report.periods.map((p) => [p.Period, p]));
  const keys = report.from && report.to ? periodKeys(report.from, report.to, report.group) : report.periods.map((p) => p.Period);
  return keys.map((key) => {
    const found = byKey.get(key);
    return { key, ...periodLabel(key, report!.group), cents: toCents(found?.TotalSales ?? 0), sales: Number(found?.SalesCount ?? 0) };
  });
}

function shareRows(rows: Array<{ name: string; cents: number; detail: string }>): string {
  const total = rows.reduce((sum, r) => sum + r.cents, 0);
  if (!rows.length) return '<p class="report-empty">No sales in this date range.</p>';
  return rows.map((r) => {
    const pct = total > 0 ? (r.cents / total) * 100 : 0;
    return `<div class="share-row"><div class="share-top"><span>${esc(r.name)}</span><b>${peso(r.cents / 100)}</b></div><div class="share-track" role="img" aria-label="${esc(`${r.name}: ${pct.toFixed(0)}% of sales`)}"><i style="width:${pct.toFixed(1)}%"></i></div><small>${esc(r.detail)} · ${pct.toFixed(0)}%</small></div>`;
  }).join('');
}

function renderReportChart() {
  const host = $<HTMLDivElement>('#reportChart');
  if (!host || !report) return;
  const series = reportSeries();
  const unit = report.group;
  $('#reportChartTitle').textContent = `Sales per ${unit}`;
  const points: ChartPoint[] = series.map((p) => ({ label: p.label, fullLabel: p.full, value: p.cents / 100, note: `${p.sales} ${p.sales === 1 ? 'sale' : 'sales'}` }));
  reportChartWidth = host.clientWidth;
  drawBarChart(host, points, `Sales per ${unit}`);
  $('#reportChartTable').innerHTML = `<table class="users-table report-table"><thead><tr><th>${unit === 'day' ? 'Day' : unit === 'month' ? 'Month' : 'Year'}</th><th class="num-col">Sales</th><th class="num-col">Total</th></tr></thead><tbody>${
    series.map((p) => `<tr><td>${esc(p.full)}</td><td class="num">${p.sales}</td><td class="num">${peso(p.cents / 100)}</td></tr>`).join('') || '<tr><td class="users-empty" colspan="3">No sales in this date range.</td></tr>'}</tbody></table>`;
}

function renderReport() {
  if (!report) return;
  const t = report.totals;
  const sold = Number(t.UnitsSold), returned = Number(t.UnitsReturned);
  const tiles: Array<[string, string, string, string]> = [
    ['Total sales', peso(Number(t.TotalSales)), 'Paid orders, VAT included', 'hero'],
    ['Orders', String(Number(t.SalesCount)), 'Completed sales', ''],
    ['Average order', peso(Number(t.AverageOrder)), 'Per completed sale', ''],
    ['Net units sold', String(sold - returned), `${returned} returned`, ''],
    ['Discounts given', peso(Number(t.Discounts)), 'Taken off the subtotal', ''],
    ['VAT collected', peso(Number(t.Vat)), 'Added to paid orders', ''],
  ];
  $('#reportKpis').innerHTML = tiles.map(([label, value, note, cls]) => `<div class="kpi ${cls}"><span class="kpi-label">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
  renderReportChart();

  $('#reportTop').innerHTML = report.top_products.length
    ? `<thead><tr><th>Product</th><th class="num-col">Units</th><th class="num-col">Returned</th><th class="num-col">Revenue</th></tr></thead><tbody>${report.top_products.map((p) =>
      `<tr><td class="product-name-cell" title="${esc(p.ProductName)}"><span class="product-sku-cell">${esc(p.SKU)}</span> ${esc(p.ProductName)}</td><td class="num">${Number(p.UnitsSold)}</td><td class="num">${Number(p.UnitsReturned)}</td><td class="num">${peso(Number(p.LineRevenue))}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="users-empty">No sales in this date range.</td></tr></tbody>';

  $('#reportLowCount').textContent = String(reportLow.length);
  $('#reportLow').innerHTML = reportLow.length
    ? `<thead><tr><th>Product</th><th class="num-col">On hand</th><th class="num-col">Low at</th><th></th></tr></thead><tbody>${reportLow.map((i) =>
      `<tr><td class="product-name-cell" title="${esc(i.name)}"><span class="product-sku-cell">${esc(i.sku)}</span> ${esc(i.name)}</td><td class="num${i.qty <= 0 ? ' out' : ''}">${i.qty} <span class="unit">${esc(i.unit)}</span></td><td class="num">${i.reorder}</td><td class="report-action"><button type="button" class="text-action" data-restock-sku="${esc(i.sku)}">Restock</button></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="users-empty">Nothing is running low. Every product is at or above its low-stock level.</td></tr></tbody>';

  $('#reportPayments').innerHTML = shareRows(report.payment_methods.map((p) => ({ name: p.PaymentMethod, cents: toCents(p.TotalSales), detail: `${Number(p.SalesCount)} ${Number(p.SalesCount) === 1 ? 'sale' : 'sales'}` })));
  $('#reportCategories').innerHTML = shareRows(report.categories.map((c) => ({ name: c.Category, cents: toCents(c.LineRevenue), detail: `${Number(c.UnitsSold)} units` })));
}

async function loadReport() {
  const from = reportInput('reportFrom').value, to = reportInput('reportTo').value;
  let group = $<HTMLSelectElement>('#reportGroup').value as Group;
  const panel = $('#reportsPanel');
  if (from && to && from > to) { setUsersMessage('reportsMessage', 'The start date must be on or before the end date.', 'err'); return; }
  let note = '';
  if (group === 'day' && from && to && (parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000 > 366) {
    group = 'month'; $<HTMLSelectElement>('#reportGroup').value = 'month'; note = 'More than a year selected, so the chart is grouped by month.';
  }
  const ticket = ++reportRequest;
  panel?.classList.add('is-loading');
  try {
    const [summary, low] = await Promise.all([
      api<ApiSalesSummary>('GET', '/sales/summary' + qs({ from, to, group })),
      fetchAll<ApiProduct>('/products', { low_stock: 1 }),
    ]);
    if (ticket !== reportRequest) return;
    report = summary; reportLow = low.map(mapItem);
    setUsersMessage('reportsMessage', note);
    renderReport();
  } catch (err) {
    if (ticket === reportRequest) setUsersMessage('reportsMessage', errMsg(err), 'err');
  } finally {
    if (ticket === reportRequest) panel?.classList.remove('is-loading');
  }
}

$('#reportPresets')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-preset]');
  if (!button) return;
  applyReportPreset(button.dataset.preset!); void loadReport();
});
['reportFrom', 'reportTo'].forEach((id) => reportInput(id)?.addEventListener('change', () => {
  document.querySelectorAll('#reportPresets button').forEach((b) => b.classList.remove('active'));
  void loadReport();
}));
$('#reportGroup')?.addEventListener('change', () => { void loadReport(); });
$('#reportTableToggle')?.addEventListener('click', (event) => {
  reportAsTable = !reportAsTable;
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = reportAsTable ? 'View as chart' : 'View as table';
  button.setAttribute('aria-pressed', String(reportAsTable));
  $('#reportChart').hidden = reportAsTable;
  $('#reportChartTable').hidden = !reportAsTable;
});
$('#reportLow')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-restock-sku]');
  if (!button) return;
  switchView('movement');
  $<HTMLInputElement>('#sku').value = button.dataset.restockSku ?? '';
  updateSkuHint();
  $<HTMLInputElement>('#qty').focus();
});
// Redraw the chart when its box changes width (window resize, side panels)
const reportChartHost = $('#reportChart');
if (reportChartHost) {
  let redrawTimer: number | undefined;
  new ResizeObserver(() => {
    window.clearTimeout(redrawTimer);
    redrawTimer = window.setTimeout(() => { if (report && Math.abs(reportChartHost.clientWidth - reportChartWidth) > 1 && reportChartHost.clientWidth > 0) renderReportChart(); }, 120);
  }).observe(reportChartHost);
}

wireExport('exportReport', 'reportsMessage', async () => {
  if (!report) throw new ApiError(0, 'Open a date range first, then export.');
  const t = report.totals;
  const range = `${report.from ?? 'start'} to ${report.to ?? 'today'}`;
  const rows: CsvCell[][] = [
    ['Range', range, '', '', '', `Grouped by ${report.group}`],
    ['Summary', 'Total sales', Number(t.SalesCount), '', t.TotalSales, 'Orders'],
    ['Summary', 'Average order', '', '', t.AverageOrder, ''],
    ['Summary', 'Net units sold', '', Number(t.UnitsSold) - Number(t.UnitsReturned), '', `${Number(t.UnitsReturned)} returned`],
    ['Summary', 'Discounts given', '', '', t.Discounts, ''],
    ['Summary', 'VAT collected', '', '', t.Vat, ''],
    ...reportSeries().map((p) => ['Sales by period', p.key, p.sales, '', money(p.cents), ''] as CsvCell[]),
    ...report.top_products.map((p) => ['Top products', `${p.SKU} ${p.ProductName}`, '', Number(p.UnitsSold), p.LineRevenue, `${Number(p.UnitsReturned)} returned`] as CsvCell[]),
    ...report.payment_methods.map((p) => ['Payment methods', p.PaymentMethod, Number(p.SalesCount), '', p.TotalSales, ''] as CsvCell[]),
    ...report.categories.map((c) => ['Sales by category', c.Category, '', Number(c.UnitsSold), c.LineRevenue, ''] as CsvCell[]),
    ...reportLow.map((i) => ['Low stock', `${i.sku} ${i.name}`, '', i.qty, '', `Low-stock level ${i.reorder}`] as CsvCell[]),
  ];
  return { file: 'report', header: ['Section', 'Name', 'Orders', 'Units', 'Amount (PHP)', 'Note'], rows };
});

/* ---------- Loading overlay ---------- */
function hideLoader() {
  const loader = $('#loadingOverlay');
  if (loader) {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 600); // clean up DOM
  }
}
function showLoadError(err: unknown) {
  const card = $('.loading-card');
  const text = $('.loading-text');
  if (!card || !text) return;
  card.classList.add('has-error');
  text.textContent = errMsg(err);
  if (!card.querySelector('.loading-retry')) {
    const wrap = document.createElement('div');
    wrap.className = 'loading-retry';
    wrap.innerHTML = '<button type="button" class="btn-outline" id="retryLoad">Try again</button>';
    card.appendChild(wrap);
    wrap.querySelector('#retryLoad')?.addEventListener('click', () => {
      card.classList.remove('has-error'); text.textContent = 'Initializing warehouse...'; wrap.remove();
      void boot();
    });
  }
}

/* ---------- Logout ---------- */
$('#logoutBtn')?.addEventListener('click', async () => {
  await api('POST', '/auth/logout').catch(() => undefined);   // ends this login on the server
  goToLogin();
});

/* ---------- Footer Nav Submenus ---------- */
document.querySelectorAll<HTMLButtonElement>('.nav-item.has-submenu').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent document click from immediately closing it

    const group = btn.closest('.nav-group');
    const submenu = group?.querySelector('.nav-submenu');

    // Close other submenus
    document.querySelectorAll('.nav-submenu.open').forEach(openSub => {
      if (openSub !== submenu) {
        openSub.classList.remove('open');
        const openGroup = openSub.closest('.nav-group');
        openGroup?.classList.remove('open');
        openGroup?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')?.setAttribute('aria-expanded', 'false');
      }
    });

    if (group && submenu) {
      const isOpen = !submenu.classList.contains('open');
      group.classList.toggle('open', isOpen);
      submenu.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', String(isOpen));
    }
  });
});

// Close submenus when clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.nav-group')) {
    document.querySelectorAll('.nav-submenu.open').forEach(openSub => {
      openSub.classList.remove('open');
      const openGroup = openSub.closest('.nav-group');
      openGroup?.classList.remove('open');
      openGroup?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')?.setAttribute('aria-expanded', 'false');
    });
  }
});

/* ---------- Roles: hide what only an Admin may use ---------- */
document.querySelectorAll<HTMLElement>('[data-admin-only]').forEach((el) => { el.hidden = !isAdmin; });

/* ---------- Navigation & Views ---------- */
type View = 'dashboard' | 'movement' | 'products' | 'categories' | 'settings' | 'sales' | 'suppliers' | 'auditLogs' | 'users' | 'reports';
const ADMIN_VIEWS: View[] = ['categories', 'suppliers', 'auditLogs', 'users', 'reports'];
const dashboardView = $('#dashboardView');
const movementView = $('#movementView');
const settingsView = $('#settingsView');
const salesView = $('#salesView');
const suppliersView = $('#suppliersView');
const productsView = $('#productsView');
const reportsView = $('#reportsView');
const categoriesView = $('#categoriesView');
const auditLogsView = $('#auditLogsView');
const usersView = $('#usersView');
const navDashboard = $('#navDashboard');
const navSettings = $('#navSettings');
const navSuppliers = $('#navSuppliers');
const navAuditLogs = $('#navAuditLogs');
const navUsers = $('#navUsers');
const navReports = $('#navReports');
const salesNavGroup = $('#salesNavGroup');
const inventoryNavGroup = $('#inventoryNavGroup');

function fillSettings() {
  const settingUser = $<HTMLElement>('#settingUser');
  const settingRole = $<HTMLElement>('#settingRole');
  if (settingUser) settingUser.textContent = session.username;
  if (settingRole) settingRole.textContent = roleLabel(session.role);
}

/** Fetches whatever a page shows each time it is opened, so it is never stale. */
async function loadView(view: View) {
  try {
    if (view === 'suppliers') { await loadSuppliers(); renderSuppliers(); }
    else if (view === 'categories') { await loadCategories(); renderCategories(); }
    else if (view === 'users') { await loadUsers(); renderUsers(); }
    else if (view === 'auditLogs') { await loadAudit(); }
    else if (view === 'sales') { await refreshSales(); }
    else if (view === 'movement') { await Promise.all([loadItems(), isAdmin ? loadCategories() : Promise.resolve()]); renderUI(); }
    else if (view === 'products') { await Promise.all([loadItems(), loadCategories()]); renderUI(); }
    else if (view === 'reports') { await loadReport(); }
    else if (view === 'dashboard') { await Promise.all([loadItems(), loadMovements()]); renderUI(); }
  } catch (err) {
    const target: Partial<Record<View, string>> = { suppliers: 'suppliersMessage', categories: 'categoriesMessage', users: 'usersMessage', products: 'productsMessage' };
    if (target[view]) setUsersMessage(target[view]!, errMsg(err), 'err');
    else if (view === 'movement') say(errMsg(err));
  }
}

let currentView: View | null = null;
function switchView(requested: View) {
  const view: View = !isAdmin && ADMIN_VIEWS.includes(requested) ? 'dashboard' : requested;   // the server refuses these too
  if (!dashboardView || !movementView || !settingsView || !salesView || !suppliersView || !categoriesView || !auditLogsView || !usersView || !productsView || !reportsView || !navDashboard || !navSettings) return;
  dashboardView.style.display = view === 'dashboard' ? '' : 'none';
  movementView.style.display = view === 'movement' ? '' : 'none';
  settingsView.style.display = view === 'settings' ? 'block' : 'none';
  salesView.style.display = view === 'sales' ? '' : 'none';
  suppliersView.style.display = view === 'suppliers' ? '' : 'none';
  categoriesView.style.display = view === 'categories' ? '' : 'none';
  auditLogsView.style.display = view === 'auditLogs' ? '' : 'none';
  usersView.style.display = view === 'users' ? '' : 'none';
  productsView.style.display = view === 'products' ? '' : 'none';
  reportsView.style.display = view === 'reports' ? '' : 'none';
  navDashboard.classList.toggle('active', view === 'dashboard');
  navSettings.classList.toggle('active', view === 'settings');
  navSuppliers?.classList.toggle('active', view === 'suppliers');
  navAuditLogs?.classList.toggle('active', view === 'auditLogs');
  navUsers?.classList.toggle('active', view === 'users');
  navReports?.classList.toggle('active', view === 'reports');
  salesNavGroup?.classList.toggle('active', view === 'sales');
  inventoryNavGroup?.classList.toggle('active', view === 'movement' || view === 'categories' || view === 'products');

  if (view === 'settings') fillSettings();
  if (view === 'dashboard') resize(); // Refresh the 3D canvas when returning to the dashboard.

  // Sync URL hash
  const hashes: Record<View, string> = { dashboard: '', movement: '#movement', products: '#products', reports: '#reports', categories: '#categories', settings: '#settings', sales: salesMode === 'returns' ? '#sales-returns' : '#sales-pos', suppliers: '#suppliers', auditLogs: '#audit-logs', users: '#users' };
  if (window.location.hash !== hashes[view]) {
    if (hashes[view]) window.location.hash = hashes[view]; else if (window.location.hash) window.location.hash = '';
  }

  if (view !== currentView) { currentView = view; void loadView(view); }
}

navDashboard?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('dashboard');
});

navSettings?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('settings');
});

navUsers?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('users');
});

navSuppliers?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('suppliers');
});

navReports?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('reports');
});

navAuditLogs?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('auditLogs');
});

document.querySelectorAll<HTMLAnchorElement>('[data-sales-destination]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  showSalesView(link.dataset.salesDestination as 'pos' | 'returns');
  switchView('sales');
  link.closest('.nav-submenu')?.classList.remove('open');
  const group = link.closest('.nav-group');
  group?.classList.remove('open');
  group?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')?.setAttribute('aria-expanded', 'false');
}));

document.querySelectorAll<HTMLAnchorElement>('[data-inventory-destination]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const destination = link.dataset.inventoryDestination;
  switchView(destination === 'categories' ? 'categories' : destination === 'products' ? 'products' : 'movement');
  if (destination === 'movement') $<HTMLInputElement>('#sku')?.focus();
  const group = link.closest('.nav-group');
  group?.classList.remove('open');
  group?.querySelector('.nav-submenu')?.classList.remove('open');
  group?.querySelector<HTMLButtonElement>('.nav-item.has-submenu')?.setAttribute('aria-expanded', 'false');
}));

$<HTMLButtonElement>('#backToDashboardBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('dashboard');
});

// Check URL hash on page load and on popstate/hashchange
function checkInitialHash() {
  const hash = window.location.hash;
  if (hash === '#settings') switchView('settings');
  else if (hash === '#users') switchView('users');
  else if (hash === '#categories') switchView('categories');
  else if (hash === '#movement') switchView('movement');
  else if (hash === '#products') switchView('products');
  else if (hash === '#reports') switchView('reports');
  else if (hash === '#suppliers') switchView('suppliers');
  else if (hash === '#audit-logs') switchView('auditLogs');
  else if (hash === '#sales-pos' || hash === '#sales-returns') {
    showSalesView(hash === '#sales-returns' ? 'returns' : 'pos');
    switchView('sales');
  } else switchView('dashboard');
}
window.addEventListener('hashchange', checkInitialHash);

/* ---------- Settings Modals ---------- */
function openModal(id: string) {
  $<HTMLDivElement>(`#${id}`)?.classList.add('open');
}
function closeModal(id: string) {
  $<HTMLDivElement>(`#${id}`)?.classList.remove('open');
}
// Escape closes whichever dialog is open
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('.settings-modal-overlay.open').forEach((el) => el.classList.remove('open'));
});
function setModalMsg(msgId: string, text: string, isOk = false) {
  const el = $<HTMLParagraphElement>(`#${msgId}`);
  if (!el) return;
  el.textContent = text;
  el.className = 'smodal-msg ' + (isOk ? 'ok' : 'err');
}

// Open/close wiring
$('#openChangeUsername')?.addEventListener('click', () => {
  ($<HTMLFormElement>('#usernameForm'))?.reset();
  setModalMsg('unMsg', '');
  openModal('usernameModal');
  setTimeout(() => $<HTMLInputElement>('#unCurrentPass')?.focus(), 100);
});
$('#closeUsernameModal')?.addEventListener('click',  () => closeModal('usernameModal'));
$('#cancelUsernameModal')?.addEventListener('click', () => closeModal('usernameModal'));

$('#openChangePassword')?.addEventListener('click', () => {
  ($<HTMLFormElement>('#passwordForm'))?.reset();
  setModalMsg('pwMsg', '');
  openModal('passwordModal');
  setTimeout(() => $<HTMLInputElement>('#pwCurrentPass')?.focus(), 100);
});
$('#closePasswordModal')?.addEventListener('click',  () => closeModal('passwordModal'));
$('#cancelPasswordModal')?.addEventListener('click', () => closeModal('passwordModal'));

// Close on backdrop click
['usernameModal', 'passwordModal'].forEach(id => {
  $<HTMLDivElement>(`#${id}`)?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === id) closeModal(id);
  });
});

/* ── Change Username (the server checks the current password) ── */
$<HTMLFormElement>('#usernameForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = ($<HTMLInputElement>('#unCurrentPass')).value;
  const newName = ($<HTMLInputElement>('#unNewName')).value.trim();
  if (!newName || newName.length < 3) return setModalMsg('unMsg', 'Username must be at least 3 characters.');

  await busy($<HTMLButtonElement>('#usernameForm button[type="submit"]'), async () => {
    try {
      await api('POST', '/auth/change-username', { CurrentPassword: currentPassword, NewUsername: newName });
      session = { ...session, username: newName.toLowerCase() };
      updateSession({ username: session.username });
      fillSettings();
      setModalMsg('unMsg', 'Username updated successfully!', true);
      setTimeout(() => { closeModal('usernameModal'); fillSettings(); }, 1200);
    } catch (err) { setModalMsg('unMsg', errMsg(err)); }
  });
});

/* ── Change Password (the server checks the current password, then signs you out everywhere) ── */
$<HTMLFormElement>('#passwordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPass = ($<HTMLInputElement>('#pwCurrentPass')).value;
  const newPass     = ($<HTMLInputElement>('#pwNewPass')).value;
  const confirmPass = ($<HTMLInputElement>('#pwConfirmPass')).value;

  if (newPass.length < 8) return setModalMsg('pwMsg', 'New password must be at least 8 characters.');
  if (newPass !== confirmPass) return setModalMsg('pwMsg', 'Passwords do not match.');

  await busy($<HTMLButtonElement>('#passwordForm button[type="submit"]'), async () => {
    try {
      await api('POST', '/auth/change-password', { CurrentPassword: currentPass, NewPassword: newPass });
      setModalMsg('pwMsg', 'Password changed! Signing you out…', true);
      setTimeout(() => goToLogin(), 1500);
    } catch (err) { setModalMsg('pwMsg', errMsg(err)); }
  });
});

/* ---------- Start up ---------- */
async function boot() {
  try {
    const meta = await api<{ VatRate: string }>('GET', '/meta');
    vatRate = Number(meta.VatRate);
    await Promise.all([loadItems(), loadMovements(), loadCategories(), loadSalesData()]);
    renderUI();
    resize();
    hideLoader();
  } catch (err) {
    showLoadError(err);
  }
}

/** Keeps stock and sales fresh when other people are working at the same time. Skipped while you are typing. */
const typing = () => { const a = document.activeElement; return a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement; };
async function refreshLive() {
  if (document.hidden || typing() || $('#loadingOverlay')) return;
  try {
    await Promise.all([loadItems(), loadMovements(), loadSalesData()]);
    scene3d.sync();
    renderUI();
  } catch { /* try again next time */ }
}
window.setInterval(() => { void refreshLive(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshLive(); });

checkInitialHash();
void boot();
