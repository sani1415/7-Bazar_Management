/* বাজার ম্যানেজমেন্ট - App logic. Data goes through the Cloudflare Worker /api. */

const USE_LOCAL_STORAGE = false;

function getNetworkErrorMessage(err) {
    var msg = (err && (err.message || err.details || '')) || '';
    if (/failed to fetch|network|ERR_NAME_NOT_RESOLVED|load failed/i.test(msg)) {
        return 'সার্ভারে সংযোগ হচ্ছে না। ইন্টারনেট চেক করুন।';
    }
    return msg || 'লোড করতে সমস্যা হয়েছে';
}

async function api(path, options) {
    const response = await fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
    if (!response.ok) {
        const body = await response.json().catch(function () { return {}; });
        const error = new Error(body && body.error ? body.error : 'Request failed (' + response.status + ')');
        error.status = response.status;
        throw error;
    }
    if (response.status === 204) return null;
    return response.json();
}

async function uploadImage(file) {
    const form = new FormData();
    form.append('file', file);
    const data = await api('/api/images', { method: 'POST', body: form });
    return data.url;
}

let moneyLogCache = [];

async function refreshMoneyLog() {
    if (USE_LOCAL_STORAGE) return;
    let rows = await api('/api/money');
    if ((!rows || !rows.length)) {
        const local = _getAddMoneyLog();
        if (local.length) {
            for (let i = 0; i < local.length; i++) {
                await api('/api/money', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ date: local[i].date, amount: local[i].amount })
                });
            }
            localStorage.removeItem(LS_ADD_MONEY_LOG);
            rows = await api('/api/money');
        }
    }
    moneyLogCache = rows || [];
}

// ---------- LocalStorage adapter ----------
const LS_ENTRIES = 'bazar_entries';
const LS_ITEMS = 'bazar_items';
const LS_TOTAL_ADDED = 'bazar_total_added';  // Legacy: single total (migrated to log)
const LS_ADD_MONEY_LOG = 'bazar_add_money_log';  // [{ date, amount }, ...] – when you gave money

function _getAddMoneyLog() {
    try {
        const raw = localStorage.getItem(LS_ADD_MONEY_LOG);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function _saveAddMoneyLog(log) {
    try {
        localStorage.setItem(LS_ADD_MONEY_LOG, JSON.stringify(log));
    } catch (e) { /* ignore */ }
}

// Migrate old single total into one log entry so we don't lose data
function _migrateAddMoneyLogIfNeeded() {
    const log = _getAddMoneyLog();
    if (log.length > 0) return;
    const v = localStorage.getItem(LS_TOTAL_ADDED);
    const num = v != null ? parseFloat(v) : NaN;
    if (!isNaN(num) && num > 0) {
        _saveAddMoneyLog([{ date: new Date().toISOString().split('T')[0], amount: num }]);
        localStorage.removeItem(LS_TOTAL_ADDED);
    }
}

function getTotalAdded() {
    _migrateAddMoneyLogIfNeeded();
    const log = USE_LOCAL_STORAGE ? _getAddMoneyLog() : moneyLogCache;
    return log.reduce((sum, e) => sum + Number(e.amount || 0), 0);
}

function getAddMoneyLog() {
    _migrateAddMoneyLogIfNeeded();
    const log = USE_LOCAL_STORAGE ? _getAddMoneyLog() : moneyLogCache;
    return log.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

async function addMoney(amount) {
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) return false;
    if (USE_LOCAL_STORAGE) {
        const log = _getAddMoneyLog();
        log.push({ date: new Date().toISOString().split('T')[0], amount: n });
        _saveAddMoneyLog(log);
        return true;
    }
    await api('/api/money', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: new Date().toISOString().split('T')[0], amount: n })
    });
    await refreshMoneyLog();
    return true;
}

// ---------- Edit log (পরিবর্তনের ইতিহাস) ----------
const LS_EDIT_LOG = 'bazar_edit_log';

async function getEditLog() {
    if (USE_LOCAL_STORAGE) {
        try {
            const raw = localStorage.getItem(LS_EDIT_LOG);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    } else {
        // Fetch from Supabase edit_log table
        try {
            const data = await api('/api/edit-log');
            return data || [];
        } catch (error) {
            console.error('Error fetching edit log:', error);
            return [];
        }
    }
}

async function addToEditLog(entryId, entryDate, previousTotal, newTotal, summary) {
    if (USE_LOCAL_STORAGE) {
        const log = await getEditLog();
        log.unshift({
            entry_id: entryId,
            entry_date: entryDate,
            edited_at: new Date().toISOString(),
            previous_total: previousTotal,
            new_total: newTotal,
            summary: summary || null
        });
        try {
            localStorage.setItem(LS_EDIT_LOG, JSON.stringify(log));
        } catch (e) { /* ignore */ }
    } else {
        await api('/api/edit-log', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                entry_id: entryId,
                entry_date: entryDate,
                previous_total: previousTotal,
                new_total: newTotal,
                summary: summary || null
            })
        });
    }
}

// Balance = money you gave - total spent (all entries). Positive = he has in hand, Negative = you owe him
function getBalance() {
    const totalAdded = getTotalAdded();
    const entries = USE_LOCAL_STORAGE ? localStorageAdapter._getEntries() : [];
    const totalSpent = entries.reduce((sum, e) => sum + Number(e.total_cost || 0), 0);
    return totalAdded - totalSpent;
}

async function getBalanceAsync() {
    const totalAdded = getTotalAdded();
    let totalSpent = 0;
    if (USE_LOCAL_STORAGE) {
        const entries = localStorageAdapter._getEntries();
        totalSpent = entries.reduce((sum, e) => sum + Number(e.total_cost || 0), 0);
    } else {
        const entries = await storage.getEntriesInDateRange('2000-01-01', '2099-12-31');
        totalSpent = (entries || []).reduce((sum, e) => sum + Number(e.total_cost || 0), 0);
    }
    return totalAdded - totalSpent;
}

const localStorageAdapter = {
    _getEntries() {
        try {
            return JSON.parse(localStorage.getItem(LS_ENTRIES) || '[]');
        } catch (e) { return []; }
    },
    _getItems() {
        try {
            return JSON.parse(localStorage.getItem(LS_ITEMS) || '[]');
        } catch (e) { return []; }
    },
    _saveEntries(entries) { localStorage.setItem(LS_ENTRIES, JSON.stringify(entries)); },
    _saveItems(items) { localStorage.setItem(LS_ITEMS, JSON.stringify(items)); },

    async saveEntry(entryData, items, billFile) {
        const entries = this._getEntries();
        const allItems = this._getItems();
        const id = Date.now();
        const now = new Date().toISOString();
        const entry = {
            id,
            entry_date: entryData.entry_date,
            total_cost: entryData.total_cost,
            item_count: entryData.item_count,
            comment: entryData.comment || null,
            payment_status: entryData.payment_status || 'pending',
            bill_image_url: entryData.bill_image_url || null, // For localStorage, it's already base64
            created_at: now,
            updated_at: now
        };
        entries.push(entry);
        items.forEach((it, i) => {
            allItems.push({
                id: id * 1000 + i,
                entry_id: id,
                item_name: it.name,
                quantity: it.quantity,
                unit: it.unit,
                price_per_unit: it.price_per_unit,
                total_price: it.total_price,
                category: it.category,
                memo_image_url: it.memo_image_url || null,
                created_at: now
            });
        });
        this._saveEntries(entries);
        this._saveItems(allItems);
        return { id };
    },

    async getEntries(limit = 20) {
        const entries = this._getEntries();
        const allItems = this._getItems();
        const sorted = entries.slice().sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
        const slice = sorted.slice(0, limit);
        return slice.map(e => ({
            ...e,
            grocery_items: allItems.filter(it => it.entry_id === e.id).map(it => ({ memo_image_url: it.memo_image_url }))
        }));
    },

    async getEntriesInMonth(firstDayOfMonth) {
        const entries = this._getEntries();
        return entries.filter(e => (e.entry_date || '') >= firstDayOfMonth);
    },

    async getEntriesInDateRange(startDate, endDate) {
        const entries = this._getEntries();
        return entries
            .filter(e => {
                const d = e.entry_date || '';
                return d >= startDate && d <= endDate;
            })
            .sort((a, b) => {
                const cmp = (b.entry_date || '').localeCompare(a.entry_date || '');
                return cmp !== 0 ? cmp : (Number(b.id) - Number(a.id));
            });
    },

    async getItemsInMonth(firstDayOfMonth) {
        const items = this._getItems();
        return items.filter(it => (it.created_at || '').slice(0, 10) >= firstDayOfMonth);
    },

    async getItemsInDateRange(startDate, endDate) {
        const entries = await this.getEntriesInDateRange(startDate, endDate);
        const ids = (entries || []).map(e => e.id);
        const items = this._getItems();
        return items.filter(it => ids.indexOf(it.entry_id) >= 0);
    },

    async updatePaymentStatus(entryId, newStatus) {
        const entries = this._getEntries();
        const idx = entries.findIndex(e => e.id === entryId || e.id === Number(entryId));
        if (idx === -1) throw new Error('Entry not found');
        entries[idx].payment_status = newStatus;
        entries[idx].updated_at = new Date().toISOString();
        this._saveEntries(entries);
    },

    async getEntryById(entryId) {
        const entries = this._getEntries();
        const id = Number(entryId);
        const entry = entries.find(e => e.id === id);
        if (!entry) throw new Error('Entry not found');
        const allItems = this._getItems();
        const items = allItems.filter(it => it.entry_id === id);
        return { entry, items };
    },

    async updateEntry(entryId, entryData, items) {
        const entries = this._getEntries();
        const allItems = this._getItems();
        const id = Number(entryId);
        const idx = entries.findIndex(e => e.id === id);
        if (idx === -1) throw new Error('Entry not found');
        const now = new Date().toISOString();
        entries[idx] = {
            ...entries[idx],
            entry_date: entryData.entry_date,
            total_cost: entryData.total_cost,
            item_count: entryData.item_count,
            comment: entryData.comment || null,
            updated_at: now
        };
        const newItems = allItems.filter(it => it.entry_id !== id);
        items.forEach((it, i) => {
            newItems.push({
                id: id * 1000 + i,
                entry_id: id,
                item_name: it.name,
                quantity: it.quantity,
                unit: it.unit,
                price_per_unit: it.price_per_unit,
                total_price: it.total_price,
                category: it.category,
                memo_image_url: it.memo_image_url || null,
                created_at: now
            });
        });
        this._saveEntries(entries);
        this._saveItems(newItems);
    },

    async deleteEntry(entryId) {
        const id = Number(entryId);
        const { entry, items } = await this.getEntryById(id);
        await addToEditLog(entry.id, entry.entry_date, Number(entry.total_cost) || 0, 0, 'Entry deleted');
        const entries = this._getEntries().filter(function (e) { return e.id !== id; });
        const allItems = this._getItems().filter(function (it) { return it.entry_id !== id; });
        this._saveEntries(entries);
        this._saveItems(allItems);
    }
};

const cloudflareAdapter = {
    async saveEntry(entryData, items, billFile) {
        var billImageUrl = entryData.bill_image_url || null;
        if (billFile) {
            try { billImageUrl = await uploadImage(billFile); }
            catch (e) { console.warn('Bill file upload failed', e); }
        }
        const payloadItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let memoUrl = item.memo_image_url || null;
            if (item.memoFile) {
                try { memoUrl = await uploadImage(item.memoFile); }
                catch (e) { console.warn('Memo upload failed', e); }
            }
            payloadItems.push({
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                price_per_unit: item.price_per_unit,
                total_price: item.total_price,
                category: item.category,
                memo_image_url: memoUrl
            });
        }
        return api('/api/entries', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                entry_date: entryData.entry_date,
                total_cost: entryData.total_cost,
                item_count: entryData.item_count,
                comment: entryData.comment || null,
                payment_status: entryData.payment_status || 'pending',
                bill_image_url: billImageUrl,
                items: payloadItems
            })
        });
    },

    async getEntries(limit = 20) {
        return api('/api/entries?limit=' + encodeURIComponent(limit));
    },

    async getEntriesInMonth(firstDayOfMonth) {
        return api('/api/entries?from=' + encodeURIComponent(firstDayOfMonth) + '&to=2099-12-31&fields=summary');
    },

    async getEntriesInDateRange(startDate, endDate) {
        return api('/api/entries?from=' + encodeURIComponent(startDate) + '&to=' + encodeURIComponent(endDate));
    },

    async getItemsInMonth(firstDayOfMonth) {
        const entries = await this.getEntriesInDateRange(firstDayOfMonth, '2099-12-31');
        return (entries || []).flatMap(function (entry) { return entry.grocery_items || []; });
    },

    async getItemsInDateRange(startDate, endDate) {
        const entries = await this.getEntriesInDateRange(startDate, endDate);
        return (entries || []).flatMap(function (entry) { return entry.grocery_items || []; });
    },

    async updatePaymentStatus(entryId, newStatus) {
        await api('/api/entries/' + entryId + '/payment', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ payment_status: newStatus })
        });
    },

    async getEntryById(entryId) {
        return api('/api/entries/' + entryId);
    },

    async updateEntry(entryId, entryData, items) {
        var totalCost = Number(entryData.total_cost);
        if (!Number.isFinite(totalCost)) totalCost = 0;
        const itemsToInsert = items.map(function (item) {
            var qty = Number(item.quantity);
            var pricePerUnit = Number(item.price_per_unit);
            var totalPrice = Number(item.total_price);
            if (!Number.isFinite(totalPrice)) totalPrice = (Number.isFinite(qty) && Number.isFinite(pricePerUnit)) ? qty * pricePerUnit : 0;
            return {
                name: item.name,
                quantity: Number.isFinite(qty) ? qty : 0,
                unit: item.unit,
                price_per_unit: Number.isFinite(pricePerUnit) ? pricePerUnit : 0,
                total_price: totalPrice,
                category: item.category,
                memo_image_url: item.memo_image_url || null
            };
        });
        await api('/api/entries/' + entryId, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                entry_date: entryData.entry_date,
                total_cost: totalCost,
                item_count: entryData.item_count,
                comment: entryData.comment || null,
                bill_image_url: entryData.bill_image_url || null,
                items: itemsToInsert
            })
        });
    },

    async deleteEntry(entryId) {
        const { entry } = await this.getEntryById(entryId);
        await addToEditLog(entry.id, entry.entry_date, Number(entry.total_cost) || 0, 0, 'Entry deleted');
        await api('/api/entries/' + entryId, { method: 'DELETE' });
    }
};

const storage = USE_LOCAL_STORAGE ? localStorageAdapter : cloudflareAdapter;

// ---------- Example data (seed when empty) ----------
function seedExampleData() {
    const entries = localStorageAdapter._getEntries();
    if (entries.length > 0) return;

    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const lastMonth = now.getMonth() === 0
        ? (now.getFullYear() - 1) + '-12'
        : now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0');

    const exampleEntries = [
        { id: 1001, entry_date: thisMonth + '-09', total_cost: 950, item_count: 5, comment: null, payment_status: 'pending', created_at: thisMonth + '-09T08:30:00.000Z', updated_at: thisMonth + '-09T08:30:00.000Z' },
        { id: 1002, entry_date: thisMonth + '-07', total_cost: 1721, item_count: 6, comment: 'দাম একটু বেশি ছিল', payment_status: 'paid', created_at: thisMonth + '-07T09:15:00.000Z', updated_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1003, entry_date: thisMonth + '-05', total_cost: 920, item_count: 3, comment: null, payment_status: 'paid', created_at: thisMonth + '-05T07:45:00.000Z', updated_at: thisMonth + '-05T07:45:00.000Z' },
        { id: 1004, entry_date: thisMonth + '-03', total_cost: 3122, item_count: 8, comment: null, payment_status: 'pending', created_at: thisMonth + '-03T10:00:00.000Z', updated_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1005, entry_date: thisMonth + '-01', total_cost: 1680, item_count: 4, comment: null, payment_status: 'paid', created_at: thisMonth + '-01T08:00:00.000Z', updated_at: thisMonth + '-01T08:00:00.000Z' },
        { id: 1006, entry_date: lastMonth + '-28', total_cost: 2549, item_count: 7, comment: 'মাসের শেষ বাজার', payment_status: 'paid', created_at: lastMonth + '-28T09:30:00.000Z', updated_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1007, entry_date: lastMonth + '-25', total_cost: 1422, item_count: 5, comment: null, payment_status: 'paid', created_at: lastMonth + '-25T08:20:00.000Z', updated_at: lastMonth + '-25T08:20:00.000Z' },
        { id: 1008, entry_date: lastMonth + '-20', total_cost: 1980, item_count: 6, comment: null, payment_status: 'paid', created_at: lastMonth + '-20T07:50:00.000Z', updated_at: lastMonth + '-20T07:50:00.000Z' },
    ];

    const exampleItems = [
        { id: 1001001, entry_id: 1001, item_name: 'চাল', quantity: 5, unit: 'কেজি', price_per_unit: 70, total_price: 350, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-09T08:30:00.000Z' },
        { id: 1001002, entry_id: 1001, item_name: 'ডাল', quantity: 2, unit: 'কেজি', price_per_unit: 120, total_price: 240, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-09T08:30:00.000Z' },
        { id: 1001003, entry_id: 1001, item_name: 'তেল', quantity: 1, unit: 'লিটার', price_per_unit: 180, total_price: 180, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-09T08:30:00.000Z' },
        { id: 1001004, entry_id: 1001, item_name: 'পেঁয়াজ', quantity: 2, unit: 'কেজি', price_per_unit: 45, total_price: 90, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-09T08:30:00.000Z' },
        { id: 1001005, entry_id: 1001, item_name: 'আলু', quantity: 3, unit: 'কেজি', price_per_unit: 30, total_price: 90, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-09T08:30:00.000Z' },
        { id: 1002001, entry_id: 1002, item_name: 'চাল', quantity: 8, unit: 'কেজি', price_per_unit: 72, total_price: 576, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1002002, entry_id: 1002, item_name: 'মাছ', quantity: 1.5, unit: 'কেজি', price_per_unit: 450, total_price: 675, category: 'মাছ-মাংস', memo_image_url: null, created_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1002003, entry_id: 1002, item_name: 'মুরগি', quantity: 1, unit: 'কেজি', price_per_unit: 180, total_price: 180, category: 'মাছ-মাংস', memo_image_url: null, created_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1002004, entry_id: 1002, item_name: 'ডিম', quantity: 2, unit: 'হালি', price_per_unit: 90, total_price: 180, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1002005, entry_id: 1002, item_name: 'রসুন', quantity: 0.5, unit: 'কেজি', price_per_unit: 120, total_price: 60, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1002006, entry_id: 1002, item_name: 'মরিচ', quantity: 0.25, unit: 'কেজি', price_per_unit: 200, total_price: 50, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-07T09:15:00.000Z' },
        { id: 1003001, entry_id: 1003, item_name: 'তেল', quantity: 2, unit: 'লিটার', price_per_unit: 185, total_price: 370, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-05T07:45:00.000Z' },
        { id: 1003002, entry_id: 1003, item_name: 'পেঁয়াজ', quantity: 3, unit: 'কেজি', price_per_unit: 50, total_price: 150, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-05T07:45:00.000Z' },
        { id: 1003003, entry_id: 1003, item_name: 'সবজি (মিক্স)', quantity: 2, unit: 'কেজি', price_per_unit: 200, total_price: 400, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-05T07:45:00.000Z' },
        { id: 1004001, entry_id: 1004, item_name: 'চাল', quantity: 10, unit: 'কেজি', price_per_unit: 68, total_price: 680, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004002, entry_id: 1004, item_name: 'ডাল', quantity: 3, unit: 'কেজি', price_per_unit: 125, total_price: 375, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004003, entry_id: 1004, item_name: 'তেল', quantity: 3, unit: 'লিটার', price_per_unit: 175, total_price: 525, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004004, entry_id: 1004, item_name: 'মাছ', quantity: 2, unit: 'কেজি', price_per_unit: 420, total_price: 840, category: 'মাছ-মাংস', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004005, entry_id: 1004, item_name: 'ফলমূল', quantity: 1.5, unit: 'কেজি', price_per_unit: 120, total_price: 180, category: 'ফলমূল', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004006, entry_id: 1004, item_name: 'আলু', quantity: 5, unit: 'কেজি', price_per_unit: 28, total_price: 140, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004007, entry_id: 1004, item_name: 'পেঁয়াজ', quantity: 2, unit: 'কেজি', price_per_unit: 48, total_price: 96, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1004008, entry_id: 1004, item_name: 'ডিম', quantity: 3, unit: 'হালি', price_per_unit: 92, total_price: 275, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-03T10:00:00.000Z' },
        { id: 1005001, entry_id: 1005, item_name: 'চাল', quantity: 4, unit: 'কেজি', price_per_unit: 70, total_price: 280, category: 'মুদি', memo_image_url: null, created_at: thisMonth + '-01T08:00:00.000Z' },
        { id: 1005002, entry_id: 1005, item_name: 'মুরগি', quantity: 1.5, unit: 'কেজি', price_per_unit: 175, total_price: 262.5, category: 'মাছ-মাংস', memo_image_url: null, created_at: thisMonth + '-01T08:00:00.000Z' },
        { id: 1005003, entry_id: 1005, item_name: 'সবজি', quantity: 3, unit: 'কেজি', price_per_unit: 180, total_price: 540, category: 'সবজি', memo_image_url: null, created_at: thisMonth + '-01T08:00:00.000Z' },
        { id: 1005004, entry_id: 1005, item_name: 'অন্যান্য', quantity: 1, unit: 'পিস', price_per_unit: 597.5, total_price: 597.5, category: 'অন্যান্য', memo_image_url: null, created_at: thisMonth + '-01T08:00:00.000Z' },
        { id: 1006001, entry_id: 1006, item_name: 'চাল', quantity: 12, unit: 'কেজি', price_per_unit: 70, total_price: 840, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1006002, entry_id: 1006, item_name: 'ডাল', quantity: 4, unit: 'কেজি', price_per_unit: 118, total_price: 472, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1006003, entry_id: 1006, item_name: 'তেল', quantity: 2, unit: 'লিটার', price_per_unit: 182, total_price: 364, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1006004, entry_id: 1006, item_name: 'মাছ', quantity: 1, unit: 'কেজি', price_per_unit: 440, total_price: 440, category: 'মাছ-মাংস', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1006005, entry_id: 1006, item_name: 'আলু', quantity: 4, unit: 'কেজি', price_per_unit: 32, total_price: 128, category: 'সবজি', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1006006, entry_id: 1006, item_name: 'পেঁয়াজ', quantity: 2.5, unit: 'কেজি', price_per_unit: 42, total_price: 105, category: 'সবজি', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1006007, entry_id: 1006, item_name: 'ফলমূল', quantity: 2, unit: 'কেজি', price_per_unit: 100, total_price: 200, category: 'ফলমূল', memo_image_url: null, created_at: lastMonth + '-28T09:30:00.000Z' },
        { id: 1007001, entry_id: 1007, item_name: 'চাল', quantity: 6, unit: 'কেজি', price_per_unit: 68, total_price: 408, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-25T08:20:00.000Z' },
        { id: 1007002, entry_id: 1007, item_name: 'তেল', quantity: 1, unit: 'লিটার', price_per_unit: 178, total_price: 178, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-25T08:20:00.000Z' },
        { id: 1007003, entry_id: 1007, item_name: 'মুরগি', quantity: 1, unit: 'কেজি', price_per_unit: 185, total_price: 185, category: 'মাছ-মাংস', memo_image_url: null, created_at: lastMonth + '-25T08:20:00.000Z' },
        { id: 1007004, entry_id: 1007, item_name: 'ডিম', quantity: 2, unit: 'হালি', price_per_unit: 88, total_price: 176, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-25T08:20:00.000Z' },
        { id: 1007005, entry_id: 1007, item_name: 'সবজি', quantity: 2.5, unit: 'কেজি', price_per_unit: 190, total_price: 475, category: 'সবজি', memo_image_url: null, created_at: lastMonth + '-25T08:20:00.000Z' },
        { id: 1008001, entry_id: 1008, item_name: 'ডাল', quantity: 2, unit: 'কেজি', price_per_unit: 115, total_price: 230, category: 'মুদি', memo_image_url: null, created_at: lastMonth + '-20T07:50:00.000Z' },
        { id: 1008002, entry_id: 1008, item_name: 'মাছ', quantity: 2, unit: 'কেজি', price_per_unit: 435, total_price: 870, category: 'মাছ-মাংস', memo_image_url: null, created_at: lastMonth + '-20T07:50:00.000Z' },
        { id: 1008003, entry_id: 1008, item_name: 'পেঁয়াজ', quantity: 2, unit: 'কেজি', price_per_unit: 46, total_price: 92, category: 'সবজি', memo_image_url: null, created_at: lastMonth + '-20T07:50:00.000Z' },
        { id: 1008004, entry_id: 1008, item_name: 'আলু', quantity: 3, unit: 'কেজি', price_per_unit: 30, total_price: 90, category: 'সবজি', memo_image_url: null, created_at: lastMonth + '-20T07:50:00.000Z' },
        { id: 1008005, entry_id: 1008, item_name: 'ফলমূল', quantity: 1, unit: 'কেজি', price_per_unit: 140, total_price: 140, category: 'ফলমূল', memo_image_url: null, created_at: lastMonth + '-20T07:50:00.000Z' },
        { id: 1008006, entry_id: 1008, item_name: 'অন্যান্য', quantity: 1, unit: 'পিস', price_per_unit: 558, total_price: 558, category: 'অন্যান্য', memo_image_url: null, created_at: lastMonth + '-20T07:50:00.000Z' },
    ];

    localStorageAdapter._saveEntries(exampleEntries);
    localStorageAdapter._saveItems(exampleItems);
}

// ---------- Balance UI: show hand balance (positive or minus) ----------
async function updateBalanceUI() {
    const balance = USE_LOCAL_STORAGE ? getBalance() : await getBalanceAsync();
    const amountEl = document.getElementById('balance-amount');
    const statHandEl = document.getElementById('stat-hand-balance');
    const labelEl = document.getElementById('balance-label');
    const statLabelEl = document.getElementById('stat-hand-label');
    const handLabel = balance >= 0 ? 'বাজারকারীর হাতে টাকা' : 'বাকি';
    const text = (balance >= 0 ? '৳ ' : '-৳ ') + Math.abs(balance).toLocaleString('bn-BD');
    if (amountEl) amountEl.textContent = text;
    if (statHandEl) statHandEl.textContent = text;
    if (labelEl) labelEl.textContent = handLabel;
    if (statLabelEl) statLabelEl.textContent = handLabel;
    // Worker balance card (if present)
    const workerAmountEl = document.getElementById('worker-balance-amount');
    const workerLabelEl = document.getElementById('worker-balance-label');
    if (workerAmountEl) workerAmountEl.textContent = text;
    if (workerLabelEl) workerLabelEl.textContent = handLabel;
}

async function openAddMoney() {
    const raw = prompt('কত টাকা দিয়েছেন? (সংখ্যা লিখুন)', '');
    if (raw === null || raw.trim() === '') return;
    const amount = parseFloat(raw.replace(/,/g, '').trim());
    if (isNaN(amount) || amount <= 0) {
        alert('সঠিক সংখ্যা লিখুন');
        return;
    }
    await addMoney(amount);
    await updateBalanceUI();
    alert('৳ ' + amount.toLocaleString('bn-BD') + ' যোগ হয়েছে।');
}

function openBalanceStatement() {
    const overlay = document.getElementById('balance-statement-overlay');
    if (overlay) overlay.classList.add('show');
    renderBalanceStatementContent('all'); // async; content fills in
}

function closeBalanceStatement() {
    const overlay = document.getElementById('balance-statement-overlay');
    if (overlay) overlay.classList.remove('show');
}

// Filter: 'all' | 'this_month' | 'last_month'
async function renderBalanceStatementContent(filterValue) {
    const body = document.getElementById('balance-statement-body');
    if (!body) return;

    const log = getAddMoneyLog();
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

    let filtered = log;
    if (filterValue === 'this_month') {
        filtered = log.filter(function (e) { return e.date >= thisMonthStart; });
    } else if (filterValue === 'last_month') {
        filtered = log.filter(function (e) { return e.date >= lastMonthStart && e.date <= lastMonthEnd; });
    }

    const totalInPeriod = filtered.reduce(function (sum, e) { return sum + Number(e.amount || 0); }, 0);
    const totalAdded = getTotalAdded();
    let totalSpent = 0;
    if (USE_LOCAL_STORAGE) {
        const entries = localStorageAdapter._getEntries();
        totalSpent = entries.reduce(function (sum, e) { return sum + Number(e.total_cost || 0); }, 0);
    } else {
        const entries = await storage.getEntriesInDateRange('2000-01-01', '2099-12-31');
        totalSpent = (entries || []).reduce(function (sum, e) { return sum + Number(e.total_cost || 0); }, 0);
    }
    const balance = totalAdded - totalSpent;

    const filterLabel = filterValue === 'this_month' ? 'এই মাস' : filterValue === 'last_month' ? 'গত মাস' : 'সব সময়';
    let tableRows = filtered.map(function (e) {
        const d = e.date || '';
        const dateStr = d.length >= 10 ? (d.substring(8, 10) + '/' + d.substring(5, 7) + '/' + d.substring(0, 4)) : d;
        return '<tr><td>' + dateStr + '</td><td style="font-weight:600;">৳ ' + Number(e.amount).toLocaleString('bn-BD') + '</td></tr>';
    }).join('');
    if (!tableRows) tableRows = '<tr><td colspan="2" style="text-align:center;color:#6b7280;padding:12px;">এই সময়ে কোনো টাকা দেওয়ার রেকর্ড নেই</td></tr>';

    body.innerHTML =
        '<div class="balance-statement-filter-row" style="margin-bottom:14px;">' +
        '<label for="balance-statement-filter" style="margin-right:8px;">সময় অনুযায়ী:</label>' +
        '<select id="balance-statement-filter" onchange="renderBalanceStatementContent(this.value)" style="padding:6px 10px; border-radius:6px; border:1px solid var(--border, #ddd);">' +
        '<option value="all"' + (filterValue === 'all' ? ' selected' : '') + '>সব সময়</option>' +
        '<option value="this_month"' + (filterValue === 'this_month' ? ' selected' : '') + '>এই মাস</option>' +
        '<option value="last_month"' + (filterValue === 'last_month' ? ' selected' : '') + '>গত মাস</option>' +
        '</select></div>' +
        '<p style="margin-bottom:8px; font-weight:600;">কখন কত টাকা দিয়েছেন</p>' +
        '<table class="table" style="margin-bottom:16px;"><thead><tr><th>তারিখ</th><th>টাকা দিয়েছেন</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
        '<p style="margin-bottom:6px;"><strong>' + filterLabel + ' মোট দিয়েছেন:</strong> ৳ ' + totalInPeriod.toLocaleString('bn-BD') + '</p>' +
        '<p style="margin-bottom:6px;"><strong>সর্বমোট দিয়েছেন:</strong> ৳ ' + totalAdded.toLocaleString('bn-BD') + '</p>' +
        '<p style="margin-bottom:6px;"><strong>মোট বাজার খরচ (সব এন্ট্রি):</strong> ৳ ' + totalSpent.toLocaleString('bn-BD') + '</p>' +
        '<p style="margin-bottom:0; font-weight:600; font-size:1.05rem;">' +
        (balance >= 0 ? 'বাজারকারীর হাতে টাকা: ৳ ' : 'আপনি দিতে বাকি: -৳ ') + Math.abs(balance).toLocaleString('bn-BD') + '</p>';
}


// Set today's date as default
async function ensureLogin() {
    if (USE_LOCAL_STORAGE) return true;
    const overlay = document.getElementById('login-overlay');
    try {
        const session = await api('/api/session');
        if (session && session.ok) {
            if (overlay) overlay.classList.remove('show');
            return true;
        }
    } catch (e) { /* show the form */ }
    if (overlay) overlay.classList.add('show');
    return false;
}

async function submitLogin(event) {
    event.preventDefault();
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = '';
    try {
        await api('/api/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email: document.getElementById('login-email').value.trim(),
                password: document.getElementById('login-password').value
            })
        });
        await bootApp();
    } catch (e) {
        if (errorEl) errorEl.textContent = e.message || 'লগইন হয়নি';
    }
}

async function logoutApp() {
    await api('/api/logout', { method: 'POST' });
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('show');
}

async function bootApp() {
    const ok = await ensureLogin();
    if (!ok) return;
    await refreshMoneyLog();
    loadAdminData();
    updateBalanceUI();
    loadWorkerDashboard();
    loadWorkerEntries();
    loadLastEntryTab('worker');
}

document.addEventListener('DOMContentLoaded', function() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('entry-date').value = today;
    updateSummary();
    if (USE_LOCAL_STORAGE) {
        seedExampleData();
        loadAdminData();
        updateBalanceUI();
        loadWorkerDashboard();
        loadWorkerEntries();
        loadLastEntryTab('worker');
        return;
    }
    const form = document.getElementById('login-form');
    if (form) form.addEventListener('submit', submitLogin);
    bootApp();
});

// Switch between views
function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));

    if(view === 'worker') {
        document.getElementById('worker-view').classList.add('active');
        var tw = document.getElementById('toggle-worker');
        if (tw) tw.classList.add('active');
        loadWorkerDashboard();
        loadWorkerEntries();
        switchWorkerTab('last');
        populateNewEntryItemList();
    } else {
        document.getElementById('admin-view').classList.add('active');
        var ta = document.getElementById('toggle-admin');
        if (ta) ta.classList.add('active');
        switchAdminTab('last');
        loadAdminData();
        updateBalanceUI();
        loadAdminItemDropdown();
    }
}

// Load worker dashboard: this month stats + balance + recent entries
async function loadWorkerDashboard() {
    const countEl = document.getElementById('worker-stat-count');
    const totalEl = document.getElementById('worker-stat-total');
    const balanceEl = document.getElementById('worker-stat-balance');
    const balanceLabelEl = document.getElementById('worker-stat-balance-label');
    const recentTbody = document.getElementById('worker-recent-tbody');

    try {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const [monthEntries, recentList] = await Promise.all([
            storage.getEntriesInMonth(firstDay),
            storage.getEntries(5)
        ]);
        const count = monthEntries.length;
        const monthTotal = monthEntries.reduce(function (s, e) { return s + Number(e.total_cost || 0); }, 0);
        const balance = USE_LOCAL_STORAGE ? getBalance() : await getBalanceAsync();
        const handLabel = balance >= 0 ? 'হাতে টাকা' : 'বাকি পাওনা';

        if (countEl) countEl.textContent = count.toString();
        if (totalEl) totalEl.textContent = '৳ ' + Math.round(monthTotal).toLocaleString('bn-BD');
        if (balanceEl) balanceEl.textContent = (balance >= 0 ? '৳ ' : '-৳ ') + Math.abs(balance).toLocaleString('bn-BD');
        if (balanceLabelEl) balanceLabelEl.textContent = handLabel;

        if (recentTbody) {
            if (recentList && recentList.length > 0) {
                recentTbody.innerHTML = recentList.map(function (e) {
                    const d = e.entry_date || '';
                    const dateStr = d.length >= 10 ? (d.substring(8, 10) + '/' + d.substring(5, 7) + '/' + d.substring(0, 4)) : d;
                    return '<tr><td>' + dateStr + '</td><td style="font-weight:600;">৳ ' + Number(e.total_cost).toLocaleString('bn-BD') + '</td></tr>';
                }).join('');
            } else {
                recentTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#6b7280;padding:10px;">কোনো এন্ট্রি নেই</td></tr>';
            }
        }
        await updateBalanceUI();
    } catch (err) {
        console.error('Error loading worker dashboard:', err);
        if (countEl) countEl.textContent = '—';
        if (totalEl) totalEl.textContent = '—';
        if (balanceEl) balanceEl.textContent = '—';
        if (balanceLabelEl) balanceLabelEl.textContent = 'হাতে টাকা';
        if (recentTbody) recentTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#946a6a;padding:10px;">' + getNetworkErrorMessage(err) + '</td></tr>';
        await updateBalanceUI();
    }
}

// Load full entries list for worker (সব বাজার এন্ট্রি)
async function loadWorkerEntries() {
    const tbody = document.getElementById('worker-entries-tbody');
    if (!tbody) return;
    try {
        const entries = await storage.getEntries(100);
        if (entries && entries.length > 0) {
            tbody.innerHTML = entries.map(function (entry) {
                return '<tr>' +
                    '<td>' + formatDate(entry.entry_date) + '</td>' +
                    '<td>' + (entry.item_count || 0) + 'টি আইটেম</td>' +
                    '<td style="font-weight:600;">৳ ' + Number(entry.total_cost).toLocaleString('bn-BD') + '</td>' +
                    '<td class="action-cell"><button type="button" class="btn btn-primary entry-btn icon-btn" onclick="viewDetails(' + entry.id + ', false)" title="বিস্তারিত">👁</button></td>' +
                    '<td class="action-cell"><button type="button" class="btn btn-danger entry-delete-btn icon-btn" onclick="deleteEntryConfirm(' + entry.id + ')" title="ডিলিট (লগে সেভ হবে)">🗑</button></td>' +
                    '</tr>';
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:10px;">কোনো এন্ট্রি নেই</td></tr>';
        }
    } catch (err) {
        console.error('Error loading worker entries:', err);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#946a6a;padding:10px;">' + getNetworkErrorMessage(err) + '</td></tr>';
    }
}

async function deleteEntryConfirm(entryId) {
    if (!confirm('এই এন্ট্রিটি ডিলিট করতে চান? ডিলিটের রেকর্ড লগে সেভ থাকবে।')) return;
    try {
        await storage.deleteEntry(entryId);
        loadWorkerEntries();
        loadWorkerDashboard();
        updateBalanceUI();
        if (typeof loadAdminData === 'function') loadAdminData();
        alert('এন্ট্রি ডিলিট হয়েছে।');
    } catch (err) {
        console.error('Error deleting entry:', err);
        alert('ত্রুটি: ' + (err.message || err));
    }
}

function switchWorkerTab(tabName) {
    document.querySelectorAll('.worker-tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-worker-tab') === tabName);
    });
    document.querySelectorAll('.worker-tab-panel').forEach(function (p) {
        var id = p.id;
        p.classList.toggle('active', (tabName === 'last' && id === 'worker-panel-last') || (tabName === 'list' && id === 'worker-panel-list') || (tabName === 'log' && id === 'worker-panel-log') || (tabName === 'import' && id === 'worker-panel-import'));
    });
    if (tabName === 'last') loadLastEntryTab('worker');
    if (tabName === 'list') loadWorkerEntries();
    if (tabName === 'log') renderWorkerLog();
}

function openNewEntryModal() {
    /* New entry form is now inline on worker home; no modal */
}
function closeNewEntryModal() {
    var overlay = document.getElementById('new-entry-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function populateNewEntryItemList() {
    var listEl = document.getElementById('new-entry-item-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    try {
        var names = await getPastItemNamesSortedBengali();
        (names || []).forEach(function (name) {
            var opt = document.createElement('option');
            opt.value = name;
            listEl.appendChild(opt);
        });
    } catch (e) { console.warn('populateNewEntryItemList:', e); }
}

async function renderWorkerLog() {
    var tbody = document.getElementById('worker-log-tbody');
    if (!tbody) return;
    var log = await getEditLog();
    if (log.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:12px;">কোনো এডিট রেকর্ড নেই</td></tr>';
    } else {
        tbody.innerHTML = log.map(function (e) {
            var entryDate = e.entry_date || '';
            var entryStr = entryDate.length >= 10 ? entryDate.substring(8, 10) + '/' + entryDate.substring(5, 7) + '/' + entryDate.substring(0, 4) : entryDate;
            var editedAt = e.edited_at || '';
            var editedStr = editedAt.length >= 16 ? editedAt.substring(8, 10) + '/' + editedAt.substring(5, 7) + '/' + editedAt.substring(0, 4) + ' ' + editedAt.substring(11, 16) : editedAt;
            var newTotalCell = (e.summary === 'Entry deleted') ? 'ডিলিট হয়েছে' : ('৳ ' + Number(e.new_total).toLocaleString('bn-BD'));
            return '<tr><td>' + entryStr + '</td><td>' + editedStr + '</td><td>৳ ' + Number(e.previous_total).toLocaleString('bn-BD') + '</td><td>' + newTotalCell + '</td></tr>';
        }).join('');
    }
}

// Add new row to table (matches details-style modal layout)
function addNewRow() {
    const tbody = document.getElementById('items-tbody');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" class="item-name" list="new-entry-item-list" placeholder="নাম..." oninput="calculateRow(this)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
        <td><input type="number" class="item-quantity" value="0" step="0.1" min="0" oninput="calculateRow(this)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
        <td><select class="item-unit" onchange="calculateRow(this)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;"><option>কেজি</option><option>পিস</option><option>লিটার</option><option>গ্রাম</option><option>হালি</option></select></td>
        <td><input type="number" class="item-price" value="0" step="0.01" min="0" oninput="calculateRow(this)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
        <td class="calc-cell item-total">০</td>
        <td class="memo-cell"><input type="file" class="item-memo-file" accept="image/*" hidden onchange="previewMemoImage(this)"><button type="button" class="memo-upload-btn" onclick="this.previousElementSibling.click()" title="মেমো ছবি">📷</button><span class="memo-has-pic" style="display:none;">✓</span><img class="memo-preview" alt="" style="display:none;max-width:28px;max-height:28px;border-radius:4px;vertical-align:middle;"></td>
        <td><button type="button" class="delete-btn" onclick="deleteRow(this)">✕</button><input type="hidden" class="item-category" value="অন্যান্য"></td>
    `;
    tbody.appendChild(row);
}

// Bill image (entry-level)
function previewBillImage(fileInput) {
    var wrap = document.getElementById('entry-bill-preview-wrap');
    var img = document.getElementById('entry-bill-preview');
    if (!fileInput.files || !fileInput.files[0]) return;
    var r = new FileReader();
    r.onload = function () {
        img.src = r.result;
        img.setAttribute('data-bill-src', r.result);
        wrap.style.display = 'inline-block';
    };
    r.readAsDataURL(fileInput.files[0]);
}
function clearBillImage() {
    var input = document.getElementById('entry-bill-image');
    var wrap = document.getElementById('entry-bill-preview-wrap');
    var img = document.getElementById('entry-bill-preview');
    if (input) input.value = '';
    if (img) { img.src = ''; img.removeAttribute('data-bill-src'); }
    if (wrap) wrap.style.display = 'none';
}
function viewBillImage() {
    var img = document.getElementById('entry-bill-preview');
    var src = img && img.getAttribute('data-bill-src');
    if (src) viewMemoImage(src);
}

// Normalize CSV import date: accept Gregorian (YYYY-MM-DD) or Hijri (DD-MM-YYYY, year 14xx). Returns YYYY-MM-DD for DB.
function normalizeImportDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return dateStr;
    var s = dateStr.trim();
    // Hijri: DD-MM-YYYY with year in Hijri range (e.g. 1447)
    var hijriMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (hijriMatch) {
        var day = parseInt(hijriMatch[1], 10);
        var month = parseInt(hijriMatch[2], 10);
        var year = parseInt(hijriMatch[3], 10);
        if (year >= 1350 && year <= 1520 && month >= 1 && month <= 12 && day >= 1 && day <= 30) {
            if (typeof window.hijriToGregorian === 'function') {
                var g = window.hijriToGregorian(year, month, day);
                if (g && g.gy != null && g.gm != null && g.gd != null) {
                    var gy = '' + g.gy;
                    var gm = g.gm < 10 ? '0' + g.gm : '' + g.gm;
                    var gd = g.gd < 10 ? '0' + g.gd : '' + g.gd;
                    return gy + '-' + gm + '-' + gd;
                }
            }
        }
    }
    // Already Gregorian YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return dateStr;
}

// Bengali numeral (০-৯) to ASCII (0-9) for alternate bill format
var bnDigits = '০১২৩৪৫৬৭৮৯';
function bnToAsciiNum(s) {
    if (s == null || s === '') return s;
    var str = String(s).trim();
    var out = '';
    for (var i = 0; i < str.length; i++) {
        var idx = bnDigits.indexOf(str[i]);
        if (idx >= 0) out += idx;
        else if (str[i] === ',' || str[i] === '.') out += str[i];
        else out += str[i];
    }
    return out;
}

// Detect and parse alternate format: ক্রমিক, তারিখ, সামান, পরিমাণ, মূল্য (e.g. ১,০৮/০৮/৪৭,টমেটো,৩ কেজি,২৪০)
function parseAlternateBillRow(parts) {
    if (parts.length < 5) return null;
    var col2 = (parts[1] || '').trim();
    var col4 = (parts[3] || '').trim();
    var col5 = (parts[4] || '').trim();
    if (!/[\d০-৯]+\/[\d০-৯]+\/[\d০-৯]+/.test(bnToAsciiNum(col2))) return null; // date like DD/MM/YY
    var dateStr = bnToAsciiNum(col2);
    var day = '', month = '', year = '';
    var slashSplit = dateStr.split('/');
    if (slashSplit.length >= 3) {
        day = slashSplit[0].replace(/^0+/, '') || '0';
        month = slashSplit[1].replace(/^0+/, '') || '0';
        year = slashSplit[2].replace(/^0+/, '') || '0';
        if (year.length <= 2) year = '14' + year; // 47 -> 1447 Hijri
        dateStr = (day.length === 1 ? '0' + day : day) + '-' + (month.length === 1 ? '0' + month : month) + '-' + year;
    } else return null;
    var itemName = (parts[2] || '').trim().replace(/^["']|["']$/g, '');
    if (!itemName) return null;
    var qtyUnit = bnToAsciiNum(col4).trim();
    var quantity = 0, unit = 'পিস';
    var match = qtyUnit.match(/^([\d.]+)\s*(.*)$/);
    if (match) {
        quantity = parseFloat(match[1]) || 0;
        unit = (match[2] || 'পিস').trim() || 'পিস';
    } else if (/^[\d.]+$/.test(qtyUnit)) {
        quantity = parseFloat(qtyUnit) || 0;
    }
    var totalPrice = parseFloat(bnToAsciiNum(col5).replace(/,/g, '')) || 0;
    var entryDate = normalizeImportDate(dateStr);
    var price = quantity > 0 ? totalPrice / quantity : totalPrice;
    return { entry_date: entryDate, item_name: itemName, quantity: quantity, unit: unit, price_per_unit: price, total_price: totalPrice, category: 'অন্যান্য' };
}

// CSV import for old bills
function readCsvFile(fileInput) {
    if (!fileInput.files || !fileInput.files[0]) return;
    var f = fileInput.files[0];
    var r = new FileReader();
    r.onload = function () {
        var el = document.getElementById('csv-import-text');
        if (el) el.value = r.result;
    };
    r.readAsText(f, 'UTF-8');
}

async function doCsvImport() {
    var ta = document.getElementById('csv-import-text');
    var resultEl = document.getElementById('csv-import-result');
    if (!ta || !resultEl) return;
    var text = (ta.value || '').trim();
    if (!text) {
        resultEl.textContent = 'প্রথমে CSV পেস্ট করুন বা ফাইল চয়ন করুন।';
        return;
    }
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length === 0) {
        resultEl.textContent = 'কোনো সারি নেই।';
        return;
    }
    var rows = [];
    var useAlternateFormat = null;
    for (var i = 0; i < lines.length; i++) {
        var parts = lines[i].split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); });
        if (parts.length < 5) continue;

        // Try alternate format (ক্রমিক, তারিখ, সামান, পরিমাণ, মূল্য) when 5 columns and col2 looks like DD/MM/YY
        var alt = parseAlternateBillRow(parts);
        if (alt) {
            if (useAlternateFormat === null) useAlternateFormat = true;
            if (useAlternateFormat) {
                rows.push(alt);
                continue;
            }
        } else if (useAlternateFormat === true) {
            continue;
        }

        // Standard format: entry_date, item_name, quantity, unit, price_per_unit, total_price
        var entryDate = normalizeImportDate(parts[0]);
        var itemName = parts[1];
        var quantity = parseFloat(bnToAsciiNum(parts[2])) || parseFloat(parts[2]) || 0;
        var unit = (parts[3] || 'কেজি').trim() || 'কেজি';
        var pricePerUnit = parseFloat(bnToAsciiNum(parts[4])) || parseFloat(parts[4]) || 0;
        var totalPriceFromFile = parseFloat(bnToAsciiNum(parts[5])) || parseFloat(parts[5]) || 0;

        if (entryDate.toLowerCase().indexOf('date') >= 0 || (itemName && itemName.toLowerCase().indexOf('name') >= 0)) continue;
        if (/^ক্রমিক|মোট$/i.test((parts[0] || '').trim()) || /^ক্রমিক|মোট$/i.test((itemName || '').trim())) continue;
        if (!itemName) continue;

        var total, price;
        if (pricePerUnit > 0) {
            total = quantity * pricePerUnit;
            price = pricePerUnit;
        } else if (totalPriceFromFile > 0) {
            total = totalPriceFromFile;
            price = quantity > 0 ? totalPriceFromFile / quantity : totalPriceFromFile;
        } else {
            total = 0;
            price = 0;
        }

        rows.push({ entry_date: entryDate, item_name: itemName, quantity: quantity, unit: unit, price_per_unit: price, total_price: total, category: 'অন্যান্য' });
    }
    if (rows.length === 0) {
        resultEl.textContent = 'সঠিক ফরম্যাটের কোনো সারি পাওয়া যায়নি। ফরম্যাট: entry_date,item_name,quantity,unit,price_per_unit,total_price';
        return;
    }
    var byDate = {};
    rows.forEach(function (r) {
        if (!byDate[r.entry_date]) byDate[r.entry_date] = [];
        byDate[r.entry_date].push(r);
    });
    var dates = Object.keys(byDate).sort();
    var maxEntries = 100;
    if (dates.length > maxEntries) {
        resultEl.textContent = 'একবারে সর্বোচ্চ ' + maxEntries + 'টি এন্ট্রি ইমপোর্ট করা যাবে। আপনার ' + dates.length + 'টি তারিখ আছে। প্রথম ' + maxEntries + 'টি নেওয়া হবে।';
        dates = dates.slice(0, maxEntries);
    }
    resultEl.textContent = 'ইমপোর্ট করা হচ্ছে...';
    var done = 0, err = 0;
    for (var d = 0; d < dates.length; d++) {
        var date = dates[d];
        var dateRows = byDate[date];
        var items = dateRows.map(function (r) {
            return { name: r.item_name, quantity: r.quantity, unit: r.unit, price_per_unit: r.price_per_unit, total_price: r.total_price, category: 'অন্যান্য', memo_image_url: null };
        });
        var totalCost = items.reduce(function (s, it) { return s + it.total_price; }, 0);
        try {
            await storage.saveEntry({
                entry_date: date,
                total_cost: totalCost,
                item_count: items.length,
                comment: null,
                payment_status: 'pending',
                bill_image_url: null
            }, items);
            done++;
        } catch (e) {
            err++;
            console.error('Import error for ' + date, e);
        }
    }
    resultEl.textContent = 'সম্পন্ন: ' + done + 'টি এন্ট্রি যোগ হয়েছে।' + (err ? ' ত্রুটি: ' + err + 'টি।' : '');
    ta.value = '';
    document.getElementById('csv-import-file').value = '';
    loadWorkerDashboard();
    loadWorkerEntries();
    if (document.getElementById('admin-view').classList.contains('active')) loadAdminData();
    updateBalanceUI();
}

// Show preview when user selects a memo image for an item (edit entry modal) — upload or base64, then update hidden URL and preview
async function previewEditMemoImage(fileInput) {
    var row = fileInput.closest('tr');
    if (!row) return;
    var urlInput = row.querySelector('.edit-item-memo-url');
    var preview = row.querySelector('.edit-memo-preview');
    var hasPic = row.querySelector('.edit-memo-has-pic');
    if (!urlInput || !preview) return;
    if (!fileInput.files || !fileInput.files[0]) {
        urlInput.value = '';
        preview.src = '';
        preview.style.display = 'none';
        preview.removeAttribute('onclick');
        if (hasPic) hasPic.style.display = 'none';
        return;
    }
    var file = fileInput.files[0];
    if (USE_LOCAL_STORAGE) {
        try {
            var dataUrl = await new Promise(function (res, rej) {
                var r = new FileReader();
                r.onload = function () { res(r.result); };
                r.onerror = rej;
                r.readAsDataURL(file);
            });
            urlInput.value = dataUrl;
            preview.src = dataUrl;
            preview.style.display = 'inline-block';
            preview.onclick = function () { viewMemoImage(preview.src); };
            if (hasPic) hasPic.style.display = 'inline';
        } catch (e) { console.warn('Edit memo read failed', e); }
        return;
    }
    try {
        var publicUrl = await uploadImage(file);
        urlInput.value = publicUrl;
        preview.src = publicUrl;
        preview.style.display = 'inline-block';
        preview.onclick = function () { viewMemoImage(preview.src); };
        if (hasPic) hasPic.style.display = 'inline';
    } catch (e) {
        console.warn('Edit memo upload failed', e);
        alert('মেমো আপলোড হয়নি: ' + (e.message || e));
    }
}

// Show preview when user selects a memo image for an item
function previewMemoImage(fileInput) {
    const row = fileInput.closest('tr');
    const preview = row.querySelector('.memo-preview');
    const hasPic = row.querySelector('.memo-has-pic');
    if (fileInput.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.src = e.target.result;
            preview.style.display = 'inline-block';
            preview.style.cursor = 'pointer';
            preview.title = 'ক্লিক করে ছবি দেখুন';
            preview.onclick = function() { viewMemoImage(preview.src); };
            hasPic.style.display = 'inline';
        };
        reader.readAsDataURL(fileInput.files[0]);
    } else {
        preview.src = '';
        preview.style.display = 'none';
        preview.removeAttribute('title');
        preview.onclick = null;
        hasPic.style.display = 'none';
    }
}

// Escape string for safe use inside HTML (text content)
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Escape string for safe use inside an HTML attribute
function escapeHtmlAttr(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

// Show memo image in popup overlay (no new tab)
function viewMemoImage(src) {
    if (!src) return;
    const overlay = document.getElementById('memo-viewer-overlay');
    const img = document.getElementById('memo-viewer-img');
    if (overlay && img) {
        img.src = src;
        overlay.classList.add('show');
    }
}

function closeMemoViewer() {
    const overlay = document.getElementById('memo-viewer-overlay');
    const img = document.getElementById('memo-viewer-img');
    if (overlay) overlay.classList.remove('show');
    if (img) img.src = '';
}

// Delete row
function deleteRow(btn) {
    const row = btn.closest('tr');
    row.remove();
    updateSummary();
}

// Add quick item
function addQuickItem(itemName) {
    addNewRow();
    const rows = document.querySelectorAll('#items-tbody tr');
    const lastRow = rows[rows.length - 1];
    lastRow.querySelector('.item-name').value = itemName;
}

// Effective qty for total: when quantity is 0, use 1 so fixed charges (ভাড়া, মেরামত) show price as total
function effectiveQtyForTotal(qty) {
    var n = Number(qty);
    return (Number.isFinite(n) && n > 0) ? n : 1;
}

// Calculate row total
function calculateRow(input) {
    const row = input.closest('tr');
    const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const total = effectiveQtyForTotal(quantity) * price;
    const totalCell = row.querySelector('.item-total');
    totalCell.textContent = formatCurrency(total);
    updateSummary();
}

// Update summary
function updateSummary() {
    const rows = document.querySelectorAll('#items-tbody tr');
    let totalItems = 0;
    let totalCost = 0;

    rows.forEach(row => {
        const name = row.querySelector('.item-name').value.trim();
        if (name) {
            totalItems++;
            const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
            const price = parseFloat(row.querySelector('.item-price').value) || 0;
            totalCost += effectiveQtyForTotal(quantity) * price;
        }
    });

    document.getElementById('total-items').textContent = totalItems + 'টি';
    document.getElementById('total-cost').textContent = formatCurrency(totalCost);
}

// Format currency in Bengali
function formatCurrency(amount) {
    if (amount === 0) return '০ টাকা';
    const formatted = Math.round(amount).toLocaleString('bn-BD');
    return formatted + ' টাকা';
}

// Bengali numerals 0-9 for Hijri date display
var bnNum = '০১২৩৪৫৬৭৮৯';
function toBengaliDigits(n) {
    var s = String(Math.floor(n));
    var out = '';
    for (var i = 0; i < s.length; i++) out += bnNum[parseInt(s[i], 10)];
    return out;
}

// Format date as Hijri (Bangladesh / Umm al-Qura) for display. Store remains Gregorian in DB.
function formatDate(dateString) {
    if (!dateString) return '';
    var s = String(dateString).trim();
    var match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return s;
    var gy = parseInt(match[1], 10), gm = parseInt(match[2], 10), gd = parseInt(match[3], 10);
    if (typeof window.gregorianToHijri === 'function') {
        var h = window.gregorianToHijri(gy, gm, gd);
        if (h && h.hy != null && h.hm != null && h.hd != null) {
            return toBengaliDigits(h.hd) + '-' + toBengaliDigits(h.hm) + '-' + toBengaliDigits(h.hy);
        }
    }
    var date = new Date(gy, gm - 1, gd);
    var months = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
                  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
    return date.getDate() + ' ' + months[date.getMonth()] + ', ' + date.getFullYear();
}

// Save entry (uses storage: localStorage or Supabase)
async function saveEntry() {
    const date = document.getElementById('entry-date').value;
    const comment = document.getElementById('entry-comment').value;
    const rows = document.querySelectorAll('#items-tbody tr');

    const items = [];
    for (const row of rows) {
        const name = row.querySelector('.item-name').value.trim();
        if (name) {
            const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
            const price = parseFloat(row.querySelector('.item-price').value) || 0;
            const unit = row.querySelector('.item-unit').value;
            const category = row.querySelector('.item-category').value;
            const total = effectiveQtyForTotal(quantity) * price;
            const memoFileInput = row.querySelector('.item-memo-file');
            const memoFile = memoFileInput && memoFileInput.files && memoFileInput.files[0] ? memoFileInput.files[0] : null;
            const item = {
                name, quantity, unit, price_per_unit: price, total_price: total, category,
                memoFile
            };
            if (USE_LOCAL_STORAGE && memoFile) {
                try {
                    item.memo_image_url = await new Promise((res, rej) => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.onerror = rej;
                        r.readAsDataURL(memoFile);
                    });
                } catch (e) { console.warn('Memo to base64 failed', e); }
                delete item.memoFile;
            }
            items.push(item);
        }
    }

    if (items.length === 0) {
        alert('অনুগ্রহ করে অন্তত একটি আইটেম যোগ করুন');
        return;
    }

    const totalCost = items.reduce((sum, item) => sum + item.total_price, 0);
    var billFile = null;
    var billImageUrlForLocalStorage = null;

    var billInput = document.getElementById('entry-bill-image');
    if (billInput && billInput.files && billInput.files[0]) {
        billFile = billInput.files[0];
        if (USE_LOCAL_STORAGE) {
            try {
                billImageUrlForLocalStorage = await new Promise(function (res, rej) {
                    var r = new FileReader();
                    r.onload = function () { res(r.result); };
                    r.onerror = rej;
                    r.readAsDataURL(billFile);
                });
            } catch (e) { console.warn('Bill image read failed for local storage', e); }
        }
    }

    const saveBtn = document.getElementById('save-entry-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'সেভ হচ্ছে...';

    try {
        await storage.saveEntry({
            entry_date: date,
            total_cost: totalCost,
            item_count: items.length,
            comment: comment || null,
            payment_status: 'pending',
            bill_image_url: billImageUrlForLocalStorage // For localStorage, pass base64
        }, items, billFile); // Pass raw file for Supabase to upload

        alert('✅ এন্ট্রি সফলভাবে সেভ হয়েছে!');
        clearBillImage();
        updateBalanceUI();
        loadWorkerDashboard();
        loadWorkerEntries();
        document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('entry-comment').value = '';
        document.getElementById('items-tbody').innerHTML = `
            <tr>
                <td><input type="text" class="item-name" list="new-entry-item-list" placeholder="নাম..." oninput="calculateRow(this)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                <td><input type="number" class="item-quantity" value="0" step="0.1" min="0" oninput="calculateRow(this)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                <td><select class="item-unit" onchange="calculateRow(this)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;"><option>কেজি</option><option>পিস</option><option>লিটার</option><option>গ্রাম</option><option>হালি</option></select></td>
                <td><input type="number" class="item-price" value="0" step="0.01" min="0" oninput="calculateRow(this)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;"></td>
                <td class="calc-cell item-total">০</td>
                <td class="memo-cell"><input type="file" class="item-memo-file" accept="image/*" hidden onchange="previewMemoImage(this)"><button type="button" class="memo-upload-btn" onclick="this.previousElementSibling.click()" title="মেমো ছবি">📷</button><span class="memo-has-pic" style="display:none;">✓</span><img class="memo-preview" alt="" style="display:none;max-width:28px;max-height:28px;border-radius:4px;vertical-align:middle;"></td>
                <td><button type="button" class="delete-btn" onclick="deleteRow(this)">✕</button><input type="hidden" class="item-category" value="অন্যান্য"></td>
            </tr>
        `;
        updateSummary();
    } catch (error) {
        console.error('Error saving entry:', error);
        alert('❌ ত্রুটি: ' + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '✓ এন্ট্রি সেভ করুন';
    }
}

// Admin filter: get current date range from UI
function getAdminDateRange() {
    var sel = document.getElementById('admin-filter-date');
    var value = (sel && sel.value) ? sel.value : 'all_time';
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth();
    var start = '', end = '';
    if (value === 'all_time') {
        start = '2000-01-01';
        end = '2099-12-31';
    } else if (value === 'today') {
        start = end = now.toISOString().split('T')[0];
    } else if (value === 'this_week') {
        var day = now.getDay();
        var monOffset = day === 0 ? -6 : 1 - day;
        var mon = new Date(now); mon.setDate(now.getDate() + monOffset);
        start = mon.toISOString().split('T')[0];
        var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        end = sun.toISOString().split('T')[0];
    } else if (value === 'this_month') {
        start = y + '-' + String(m + 1).padStart(2, '0') + '-01';
        var lastDay = new Date(y, m + 1, 0);
        end = lastDay.toISOString().split('T')[0];
    } else if (value === 'last_month') {
        var lm = m === 0 ? 11 : m - 1;
        var ly = m === 0 ? y - 1 : y;
        start = ly + '-' + String(lm + 1).padStart(2, '0') + '-01';
        var lastDay = new Date(ly, lm + 1, 0);
        end = lastDay.toISOString().split('T')[0];
    } else if (value === 'custom') {
        start = (document.getElementById('admin-date-from') && document.getElementById('admin-date-from').value) || '';
        end = (document.getElementById('admin-date-to') && document.getElementById('admin-date-to').value) || '';
        if (!start || !end) {
            var first = new Date(y, m, 1).toISOString().split('T')[0];
            start = start || first;
            end = end || now.toISOString().split('T')[0];
        }
    }
    return { start: start, end: end };
}

function applyAdminDateFilterVisibility() {
    var sel = document.getElementById('admin-filter-date');
    var wrap = document.getElementById('admin-custom-dates-wrap');
    if (wrap) wrap.style.display = (sel && sel.value === 'custom') ? 'inline-flex' : 'none';
}

// All unique item names from past entries, sorted by Bengali alphabet
async function getPastItemNamesSortedBengali() {
    var items = [];
    if (USE_LOCAL_STORAGE) {
        var entries = localStorageAdapter._getEntries();
        var allItems = localStorageAdapter._getItems();
        var ids = (entries || []).map(function (e) { return e.id; });
        items = (allItems || []).filter(function (it) { return ids.indexOf(it.entry_id) >= 0; });
    } else {
        items = await storage.getItemsInDateRange('2000-01-01', '2099-12-31');
    }
    var names = [];
    var seen = {};
    (items || []).forEach(function (it) {
        var name = (it.item_name || '').trim();
        if (name && !seen[name]) { seen[name] = true; names.push(name); }
    });
    names.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    return names;
}

var _cachedPastItemNames = null;

async function loadAdminItemDropdown() {
    var sel = document.getElementById('admin-filter-item');
    if (!sel) return;
    var list = [];
    try {
        list = await getPastItemNamesSortedBengali();
    } catch (err) {
        console.warn('loadAdminItemDropdown: getPastItemNames failed', err);
    }
    if (list && list.length > 0) _cachedPastItemNames = list;
    var currentVal = sel.value;
    sel.innerHTML = '<option value="">আইটেম দিয়ে ফিল্টার</option>';
    (list || []).forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (currentVal && list && list.indexOf(currentVal) >= 0) sel.value = currentVal;
}

function populateAdminItemDropdownFromEntries(entries) {
    var sel = document.getElementById('admin-filter-item');
    if (!sel || !entries || entries.length === 0) return;
    var names = [];
    var seen = {};
    entries.forEach(function (e) {
        (e._items || []).forEach(function (it) {
            var name = (it.item_name || '').trim();
            if (name && !seen[name]) { seen[name] = true; names.push(name); }
        });
    });
    if (names.length === 0) return;
    names.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    if (!_cachedPastItemNames) _cachedPastItemNames = [];
    names.forEach(function (n) {
        if (_cachedPastItemNames.indexOf(n) < 0) _cachedPastItemNames.push(n);
    });
    _cachedPastItemNames.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    if (sel.options.length <= 1) {
        var currentVal = sel.value;
        sel.innerHTML = '<option value="">আইটেম দিয়ে ফিল্টার</option>';
        _cachedPastItemNames.forEach(function (name) {
            var opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
        if (currentVal && _cachedPastItemNames.indexOf(currentVal) >= 0) sel.value = currentVal;
    }
}

function onAdminItemFilterFocus() {
    var sel = document.getElementById('admin-filter-item');
    if (!sel) return;
    if (sel.options.length <= 1) loadAdminItemDropdown();
}

function updateAdminSearchClearVisibility() {
    var wrap = document.querySelector('.admin-search-wrap');
    var input = document.getElementById('admin-filter-search');
    if (wrap && input) wrap.classList.toggle('has-search', (input.value || '').trim().length > 0);
}

function clearAdminSearch() {
    var input = document.getElementById('admin-filter-search');
    var itemSel = document.getElementById('admin-filter-item');
    var listEl = document.getElementById('admin-search-suggestions');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (itemSel) itemSel.value = '';
    if (listEl) listEl.style.display = 'none';
    updateAdminSearchClearVisibility();
    loadAdminData();
}

function onAdminItemFilterChange() {
    var sel = document.getElementById('admin-filter-item');
    var searchEl = document.getElementById('admin-filter-search');
    if (sel && searchEl) {
        searchEl.value = sel.value || '';
        updateAdminSearchClearVisibility();
        loadAdminData();
    }
}

function onAdminSearchInput() {
    var input = document.getElementById('admin-filter-search');
    var listEl = document.getElementById('admin-search-suggestions');
    if (!input || !listEl) return;
    var q = (input.value || '').trim().toLowerCase();
    var list = _cachedPastItemNames || [];
    if (list.length === 0) { listEl.style.display = 'none'; return; }
    var filtered = q ? list.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; }) : list.slice(0, 20);
    if (filtered.length === 0) { listEl.style.display = 'none'; return; }
    listEl.innerHTML = filtered.slice(0, 15).map(function (name) {
        return '<div class="admin-search-suggestion-item" role="button" tabindex="0">' + escapeHtml(name) + '</div>';
    }).join('');
    listEl.style.display = 'block';
    listEl.querySelectorAll('.admin-search-suggestion-item').forEach(function (el) {
        el.addEventListener('click', function () {
            input.value = el.textContent;
            listEl.style.display = 'none';
            updateAdminSearchClearVisibility();
            loadAdminData();
        });
    });
}

function onAdminSearchFocus() {
    if (_cachedPastItemNames && _cachedPastItemNames.length > 0) {
        var input = document.getElementById('admin-filter-search');
        var listEl = document.getElementById('admin-search-suggestions');
        if (input && listEl) {
            var q = (input.value || '').trim().toLowerCase();
            var filtered = q ? _cachedPastItemNames.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; }) : _cachedPastItemNames.slice(0, 15);
            listEl.innerHTML = filtered.map(function (name) {
                return '<div class="admin-search-suggestion-item" role="button" tabindex="0">' + escapeHtml(name) + '</div>';
            }).join('');
            listEl.style.display = filtered.length ? 'block' : 'none';
            listEl.querySelectorAll('.admin-search-suggestion-item').forEach(function (el) {
                el.addEventListener('click', function () {
                    input.value = el.textContent;
                    listEl.style.display = 'none';
                    updateAdminSearchClearVisibility();
                    loadAdminData();
                });
            });
        }
    }
    updateAdminSearchClearVisibility();
}

document.addEventListener('click', function (e) {
    var wrap = document.querySelector('.admin-search-wrap');
    var list = document.getElementById('admin-search-suggestions');
    if (list && wrap && !wrap.contains(e.target)) list.style.display = 'none';
});

// Load admin data (with date and search filters)
async function loadAdminData() {
    var tbody = document.getElementById('entries-tbody');
    if (!tbody) return;
    try {
        var range = getAdminDateRange();
        var searchEl = document.getElementById('admin-filter-search');
        var searchText = (searchEl && searchEl.value && searchEl.value.trim()) || '';

        var entries = await storage.getEntriesInDateRange(range.start, range.end);
        if (!entries) entries = [];

        var attachItems = function (e) {
            var items = e.grocery_items || e._items || [];
            if (!items.length && USE_LOCAL_STORAGE) {
                var allItems = localStorageAdapter._getItems();
                items = allItems.filter(function (it) { return it.entry_id === e.id; });
            }
            e._items = Array.isArray(items) ? items : [];
            return e;
        };
        entries = entries.map(attachItems);
        populateAdminItemDropdownFromEntries(entries);

        if (searchText) {
            var q = searchText.toLowerCase();
            entries = entries.filter(function (e) {
                var items = e._items || [];
                var matchItem = items.some(function (it) { return (it.item_name || '').toLowerCase().indexOf(q) >= 0; });
                var matchComment = (e.comment || '').toLowerCase().indexOf(q) >= 0;
                return matchItem || matchComment;
            });
        }

        if (entries.length > 0) {
            tbody.innerHTML = entries.map(function (entry) {
                var items = entry._items || [];
                var memoCount = items.filter(function (it) { return it.memo_image_url; }).length;
                var memoBadge = memoCount > 0 ? '<span class="memo-badge" title="এই এন্ট্রিতে ' + memoCount + 'টি আইটেমের মেমো ছবি আছে">📷 ' + memoCount + '</span>' : '';
                return '<tr>' +
                    '<td>' + formatDate(entry.entry_date) + ' ' + memoBadge + '</td>' +
                    '<td>' + (entry.item_count || 0) + 'টি আইটেম</td>' +
                    '<td style="font-weight: 600;">৳ ' + Number(entry.total_cost).toLocaleString('bn-BD') + '</td>' +
                    '<td class="entry-actions-cell"><span class="entry-actions"><button type="button" class="btn btn-primary entry-btn icon-btn" onclick="viewDetails(' + entry.id + ', true)" title="বিস্তারিত">👁</button></span></td>' +
                    '</tr>';
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #6b7280;">কোনো এন্ট্রি নেই</td></tr>';
        }
        await loadStatistics(range.start, range.end);
        await loadTopItems(range.start, range.end);
        updateBalanceUI();
    } catch (error) {
        console.error('Error loading admin data:', error);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #946a6a;">' + getNetworkErrorMessage(error) + '</td></tr>';
    }
}

// Load statistics from database (uses admin date filter range)
async function loadStatistics(startDate, endDate) {
    try {
        if (!startDate || !endDate) {
            var now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        }
        var entries = await storage.getEntriesInDateRange(startDate, endDate);
        var totalCost = (entries || []).reduce(function (sum, e) { return sum + Number(e.total_cost || 0); }, 0);
        var entryCount = (entries || []).length;
        var avgPerEntry = entryCount > 0 ? totalCost / entryCount : 0;
        var grid = document.getElementById('admin-stats-grid');
        var statCards = grid ? grid.querySelectorAll('.stat-value') : [];
        if (statCards.length >= 4) {
            statCards[0].textContent = '৳ ' + Math.round(totalCost).toLocaleString('bn-BD');
            statCards[1].textContent = entryCount.toString();
            statCards[2].textContent = entryCount > 0 ? ('৳ ' + Math.round(avgPerEntry).toLocaleString('bn-BD')) : '—';
            // statCards[3] = balance, updated by updateBalanceUI()
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
        var grid = document.getElementById('admin-stats-grid');
        var statCards = grid ? grid.querySelectorAll('.stat-value') : [];
        if (statCards.length >= 3) {
            statCards[0].textContent = '—';
            statCards[1].textContent = '—';
            statCards[2].textContent = '—';
        }
    }
}

// Load top items (uses admin date filter range when start/end provided)
async function loadTopItems(startDate, endDate) {
    try {
        if (!startDate || !endDate) {
            var now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        }
        var items = await storage.getItemsInDateRange(startDate, endDate);
        var itemMap = {};
        (items || []).forEach(function (item) {
            if (!itemMap[item.item_name]) {
                itemMap[item.item_name] = { name: item.item_name, totalQuantity: 0, totalCost: 0, unit: item.unit || '', prices: [] };
            }
            itemMap[item.item_name].totalQuantity += Number(item.quantity);
            itemMap[item.item_name].totalCost += Number(item.total_price);
            itemMap[item.item_name].prices.push(Number(item.price_per_unit));
        });
        var topItems = Object.values(itemMap)
            .sort(function (a, b) { return b.totalCost - a.totalCost; })
            .slice(0, 5)
            .map(function (item) {
                return { ...item, avgPrice: item.prices.length ? item.prices.reduce(function (a, b) { return a + b; }, 0) / item.prices.length : 0 };
            });
        var tbody = document.getElementById('top-items-tbody');
        if (topItems.length > 0) {
            tbody.innerHTML = topItems.map(function (item) {
                return '<tr><td>' + item.name + '</td><td>' + item.totalQuantity.toLocaleString('bn-BD') + ' ' + item.unit + '</td><td style="font-weight: 600;">৳ ' + Math.round(item.totalCost).toLocaleString('bn-BD') + '</td><td>৳ ' + Math.round(item.avgPrice).toLocaleString('bn-BD') + '/' + item.unit + '</td></tr>';
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #6b7280;">কোনো ডেটা নেই</td></tr>';
        }
    } catch (error) {
        console.error('Error loading top items:', error);
    }
}

// Toggle payment status
async function togglePayment(entryId, currentStatus) {
    const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';
    try {
        await storage.updatePaymentStatus(entryId, newStatus);
        loadAdminData();
    } catch (error) {
        console.error('Error updating payment status:', error);
        alert('ত্রুটি: ' + error.message);
    }
}

// View entry details in modal (with per-item memo indicator). fromAdmin=true means no edit button.
async function viewDetails(entryId, fromAdmin) {
    try {
        const { entry, items } = await storage.getEntryById(entryId);
        var html = buildEntryDetailHtml(entry, items, { showOpenModal: false });
        if (!fromAdmin) html += '<p style="margin-top:12px;"><button type="button" class="btn btn-primary icon-btn" onclick="closeDetailsModal(); openEditEntry(' + entryId + ')" title="এডিট করুন">✏️</button></p>';
        document.getElementById('details-modal-body').innerHTML = html;
        document.getElementById('details-modal-overlay').classList.add('show');
    } catch (error) {
        console.error('Error loading details:', error);
        alert('ত্রুটি: ' + error.message);
    }
}

function closeDetailsModal() {
    document.getElementById('details-modal-overlay').classList.remove('show');
}

function buildEntryDetailHtml(entry, items, opts) {
    opts = opts || {};
    var html = '';
    if (entry.bill_image_url) {
        html += '<p style="margin-bottom:12px;"><strong>বিলের ছবি:</strong> <span role="button" class="memo-thumb-wrap" data-memo-src="' + escapeHtmlAttr(entry.bill_image_url) + '" onclick="viewMemoImage(this.getAttribute(\'data-memo-src\'))" title="বিলের ছবি বড় দেখুন"><img class="item-memo-thumb" src="' + escapeHtmlAttr(entry.bill_image_url) + '" alt="বিল" style="max-width:160px;max-height:120px;"></span></p>';
    }
    html += '<p style="margin-bottom:12px;"><strong>তারিখ:</strong> ' + formatDate(entry.entry_date) + '</p>';
    html += '<p style="margin-bottom:12px;"><strong>মোট খরচ:</strong> ৳ ' + Number(entry.total_cost).toLocaleString('bn-BD') + '</p>';
    if (entry.comment) html += '<p style="margin-bottom:12px;"><strong>মন্তব্য:</strong> ' + escapeHtml(entry.comment) + '</p>';
    html += '<table class="table"><thead><tr><th>আইটেম</th><th>পরিমাণ</th><th>দাম</th><th>মোট</th><th>মেমো</th></tr></thead><tbody>';
    (items || []).forEach(function (item) {
        var memoUrl = item.memo_image_url;
        var memoCell = memoUrl
            ? '<span role="button" class="memo-thumb-wrap" data-memo-src="' + escapeHtmlAttr(memoUrl) + '" onclick="viewMemoImage(this.getAttribute(\'data-memo-src\'))" title="মেমো ছবি দেখুন"><img class="item-memo-thumb" src="' + escapeHtmlAttr(memoUrl) + '" alt="মেমো"></span>'
            : '<span style="color:#9ca3af;">—</span>';
        var qty = Number(item.quantity) || 0;
        var price = Number(item.price_per_unit) || 0;
        var total = Number(item.total_price) || (effectiveQtyForTotal(qty) * price);
        html += '<tr><td>' + escapeHtml(item.item_name || '') + '</td><td>' + item.quantity + ' ' + (item.unit || '') + '</td><td>৳' + price + '</td><td>৳' + (Number.isFinite(total) ? total : 0).toLocaleString('bn-BD') + '</td><td>' + memoCell + '</td></tr>';
    });
    html += '</tbody></table>';
    if (opts.showOpenModal && entry.id) {
        var fromAdmin = opts.fromAdmin ? 'true' : 'false';
        html += '<p style="margin-top:12px;"><button type="button" class="btn btn-secondary btn-sm" onclick="viewDetails(' + entry.id + ', ' + fromAdmin + ')">পূর্ণ দেখুন</button></p>';
    }
    return html;
}

async function loadLastEntryTab(which, entryIndex) {
    var containerId = which === 'admin' ? 'admin-last-entry-body' : 'worker-last-entry-body';
    var body = document.getElementById(containerId);
    if (!body) return;
    if (entryIndex === undefined || entryIndex === null) entryIndex = 0;
    try {
        var entries = await storage.getEntries(100);
        if (!entries || entries.length === 0) {
            body.innerHTML = '<p style="text-align:center;color:#6b7280;padding:12px;">কোনো এন্ট্রি নেই</p>';
            return;
        }
        if (entryIndex < 0) entryIndex = 0;
        if (entryIndex >= entries.length) entryIndex = entries.length - 1;
        var totalCount = entries.length;
        var selected = entries[entryIndex];
        var result = await storage.getEntryById(selected.id);
        var entry = result.entry;
        var items = result.items || [];
        var lastId = entry.id;
        var allEntries = await storage.getEntriesInDateRange('2000-01-01', '2099-12-31');
        allEntries = (allEntries || []).map(function (e) {
            var list = e.grocery_items || e._items || [];
            if (!list.length && storage._getItems) {
                list = storage._getItems().filter(function (it) { return String(it.entry_id) === String(e.id); });
            }
            e._items = Array.isArray(list) ? list : [];
            return e;
        });
        var flat = [];
        allEntries.forEach(function (e) {
            (e._items || []).forEach(function (it) {
                var name = (it.item_name || '').trim();
                if (name) flat.push({ item_name: name, entry_id: e.id, entry_date: e.entry_date || '', price: Number(it.price_per_unit) || 0 });
            });
        });
        var byName = {};
        flat.forEach(function (r) {
            if (!byName[r.item_name]) byName[r.item_name] = [];
            byName[r.item_name].push(r);
        });
        var prevMap = {};
        Object.keys(byName).forEach(function (name) {
            var arr = byName[name].sort(function (a, b) {
                var c = (b.entry_date || '').localeCompare(a.entry_date || '');
                return c !== 0 ? c : (Number(b.entry_id) - Number(a.entry_id));
            });
            var prevRow = arr.filter(function (r) { return String(r.entry_id) !== String(lastId); })[0];
            prevMap[name] = prevRow ? prevRow.price : null;
        });
        var html = '';
        html += '<div class="last-entry-nav" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:8px 0;border-bottom:1px solid var(--border-color, #e5e7eb);">';
        html += '<button type="button" class="btn btn-secondary btn-sm" onclick="loadLastEntryTab(\'' + which + '\',' + (entryIndex + 1) + ')"' + (entryIndex >= totalCount - 1 ? ' disabled' : '') + '>← আগের এন্ট্রি</button>';
        html += '<span style="flex:1;text-align:center;color:#6b7280;font-size:0.95em;">' + (entryIndex + 1) + ' / ' + totalCount + '</span>';
        html += '<button type="button" class="btn btn-secondary btn-sm" onclick="loadLastEntryTab(\'' + which + '\',' + (entryIndex - 1) + ')"' + (entryIndex <= 0 ? ' disabled' : '') + '>পরের এন্ট্রি →</button>';
        html += '</div>';
        if (entry.bill_image_url) html += '<p style="margin-bottom:12px;"><strong>বিলের ছবি:</strong> <span role="button" class="memo-thumb-wrap" data-memo-src="' + escapeHtmlAttr(entry.bill_image_url) + '" onclick="viewMemoImage(this.getAttribute(\'data-memo-src\'))"><img class="item-memo-thumb" src="' + escapeHtmlAttr(entry.bill_image_url) + '" alt="বিল" style="max-width:160px;max-height:120px;"></span></p>';
        html += '<p style="margin-bottom:12px;"><strong>তারিখ:</strong> ' + formatDate(entry.entry_date) + '</p>';
        html += '<p style="margin-bottom:12px;"><strong>মোট খরচ:</strong> ৳ ' + Number(entry.total_cost).toLocaleString('bn-BD') + '</p>';
        if (entry.comment) html += '<p style="margin-bottom:12px;"><strong>মন্তব্য:</strong> ' + escapeHtml(entry.comment) + '</p>';
        html += '<table class="table"><thead><tr><th>আইটেম</th><th>পরিমাণ</th><th>একক</th><th>দাম (এখন)</th><th>দাম (আগের বার)</th><th>পরিবর্তন</th><th>প্রবণতা</th><th>মেমো</th></tr></thead><tbody>';
        (items || []).forEach(function (item) {
            var name = (item.item_name || '').trim();
            var currentPrice = Number(item.price_per_unit) || 0;
            var qty = Number(item.quantity) || 0;
            var total = Number(item.total_price) || (effectiveQtyForTotal(qty) * currentPrice);
            var prevPrice = prevMap[name];
            var prevStr = prevPrice !== null && prevPrice !== undefined ? ('৳ ' + Number(prevPrice).toLocaleString('bn-BD')) : '—';
            var currStr = '৳ ' + Number(currentPrice).toLocaleString('bn-BD');
            var changeStr = '—';
            var trend = '—';
            var trendClass = '';
            if (prevPrice !== null && prevPrice !== undefined) {
                var change = currentPrice - prevPrice;
                var pct = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;
                changeStr = (change >= 0 ? '+' : '') + '৳' + Number(change).toLocaleString('bn-BD') + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)';
                trend = change > 0 ? '↑ উঠেছে' : change < 0 ? '↓ নেমেছে' : '—';
                trendClass = change > 0 ? 'price-up' : change < 0 ? 'price-down' : '';
            }
            var memoUrl = item.memo_image_url;
            var memoCell = memoUrl
                ? '<span role="button" class="memo-thumb-wrap" data-memo-src="' + escapeHtmlAttr(memoUrl) + '" onclick="viewMemoImage(this.getAttribute(\'data-memo-src\'))"><img class="item-memo-thumb" src="' + escapeHtmlAttr(memoUrl) + '" alt="মেমো" style="max-width:32px;max-height:32px;"></span>'
                : '<span style="color:#9ca3af;">—</span>';
            html += '<tr><td>' + escapeHtml(name) + '</td><td>' + item.quantity + '</td><td>' + (item.unit || '') + '</td><td>' + currStr + '</td><td>' + prevStr + '</td><td>' + changeStr + '</td><td class="' + trendClass + '">' + trend + '</td><td>' + memoCell + '</td></tr>';
        });
        html += '</tbody></table>';
        var fromAdmin = (which === 'admin');
        html += '<p style="margin-top:12px;"><button type="button" class="btn btn-secondary btn-sm" onclick="viewDetails(' + entry.id + ', ' + fromAdmin + ')">পূর্ণ দেখুন</button></p>';
        body.innerHTML = html;
    } catch (err) {
        console.error('Error loading last entry tab:', err);
        body.innerHTML = '<p style="text-align:center;color:#946a6a;padding:12px;">' + getNetworkErrorMessage(err) + '</p>';
    }
}

// ---------- Edit entry modal ----------
var editEntryId = null;

function openEditEntry(entryId) {
    editEntryId = Number(entryId);
    document.getElementById('edit-entry-id').value = editEntryId;
    storage.getEntryById(editEntryId).then(function (result) {
        var entry = result.entry;
        var items = result.items || [];
        document.getElementById('edit-entry-date').value = entry.entry_date || '';
        document.getElementById('edit-entry-comment').value = entry.comment || '';
        var tbody = document.getElementById('edit-items-tbody');
        var units = ['কেজি', 'পিস', 'লিটার', 'গ্রাম', 'হালি'];
        var categories = ['মুদি', 'সবজি', 'মাছ-মাংস', 'ফলমূল', 'অন্যান্য'];
        tbody.innerHTML = items.map(function (item) {
            var qty = Number(item.quantity) || 0;
            var price = Number(item.price_per_unit) || 0;
            var total = Number(item.total_price) || (effectiveQtyForTotal(qty) * price);
            var unitOpts = units.map(function (u) { return '<option value="' + u + '"' + (item.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('');
            var catOpts = categories.map(function (c) { return '<option value="' + c + '"' + (item.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');
            var memoUrl = item.memo_image_url || '';
            var memoCell = '<input type="file" class="edit-item-memo-file" accept="image/*" hidden onchange="previewEditMemoImage(this)">' +
                '<button type="button" class="memo-upload-btn" onclick="this.previousElementSibling.click()" title="মেমো ছবি যোগ/বদল">📷</button>' +
                '<span class="edit-memo-has-pic" style="' + (memoUrl ? '' : 'display:none;') + '">✓</span>' +
                '<img class="edit-memo-preview" alt="" style="max-width:32px;max-height:32px;border-radius:4px;vertical-align:middle;' + (memoUrl ? 'cursor:pointer;' : 'display:none;') + '" ' + (memoUrl ? 'src="' + escapeHtmlAttr(memoUrl) + '" onclick="viewMemoImage(this.src)"' : '') + '>' +
                '<input type="hidden" class="edit-item-memo-url" value="' + escapeHtmlAttr(memoUrl) + '">';
            return '<tr>' +
                '<td><input type="text" class="edit-item-name" value="' + escapeHtmlAttr(item.item_name || '') + '" oninput="calculateEditRow(this)"></td>' +
                '<td><input type="number" class="edit-item-quantity" value="' + qty + '" step="0.1" min="0" oninput="calculateEditRow(this)"></td>' +
                '<td><select class="edit-item-unit" onchange="calculateEditRow(this)">' + unitOpts + '</select></td>' +
                '<td><input type="number" class="edit-item-price" value="' + price + '" step="0.01" min="0" oninput="calculateEditRow(this)"></td>' +
                '<td class="calc-cell edit-item-total">৳ ' + total.toLocaleString('bn-BD') + '</td>' +
                '<td><select class="edit-item-category">' + catOpts + '</select></td>' +
                '<td class="memo-cell">' + memoCell + '</td>' +
                '<td><button type="button" class="delete-btn" onclick="deleteEditRow(this)">✕</button></td>' +
                '</tr>';
        }).join('');
        if (tbody.rows.length === 0) addEditRow();
        updateEditSummaryTotal();
        document.getElementById('edit-entry-overlay').classList.add('show');
    }).catch(function (err) {
        console.error('Error loading entry for edit:', err);
        alert('ত্রুটি: ' + err.message);
    });
}

function addEditRow() {
    var tbody = document.getElementById('edit-items-tbody');
    var units = ['কেজি', 'পিস', 'লিটার', 'গ্রাম', 'হালি'];
    var categories = ['মুদি', 'সবজি', 'মাছ-মাংস', 'ফলমূল', 'অন্যান্য'];
    var unitOpts = units.map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join('');
    var catOpts = categories.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    var emptyMemoCell = '<input type="file" class="edit-item-memo-file" accept="image/*" hidden onchange="previewEditMemoImage(this)">' +
        '<button type="button" class="memo-upload-btn" onclick="this.previousElementSibling.click()" title="মেমো ছবি যোগ করুন">📷</button>' +
        '<span class="edit-memo-has-pic" style="display:none;">✓</span>' +
        '<img class="edit-memo-preview" alt="" style="display:none;max-width:32px;max-height:32px;border-radius:4px;vertical-align:middle;">' +
        '<input type="hidden" class="edit-item-memo-url" value="">';
    var row = '<tr>' +
        '<td><input type="text" class="edit-item-name" placeholder="আইটেম" oninput="calculateEditRow(this)"></td>' +
        '<td><input type="number" class="edit-item-quantity" value="0" step="0.1" min="0" oninput="calculateEditRow(this)"></td>' +
        '<td><select class="edit-item-unit" onchange="calculateEditRow(this)">' + unitOpts + '</select></td>' +
        '<td><input type="number" class="edit-item-price" value="0" step="0.01" min="0" oninput="calculateEditRow(this)"></td>' +
        '<td class="calc-cell edit-item-total">৳ ০</td>' +
        '<td><select class="edit-item-category">' + catOpts + '</select></td>' +
        '<td class="memo-cell">' + emptyMemoCell + '</td>' +
        '<td><button type="button" class="delete-btn" onclick="deleteEditRow(this)">✕</button></td>' +
        '</tr>';
    tbody.insertAdjacentHTML('beforeend', row);
    updateEditSummaryTotal();
}

function calculateEditRow(input) {
    var tr = input.closest('tr');
    if (!tr) return;
    var qtyEl = tr.querySelector('.edit-item-quantity');
    var priceEl = tr.querySelector('.edit-item-price');
    var qty = parseEditNumber(qtyEl && qtyEl.value);
    var price = parseEditNumber(priceEl && priceEl.value);
    var total = effectiveQtyForTotal(qty) * price;
    var totalEl = tr.querySelector('.edit-item-total');
    if (totalEl) totalEl.textContent = '৳ ' + (Number.isFinite(total) ? total : 0).toLocaleString('bn-BD');
    updateEditSummaryTotal();
}

function deleteEditRow(btn) {
    var tbody = document.getElementById('edit-items-tbody');
    if (tbody.rows.length <= 1) return;
    btn.closest('tr').remove();
    updateEditSummaryTotal();
}

function updateEditSummaryTotal() {
    var total = 0;
    document.querySelectorAll('#edit-items-tbody tr').forEach(function (tr) {
        var qtyEl = tr.querySelector('.edit-item-quantity');
        var priceEl = tr.querySelector('.edit-item-price');
        total += effectiveQtyForTotal(parseEditNumber(qtyEl && qtyEl.value)) * parseEditNumber(priceEl && priceEl.value);
    });
    var el = document.getElementById('edit-summary-total');
    if (el) el.textContent = (Number.isFinite(total) ? total : 0).toLocaleString('bn-BD') + ' টাকা';
}

function closeEditEntryModal() {
    document.getElementById('edit-entry-overlay').classList.remove('show');
    editEntryId = null;
}

function parseEditNumber(val) {
    if (val === '' || val == null) return 0;
    var n = parseFloat(String(val).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
}

async function saveEditedEntry() {
    if (!editEntryId) return;
    var date = document.getElementById('edit-entry-date').value;
    var comment = document.getElementById('edit-entry-comment').value.trim() || null;
    var rows = document.querySelectorAll('#edit-items-tbody tr');
    var items = [];
    rows.forEach(function (tr) {
        var name = (tr.querySelector('.edit-item-name') && tr.querySelector('.edit-item-name').value) || '';
        if (!name.trim()) return;
        var qtyInput = tr.querySelector('.edit-item-quantity');
        var priceInput = tr.querySelector('.edit-item-price');
        var qty = parseEditNumber(qtyInput && qtyInput.value);
        var price = parseEditNumber(priceInput && priceInput.value);
        var total = effectiveQtyForTotal(qty) * price;
        var unit = (tr.querySelector('.edit-item-unit') && tr.querySelector('.edit-item-unit').value) || 'কেজি';
        var category = (tr.querySelector('.edit-item-category') && tr.querySelector('.edit-item-category').value) || 'মুদি';
        var memoUrl = (tr.querySelector('.edit-item-memo-url') && tr.querySelector('.edit-item-memo-url').value) || '';
        items.push({
            name: name.trim(),
            quantity: qty,
            unit: unit,
            price_per_unit: price,
            total_price: total,
            category: category,
            memo_image_url: memoUrl || null
        });
    });
    if (items.length === 0) {
        alert('কমপক্ষে একটি আইটেম দিন।');
        return;
    }
    var newTotal = items.reduce(function (s, it) { return s + (Number(it.total_price) || 0); }, 0);
    try {
        var prev = await storage.getEntryById(editEntryId);
        var previousTotal = Number(prev.entry.total_cost) || 0;
        var safeTotal = Number.isFinite(newTotal) ? newTotal : 0;
        await storage.updateEntry(editEntryId, {
            entry_date: date,
            total_cost: safeTotal,
            item_count: items.length,
            comment: comment,
            payment_status: prev.entry.payment_status || 'pending',
            bill_image_url: prev.entry.bill_image_url || null // Preserve existing bill image
        }, items);
        await addToEditLog(editEntryId, date, previousTotal, safeTotal);
        closeEditEntryModal();
        loadWorkerEntries();
        loadWorkerDashboard();
        loadAdminData();
        updateBalanceUI();
        alert('এন্ট্রি আপডেট হয়েছে।');
    } catch (err) {
        console.error('Error saving edited entry:', err);
        alert('ত্রুটি: ' + err.message);
    }
}

function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-admin-tab') === tabName);
    });
    document.querySelectorAll('.admin-tab-panel').forEach(function (p) {
        var id = p.id;
        p.classList.toggle('active', (tabName === 'last' && id === 'admin-panel-last') || (tabName === 'entries' && id === 'admin-panel-entries') || (tabName === 'analysis' && id === 'admin-panel-analysis') || (tabName === 'log' && id === 'admin-panel-log'));
    });
    if (tabName === 'last') loadLastEntryTab('admin');
    if (tabName === 'entries') {
        loadAdminData();
        if (!_cachedPastItemNames) loadAdminItemDropdown();
    }
    if (tabName === 'analysis') loadPriceAnalysis();
    if (tabName === 'log') renderAdminLog();
}

// Price analysis: search by item → show date, price, change %; no search → all items comparison
async function loadPriceAnalysis() {
    var tbody = document.getElementById('price-analysis-tbody');
    var thead = document.getElementById('price-analysis-thead');
    if (!tbody) return;
    var searchInput = document.getElementById('price-analysis-search-input');
    var searchTerm = (searchInput && searchInput.value) ? searchInput.value.trim() : '';
    try {
        var entries = await storage.getEntriesInDateRange('2000-01-01', '2099-12-31');
        if (!entries) entries = [];
        var attachItems = function (e) {
            var items = e.grocery_items || e._items || [];
            if (!items.length && storage._getItems) {
                items = storage._getItems().filter(function (it) { return String(it.entry_id) === String(e.id); });
            }
            e._items = Array.isArray(items) ? items : [];
            return e;
        };
        entries = entries.map(attachItems);
        var flat = [];
        entries.forEach(function (e) {
            var d = e.entry_date || '';
            (e._items || []).forEach(function (it) {
                var name = (it.item_name || '').trim();
                if (name) flat.push({ item_name: name, price: Number(it.price_per_unit) || 0, entry_date: d });
            });
        });
        var byName = {};
        flat.forEach(function (r) {
            if (!byName[r.item_name]) byName[r.item_name] = [];
            byName[r.item_name].push({ price: r.price, entry_date: r.entry_date });
        });

        if (searchTerm) {
            var namesMatching = Object.keys(byName).filter(function (name) {
                return name.indexOf(searchTerm) >= 0;
            });
            if (namesMatching.length === 0) {
                if (thead) thead.innerHTML = '<tr><th>তারিখ</th><th>দাম (৳)</th><th>পরিবর্তন</th></tr>';
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:12px;">কোনো আইটেম মিলেছে না। অন্য নাম লিখে খুঁজুন।</td></tr>';
            } else {
                var showName = namesMatching.sort(function (a, b) { return a.localeCompare(b, 'bn'); })[0];
                var history = byName[showName].sort(function (a, b) { return (b.entry_date || '').localeCompare(a.entry_date || ''); });
                if (thead) thead.innerHTML = '<tr><th>তারিখ</th><th>দাম (৳)</th><th>পরিবর্তন</th></tr>';
                var historyRows = [];
                for (var i = 0; i < history.length; i++) {
                    var prevPrice = i < history.length - 1 ? history[i + 1].price : null;
                    var currPrice = history[i].price;
                    var changeStr = '—';
                    var trendClass = '';
                    if (prevPrice !== null && prevPrice !== undefined) {
                        var pct = prevPrice !== 0 ? ((currPrice - prevPrice) / prevPrice) * 100 : 0;
                        changeStr = pct > 0 ? '↑ ' + pct.toFixed(1) + '% বেড়েছে' : pct < 0 ? '↓ ' + Math.abs(pct).toFixed(1) + '% কমেছে' : '—';
                        trendClass = pct > 0 ? 'price-up' : pct < 0 ? 'price-down' : '';
                    } else {
                        changeStr = 'প্রথম কেনা';
                    }
                    historyRows.push('<tr><td>' + formatDate(history[i].entry_date) + '</td><td>৳ ' + Number(currPrice).toLocaleString('bn-BD') + '</td><td class="' + trendClass + '">' + changeStr + '</td></tr>');
                }
                tbody.innerHTML = historyRows.join('');
            }
        } else {
            if (thead) thead.innerHTML = '<tr><th>আইটেম</th><th>দাম (আগের বার)</th><th>দাম (এখন)</th><th>পরিবর্তন</th><th>প্রবণতা</th></tr>';
            var rows = [];
            Object.keys(byName).forEach(function (name) {
                var arr = byName[name].sort(function (a, b) { return (b.entry_date || '').localeCompare(a.entry_date || ''); });
                var current = arr[0].price;
                var previous = arr.length > 1 ? arr[1].price : null;
                var changeAmount = null;
                var changePercent = null;
                var trend = '—';
                if (previous !== null && previous !== undefined) {
                    changeAmount = current - previous;
                    changePercent = previous !== 0 ? (changeAmount / previous) * 100 : 0;
                    trend = changeAmount > 0 ? '↑ উঠেছে' : changeAmount < 0 ? '↓ নেমেছে' : '—';
                }
                rows.push({ item_name: name, previousPrice: previous, currentPrice: current, changeAmount: changeAmount, changePercent: changePercent, trend: trend });
            });
            rows.sort(function (a, b) { return a.item_name.localeCompare(b.item_name, 'bn'); });
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:12px;">কোনো ডেটা নেই। এন্ট্রি যোগ করুন বা আইটেমের নাম লিখে খুঁজুন।</td></tr>';
            } else {
                tbody.innerHTML = rows.map(function (r) {
                    var prevStr = r.previousPrice !== null && r.previousPrice !== undefined ? ('৳ ' + Number(r.previousPrice).toLocaleString('bn-BD')) : '—';
                    var currStr = '৳ ' + Number(r.currentPrice).toLocaleString('bn-BD');
                    var changeStr = '—';
                    if (r.changeAmount !== null && r.changeAmount !== undefined) {
                        var sign = r.changeAmount >= 0 ? '+' : '';
                        changeStr = sign + '৳' + Number(r.changeAmount).toLocaleString('bn-BD');
                        if (r.changePercent !== null) changeStr += ' (' + (r.changePercent >= 0 ? '+' : '') + r.changePercent.toFixed(1) + '%)';
                    }
                    var trendClass = r.trend.indexOf('উঠেছে') >= 0 ? 'price-up' : r.trend.indexOf('নেমেছে') >= 0 ? 'price-down' : '';
                    return '<tr><td>' + escapeHtml(r.item_name) + '</td><td>' + prevStr + '</td><td>' + currStr + '</td><td>' + changeStr + '</td><td class="' + trendClass + '">' + r.trend + '</td></tr>';
                }).join('');
            }
        }
    } catch (err) {
        console.error('Error loading price analysis:', err);
        if (thead) thead.innerHTML = '<tr><th>আইটেম</th><th>দাম (আগের বার)</th><th>দাম (এখন)</th><th>পরিবর্তন</th><th>প্রবণতা</th></tr>';
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#946a6a;padding:12px;">' + getNetworkErrorMessage(err) + '</td></tr>';
    }
}

async function renderAdminLog() {
    var tbody = document.getElementById('admin-log-tbody');
    if (!tbody) return;
    var log = await getEditLog();
    if (log.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:12px;">কোনো এডিট রেকর্ড নেই</td></tr>';
    } else {
        tbody.innerHTML = log.map(function (e) {
            var entryDate = e.entry_date || '';
            var entryStr = entryDate.length >= 10 ? entryDate.substring(8, 10) + '/' + entryDate.substring(5, 7) + '/' + entryDate.substring(0, 4) : entryDate;
            var editedAt = e.edited_at || '';
            var editedStr = editedAt.length >= 16 ? editedAt.substring(8, 10) + '/' + editedAt.substring(5, 7) + '/' + editedAt.substring(0, 4) + ' ' + editedAt.substring(11, 16) : editedAt;
            var newTotalCell = (e.summary === 'Entry deleted') ? 'ডিলিট হয়েছে' : ('৳ ' + Number(e.new_total).toLocaleString('bn-BD'));
            return '<tr><td>' + entryStr + '</td><td>' + editedStr + '</td><td>৳ ' + Number(e.previous_total).toLocaleString('bn-BD') + '</td><td>' + newTotalCell + '</td></tr>';
        }).join('');
    }
}

async function openEditLogModal() {
    var log = await getEditLog();
    var tbody = document.getElementById('edit-log-tbody');
    if (!tbody) return;
    if (log.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:12px;">কোনো এডিট রেকর্ড নেই</td></tr>';
    } else {
        tbody.innerHTML = log.map(function (e) {
            var entryDate = e.entry_date || '';
            var entryStr = entryDate.length >= 10 ? entryDate.substring(8, 10) + '/' + entryDate.substring(5, 7) + '/' + entryDate.substring(0, 4) : entryDate;
            var editedAt = e.edited_at || '';
            var editedStr = editedAt;
            if (editedAt.length >= 16) {
                editedStr = editedAt.substring(8, 10) + '/' + editedAt.substring(5, 7) + '/' + editedAt.substring(0, 4) + ' ' + editedAt.substring(11, 16);
            }
            var newTotalCell = (e.summary === 'Entry deleted') ? 'ডিলিট হয়েছে' : ('৳ ' + Number(e.new_total).toLocaleString('bn-BD'));
            return '<tr>' +
                '<td>' + entryStr + '</td>' +
                '<td>' + editedStr + '</td>' +
                '<td>৳ ' + Number(e.previous_total).toLocaleString('bn-BD') + '</td>' +
                '<td>' + newTotalCell + '</td>' +
                '</tr>';
        }).join('');
    }
    document.getElementById('edit-log-overlay').classList.add('show');
}

function closeEditLogModal() {
    document.getElementById('edit-log-overlay').classList.remove('show');
}
