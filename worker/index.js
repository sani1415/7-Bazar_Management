const json = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }
    });

async function sign(secret, value) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function readCookie(request, name) {
    const header = request.headers.get('cookie') || '';
    const part = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}

async function isSignedIn(request, env) {
    if (!env.SESSION_SECRET) return false;
    const [marker, exp, sig] = readCookie(request, 'bazar_session').split('.');
    if (marker !== 'ok' || !exp || !sig || Number(exp) < Date.now()) return false;
    return sig === await sign(env.SESSION_SECRET, `ok.${exp}`);
}

function sessionCookie(token, request) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `bazar_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`;
}

function clearCookie() {
    return 'bazar_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}

function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/')) {
            return handleApi(request, env, url);
        }
        return env.ASSETS.fetch(request);
    }
};

async function handleApi(request, env, url) {
    try {
        const signedIn = await isSignedIn(request, env);
        const parts = url.pathname.split('/').filter(Boolean);

        if (url.pathname === '/api/session' && request.method === 'GET') {
            return json({ ok: signedIn });
        }

        if (url.pathname === '/api/login' && request.method === 'POST') {
            if (!env.EDITOR_EMAIL || !env.EDITOR_PASSWORD || !env.SESSION_SECRET) {
                return json({ error: 'লগইন এখনো সেট করা হয়নি।' }, 503);
            }
            const body = await request.json();
            if (body.email !== env.EDITOR_EMAIL || body.password !== env.EDITOR_PASSWORD) {
                return json({ error: 'ইমেইল বা পাসওয়ার্ড মিলছে না।' }, 401);
            }
            const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
            const sig = await sign(env.SESSION_SECRET, `ok.${exp}`);
            return json({ ok: true }, 200, { 'set-cookie': sessionCookie(`ok.${exp}.${sig}`, request) });
        }

        if (url.pathname === '/api/logout' && request.method === 'POST') {
            return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
        }

        if (parts[0] === 'images' && parts[1] && request.method === 'GET') {
            if (!signedIn) return new Response('Sign in required', { status: 401 });
            if (!env.IMAGES) return new Response('Not found', { status: 404 });
            const object = await env.IMAGES.get(parts.slice(1).join('/'));
            if (!object) return new Response('Not found', { status: 404 });
            return new Response(object.body, {
                headers: {
                    'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
                    'cache-control': 'private, max-age=3600'
                }
            });
        }

        if (!signedIn) return json({ error: 'প্রবেশ করতে লগইন করুন।' }, 401);

        if (url.pathname === '/api/images' && request.method === 'POST') {
            if (!env.IMAGES) return json({ error: 'ছবির স্টোরেজ চালু নেই।' }, 503);
            const form = await request.formData();
            const file = form.get('file');
            if (!file || typeof file === 'string') return json({ error: 'কোনো ছবি পাওয়া যায়নি।' }, 400);
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
            const key = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
            await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'image/jpeg' } });
            return json({ url: `/images/${key}` });
        }

        if (url.pathname === '/api/money' && request.method === 'GET') {
            const rows = await env.DB.prepare('SELECT id, entry_date AS date, amount FROM money_log ORDER BY entry_date DESC, id DESC').all();
            return json(rows.results || []);
        }

        if (url.pathname === '/api/money' && request.method === 'POST') {
            const body = await request.json();
            const amount = num(body.amount, NaN);
            if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'সঠিক টাকার অঙ্ক দিন।' }, 400);
            const date = body.date || new Date().toISOString().slice(0, 10);
            const row = await env.DB.prepare(
                'INSERT INTO money_log (entry_date, amount) VALUES (?, ?) RETURNING id, entry_date AS date, amount'
            ).bind(date, amount).first();
            return json(row, 201);
        }

        if (url.pathname === '/api/edit-log' && request.method === 'GET') {
            const rows = await env.DB.prepare('SELECT * FROM edit_log ORDER BY edited_at DESC').all();
            return json(rows.results || []);
        }

        if (url.pathname === '/api/edit-log' && request.method === 'POST') {
            const body = await request.json();
            await env.DB.prepare(
                'INSERT INTO edit_log (entry_id, entry_date, previous_total, new_total, summary) VALUES (?, ?, ?, ?, ?)'
            ).bind(body.entry_id || null, body.entry_date, num(body.previous_total, null), num(body.new_total), body.summary || null).run();
            return json({ ok: true }, 201);
        }

        if (url.pathname === '/api/entries' && request.method === 'GET') {
            return json(await listEntries(env, url));
        }

        if (url.pathname === '/api/entries' && request.method === 'POST') {
            const body = await request.json();
            const created = await env.DB.prepare(
                `INSERT INTO grocery_entries (entry_date, total_cost, item_count, comment, bill_image_url, payment_status)
                 VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
            ).bind(
                body.entry_date,
                num(body.total_cost),
                num(body.item_count),
                body.comment || null,
                body.bill_image_url || null,
                body.payment_status === 'paid' ? 'paid' : 'pending'
            ).first();
            const items = Array.isArray(body.items) ? body.items : [];
            if (items.length) {
                await env.DB.batch(items.map((item) => env.DB.prepare(
                    `INSERT INTO grocery_items (entry_id, item_name, quantity, unit, price_per_unit, total_price, category, memo_image_url)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    created.id,
                    item.item_name || item.name || '',
                    num(item.quantity),
                    item.unit || 'কেজি',
                    num(item.price_per_unit),
                    num(item.total_price),
                    item.category || null,
                    item.memo_image_url || null
                )));
            }
            return json({ id: created.id }, 201);
        }

        if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && parts[3] === 'payment' && request.method === 'PATCH') {
            const body = await request.json();
            const status = body.payment_status === 'paid' ? 'paid' : 'pending';
            await env.DB.prepare(
                `UPDATE grocery_entries SET payment_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
            ).bind(status, parts[2]).run();
            return json({ ok: true });
        }

        if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && request.method === 'GET') {
            const entry = await env.DB.prepare('SELECT * FROM grocery_entries WHERE id = ?').bind(parts[2]).first();
            if (!entry) return json({ error: 'এন্ট্রি পাওয়া যায়নি।' }, 404);
            const items = await env.DB.prepare('SELECT * FROM grocery_items WHERE entry_id = ? ORDER BY id').bind(parts[2]).all();
            return json({ entry, items: items.results || [] });
        }

        if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && request.method === 'PUT') {
            const body = await request.json();
            const existing = await env.DB.prepare('SELECT id FROM grocery_entries WHERE id = ?').bind(parts[2]).first();
            if (!existing) return json({ error: 'এন্ট্রি পাওয়া যায়নি।' }, 404);
            const items = Array.isArray(body.items) ? body.items : [];
            const statements = [
                env.DB.prepare(
                    `UPDATE grocery_entries
                     SET entry_date = ?, total_cost = ?, item_count = ?, comment = ?, bill_image_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?`
                ).bind(body.entry_date, num(body.total_cost), num(body.item_count), body.comment || null, body.bill_image_url || null, parts[2]),
                env.DB.prepare('DELETE FROM grocery_items WHERE entry_id = ?').bind(parts[2])
            ];
            items.forEach((item) => {
                statements.push(env.DB.prepare(
                    `INSERT INTO grocery_items (entry_id, item_name, quantity, unit, price_per_unit, total_price, category, memo_image_url)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    parts[2],
                    item.item_name || item.name || '',
                    num(item.quantity),
                    item.unit || 'কেজি',
                    num(item.price_per_unit),
                    num(item.total_price),
                    item.category || null,
                    item.memo_image_url || null
                ));
            });
            await env.DB.batch(statements);
            return json({ ok: true });
        }

        if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && request.method === 'DELETE') {
            await env.DB.batch([
                env.DB.prepare('DELETE FROM grocery_items WHERE entry_id = ?').bind(parts[2]),
                env.DB.prepare('DELETE FROM grocery_entries WHERE id = ?').bind(parts[2])
            ]);
            return json({ ok: true });
        }

        return json({ error: 'পাওয়া যায়নি' }, 404);
    } catch (error) {
        return json({ error: error.message || 'সার্ভার সমস্যা' }, 500);
    }
}

async function listEntries(env, url) {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = url.searchParams.get('limit');
    const fields = url.searchParams.get('fields');
    const clauses = [];
    const binds = [];
    if (from) {
        clauses.push('entry_date >= ?');
        binds.push(from);
    }
    if (to) {
        clauses.push('entry_date <= ?');
        binds.push(to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const columns = fields === 'summary' ? 'total_cost, entry_date, payment_status' : '*';
    const limitSql = limit ? 'LIMIT ?' : '';
    if (limit) binds.push(Number(limit));
    const rows = await env.DB.prepare(
        `SELECT ${columns} FROM grocery_entries ${where} ORDER BY entry_date DESC, id DESC ${limitSql}`
    ).bind(...binds).all();
    const entries = rows.results || [];
    if (fields === 'summary' || !entries.length) return entries;
    const ids = entries.map((entry) => entry.id);
    const marks = ids.map(() => '?').join(',');
    const items = await env.DB.prepare(`SELECT * FROM grocery_items WHERE entry_id IN (${marks}) ORDER BY id`).bind(...ids).all();
    const byEntry = {};
    (items.results || []).forEach((item) => {
        if (!byEntry[item.entry_id]) byEntry[item.entry_id] = [];
        byEntry[item.entry_id].push(item);
    });
    return entries.map((entry) => ({ ...entry, grocery_items: byEntry[entry.id] || [] }));
}
