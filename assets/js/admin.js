// assets/js/admin.js
// Full admin dashboard JS — updated: openListingModal restored, improved error traps, compact table behavior

// NOTE: requires window.supabaseClient (assets/js/config.js)

let currentAdminId = null;
let ownerSearchTimer = null;

// ----------------- TOAST / LOG -----------------
function toast(msg, type = 'info') {
    console.log(`[toast ${type}]`, msg);
    // simple non-blocking info; replace with UI toast if you want
}

// ----------------- CENTRAL ERROR HANDLER -----------------
function handleSupabaseError(err, context = '') {
    console.error(`Supabase error (${context}):`, err);
    const msg = err?.message || JSON.stringify(err);
    toast(`${context}: ${msg}`, 'error');

    const status = err?.status || (msg && msg.toLowerCase().includes('permission denied') ? 403 : null);
    if (status === 403) {
        console.error('=== RLS / Permission Denied detected ===');
        if (context?.includes('promotions') || context?.includes('promotions.read') || context?.includes('promotions.insert')) {
        console.error('SQL to fix promotions RLS (paste into Supabase SQL editor):\n\n' +
    `ALTER TABLE IF EXISTS promotions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Public read promotions" ON promotions;
    DROP POLICY IF EXISTS "Admin manage promotions" ON promotions;

    CREATE POLICY "Public read promotions" ON promotions FOR SELECT USING (true);

    CREATE POLICY "Admin manage promotions" ON promotions FOR ALL
    USING ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true)
    WITH CHECK ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true);
    `);
        }

        if (context?.includes('listings') || context?.includes('listings.read')) {
        console.error('SQL to fix listings RLS (paste into Supabase SQL editor):\n\n' +
    `ALTER TABLE IF EXISTS listings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Public read listings" ON listings;
    DROP POLICY IF EXISTS "Admin full access listings" ON listings;
    DROP POLICY IF EXISTS "Owner access listings" ON listings;

    CREATE POLICY "Public read listings" ON listings FOR SELECT USING (true);

    CREATE POLICY "Admin full access listings" ON listings FOR ALL
    USING ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true)
    WITH CHECK ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true);

    CREATE POLICY "Owner access listings" ON listings FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);
    `);
        }
    }
}

// ----------------- DEBUG / CHECK HELPERS -----------------
async function debugCheckAuthAndPolicies() {
    console.log('debugCheckAuthAndPolicies: getUser()...');
    const { data, error } = await window.supabaseClient.auth.getUser();
    console.log('auth.getUser result:', { data, error });
    if (error) console.warn('auth.getUser error:', error);

    console.log('profiles current admin row (yours):');
    const me = data?.user?.id;
    if (!me) {
        console.warn('No user in session. Maybe not logged in.');
        return;
    }
    const { data: profile, error: profErr } = await window.supabaseClient.from('profiles').select('*').eq('id', me).maybeSingle();
    console.log('profile row:', { profile, profErr });
    if (profErr) console.warn('profiles read error:', profErr);
    toast('Check console for user/profile details', 'info');
}

// ----------------- MODAL HELPERS -----------------
function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

// ----------------- OPEN LISTING MODAL (was missing earlier) -----------------
function openListingModal() {
    // Reset & open listing modal
    try {
        const listingForm = document.getElementById('listingForm');
        if (listingForm) listingForm.reset();
        document.getElementById('selectedOwnerName').innerText = '';
        document.getElementById('selectedOwnerId').value = '';
        // ensure province select is ready (initListingFilters already fills)
        openModal('listingModal');
        // focus first input for quicker UX
        setTimeout(() => document.getElementById('listTitle')?.focus(), 120);
    } catch (err) {
        console.error('openListingModal error', err);
    }
}

// ----------------- AUTH & INIT -----------------
async function checkAdminAuth() {
    try {
        console.log('checkAdminAuth: requesting current user...');
        const { data, error } = await window.supabaseClient.auth.getUser();
        if (error) { handleSupabaseError(error, 'auth.getUser'); return; }
        const user = data?.user;
        if (!user) { console.warn('Not logged in - redirect to auth.html'); window.location.href = 'auth.html'; return; }

        const { data: profile, error: profileErr } = await window.supabaseClient.from('profiles').select('id,is_admin,full_name,email').eq('id', user.id).maybeSingle();
        if (profileErr) { handleSupabaseError(profileErr, 'profiles.read'); return; }
        if (!profile || profile.is_admin !== true) {
        toast('Access denied: you are not an admin. Check profiles.is_admin.', 'error');
        console.warn('profile missing or not admin', profile);
        // stop here
        return;
        }

        currentAdminId = user.id;
        document.getElementById('settingsEmail')?.setAttribute('value', profile.email || '');

        initUIBindings();
        fetchDashboardData();
    } catch (err) {
        console.error('checkAdminAuth unexpected error', err);
        toast('Initialization error: ' + (err.message || err), 'error');
    }
}

// ----------------- UI BINDINGS -----------------
function initUIBindings() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    mobileMenuBtn?.addEventListener('click', () => { sidebar.classList.toggle('active'); overlay.classList.toggle('active'); });
    overlay?.addEventListener('click', () => { sidebar.classList.remove('active'); overlay.classList.remove('active'); });

    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
    document.getElementById('refreshDashboardBtn')?.addEventListener('click', fetchDashboardData);
    document.getElementById('fetchUsersBtn')?.addEventListener('click', fetchUsers);

    // Ensure openListingModal exists (we added it)
    document.getElementById('openCreateListingBtn')?.addEventListener('click', openListingModal);

    document.getElementById('resetFiltersBtn')?.addEventListener('click', resetListingFilters);

    // Forms
    document.getElementById('eventForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
        const title = document.getElementById('evtTitle').value.trim();
        const date = document.getElementById('evtDate').value;
        const loc = document.getElementById('evtLoc').value.trim();
        if (!title || !date || !loc) { toast('Fill all event fields', 'error'); return; }
        const { error } = await window.supabaseClient.from('events').insert([{ title, event_date: date, specific_location: loc }]);
        if (error) { handleSupabaseError(error, 'events.insert'); return; }
        closeModal('eventModal'); fetchEvents(); toast('Event added');
        } catch (err) { console.error('eventForm submit error', err); toast('Add event failed: ' + err.message, 'error'); }
    });

    document.getElementById('promoForm')?.addEventListener('submit', createPromotion);
    document.getElementById('listingForm')?.addEventListener('submit', createListing);

    // Filters - bind change events
    document.getElementById('filterProvince')?.addEventListener('change', loadFilterDistricts);
    document.getElementById('filterDistrict')?.addEventListener('change', loadFilterSectors);
    document.getElementById('filterSector')?.addEventListener('change', fetchAllListings);

    // Listing modal cascades
    document.getElementById('selProvince')?.addEventListener('change', loadDistricts);
    document.getElementById('selDistrict')?.addEventListener('change', loadSectors);

    // init selects & default tab
    document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-btn[data-tab="dashboard"]')?.classList.add('active');

    initListingFilters();
}

// ----------------- DASHBOARD -----------------
async function fetchDashboardData() {
    try {
        console.log('fetchDashboardData...');
        const { count: userCount } = await window.supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).catch(e => { handleSupabaseError(e,'profiles.count'); return {}; });
        document.getElementById('totalUsers').innerText = userCount || 0;
        const { count: listingCount } = await window.supabaseClient.from('listings').select('*', { count: 'exact', head: true }).catch(e => { handleSupabaseError(e,'listings.count'); return {}; });
        document.getElementById('totalListings').innerText = listingCount || 0;
        const { count: bookingCount } = await window.supabaseClient.from('bookings').select('*', { count: 'exact', head: true }).catch(e => { handleSupabaseError(e,'bookings.count'); return {}; });
        document.getElementById('totalBookings').innerText = bookingCount || 0;

        const { data: revenueData, error: revenueErr } = await window.supabaseClient.from('bookings').select('total_price').eq('status','confirmed');
        if (revenueErr) handleSupabaseError(revenueErr, 'bookings.revenue');
        const totalRev = (revenueData || []).reduce((s, it) => s + (parseFloat(it.total_price || 0) || 0), 0);
        document.getElementById('totalRevenue').innerText = totalRev.toLocaleString() + ' RWF';
        fetchRecentBookings();
    } catch (err) { console.error('fetchDashboardData unexpected', err); }
}

async function fetchRecentBookings() {
    try {
        const { data, error } = await window.supabaseClient
        .from('bookings')
        .select('id, status, total_price, listings(title), profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(5);
        if (error) { handleSupabaseError(error, 'bookings.recent'); return; }
        const tbody = document.getElementById('recentBookingsTable'); tbody.innerHTML = '';
        if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6">No recent bookings</td></tr>'; return; }
        data.forEach((booking, i) => {
        tbody.innerHTML += `
            <tr>
            <td data-label="Index">${i+1}</td>
            <td data-label="ID">${booking.id?.substring(0,8) || ''}</td>
            <td data-label="Listing">${booking.listings?.title || 'N/A'}</td>
            <td data-label="Renter">${booking.profiles?.full_name || 'N/A'}</td>
            <td data-label="Status"><span class="status-badge status-${booking.status}">${booking.status}</span></td>
            <td data-label="Price">${Number(booking.total_price || 0).toLocaleString()} RWF</td>
            </tr>`;
        });
    } catch (err) { console.error('fetchRecentBookings unexpected', err); }
}

// ----------------- TABS -----------------
function switchTab(tabName) {
    document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tabName + 'Panel')?.classList.add('active');
    document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tabName}"]`)?.classList.add('active');

  // lazy load per tab
    if (tabName === 'listings') fetchAllListings();
    if (tabName === 'bookings') fetchAllBookings();
    if (tabName === 'events') fetchEvents();
    if (tabName === 'users') fetchUsers();
    if (tabName === 'promotions') fetchPromotions();
    if (tabName === 'messages') fetchChatUsers();
}

// ----------------- USERS -----------------
async function fetchUsers() {
    try {
        const { data: users, error } = await window.supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
        if (error) { handleSupabaseError(error, 'profiles.read'); return; }
        const tbody = document.getElementById('usersTableBody'); tbody.innerHTML = '';
        if (!users || users.length === 0) { tbody.innerHTML = '<tr><td colspan="8">No users found.</td></tr>'; return; }
        users.forEach((user, i) => {
        const initials = (user.full_name || '?').charAt(0).toUpperCase();
        const displayPhone = user.phone_number || '<span style="color:#ccc">--</span>';
        tbody.innerHTML += `
            <tr>
            <td data-label="Index">${i+1}</td>
            <td data-label="User"><div class="user-info"><div class="user-avatar">${initials}</div><div><span style="font-weight:600;">${user.full_name||'No Name'}</span><small style="color:#999;font-size:11px;">ID:${user.id?.substring(0,8)}</small></div></div></td>
            <td data-label="Email">${user.email||''}</td>
            <td data-label="Phone">${displayPhone}</td>
            <td data-label="Role"><select class="status-select ${user.is_admin ? 'admin-true' : ''}" onchange="updateUser('${user.id}','is_admin',this.value)"><option value="false" ${!user.is_admin ? 'selected' : ''}>User</option><option value="true" ${user.is_admin ? 'selected' : ''}>Admin</option></select></td>
            <td data-label="Owner"><select class="status-select ${user.is_owner ? 'owner-true' : ''}" onchange="updateUser('${user.id}','is_owner',this.value)"><option value="false" ${!user.is_owner ? 'selected' : ''}>Renter</option><option value="true" ${user.is_owner ? 'selected' : ''}>Owner</option></select></td>
            <td data-label="Status"><select class="status-select ${user.is_suspended ? 'suspended-true' : ''}" onchange="updateUser('${user.id}','is_suspended',this.value)"><option value="false" ${!user.is_suspended ? 'selected' : ''}>Active</option><option value="true" ${user.is_suspended ? 'selected' : ''}>Suspended</option></select></td>
            <td data-label="Action"><button class="btn-small btn-danger" onclick="deleteUser('${user.id}')"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
        });
    } catch (err) { console.error('fetchUsers unexpected', err); }
}

async function updateUser(userId, field, value) {
    try {
        const boolValue = (value === 'true');
        const { error } = await window.supabaseClient.from('profiles').update({ [field]: boolValue }).eq('id', userId);
        if (error) { handleSupabaseError(error, 'profiles.update'); return; }
        toast('User updated');
        fetchUsers();
    } catch (err) { console.error('updateUser unexpected', err); }
}

async function deleteUser(userId) {
    if (!confirm('Delete this user?')) return;
    try {
        const { error } = await window.supabaseClient.from('profiles').delete().eq('id', userId);
        if (error) { handleSupabaseError(error, 'profiles.delete'); return; }
        toast('User deleted'); fetchUsers();
    } catch (err) { console.error('deleteUser unexpected', err); }
}

// ----------------- LISTINGS & FILTERS -----------------
async function initListingFilters() {
    try {
        const provSel = document.getElementById('filterProvince');
        const selProv = document.getElementById('selProvince');
        const { data: provinces, error } = await window.supabaseClient.from('provinces').select('*').order('province_name');
        if (error) { handleSupabaseError(error, 'provinces.read'); return; }
        let opts = '<option value="">All Provinces</option>';
        (provinces || []).forEach(p => opts += `<option value="${p.id}">${p.province_name}</option>`);
        if (provSel) provSel.innerHTML = opts;
        if (selProv) selProv.innerHTML = '<option value="">Province</option>' + (provinces ? provinces.map(p => `<option value="${p.id}">${p.province_name}</option>`).join('') : '');
        fetchAllListings();
    } catch (err) { console.error('initListingFilters unexpected', err); }
}

async function loadFilterDistricts() {
    try {
        const prov = document.getElementById('filterProvince')?.value;
        const dist = document.getElementById('filterDistrict');
        const sect = document.getElementById('filterSector');
        if (!dist) return;
        dist.disabled = true; sect.disabled = true;
        dist.innerHTML = '<option value="">All Districts</option>'; sect.innerHTML = '<option value="">All Sectors</option>';
        if (!prov) { fetchAllListings(); return; }
        const { data, error } = await window.supabaseClient.from('districts').select('*').eq('province_id', prov);
        if (error) { handleSupabaseError(error, 'districts.read'); return; }
        let opts = '<option value="">All Districts</option>';
        (data || []).forEach(d => opts += `<option value="${d.id}">${d.district_name || d.name || d.display_name}</option>`);
        dist.innerHTML = opts; dist.disabled = false;
        fetchAllListings();
    } catch (err) { console.error('loadFilterDistricts unexpected', err); }
}

async function loadFilterSectors() {
    try {
        const dist = document.getElementById('filterDistrict')?.value;
        const sect = document.getElementById('filterSector');
        if (!sect) return;
        sect.disabled = true; sect.innerHTML = '<option value="">All Sectors</option>';
        if (!dist) { fetchAllListings(); return; }
        const { data, error } = await window.supabaseClient.from('sectors').select('*').eq('district_id', dist);
        if (error) { handleSupabaseError(error, 'sectors.read'); return; }
        let opts = '<option value="">All Sectors</option>'; (data || []).forEach(s => opts += `<option value="${s.id}">${s.sector_name || s.name}</option>`);
        sect.innerHTML = opts; sect.disabled = false; fetchAllListings();
    } catch (err) { console.error('loadFilterSectors unexpected', err); }
}

function resetListingFilters() {
    document.getElementById('filterProvince').value = '';
    const d = document.getElementById('filterDistrict'); if (d) { d.innerHTML = '<option value="">All Districts</option>'; d.disabled = true; }
    const s = document.getElementById('filterSector'); if (s) { s.innerHTML = '<option value="">All Sectors</option>'; s.disabled = true; }
    document.getElementById('listingSearchInput').value = '';
    fetchAllListings();
}

async function fetchAllListings() {
    try {
        const province = document.getElementById('filterProvince')?.value;
        const district = document.getElementById('filterDistrict')?.value;
        const sector = document.getElementById('filterSector')?.value;

        let query = window.supabaseClient.from('listings').select('*, listing_media(url), profiles(full_name), sectors(sector_name, district_id)');
        if (sector) query = query.eq('sector_id', sector);
        else if (district) {
        const { data: sectors, error: sErr } = await window.supabaseClient.from('sectors').select('id').eq('district_id', district);
        if (sErr) { handleSupabaseError(sErr, 'sectors.read'); return; }
        const sids = (sectors || []).map(s => s.id); if (sids.length) query = query.in('sector_id', sids);
        } else if (province) {
        const { data: districts, error: dErr } = await window.supabaseClient.from('districts').select('id').eq('province_id', province);
        if (dErr) { handleSupabaseError(dErr, 'districts.read'); return; }
        const dids = (districts || []).map(d => d.id);
        if (dids.length) {
            const { data: sectors, error: sErr } = await window.supabaseClient.from('sectors').select('id').in('district_id', dids);
            if (sErr) { handleSupabaseError(sErr, 'sectors.read'); return; }
            const sids = (sectors || []).map(s => s.id); if (sids.length) query = query.in('sector_id', sids);
        }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) { handleSupabaseError(error, 'listings.read'); return; }
        renderListingsTable(data || []);
    } catch (err) { console.error('fetchAllListings unexpected', err); }
}

function renderListingsTable(listings) {
    const tbody = document.getElementById('listingsTableBody'); tbody.innerHTML = '';
    if (!listings || listings.length === 0) { tbody.innerHTML = '<tr><td colspan="7">No listings found.</td></tr>'; return; }
    listings.forEach((item, i) => {
        const img = item.listing_media?.[0]?.url || 'assets/img/placeholder.jpg';
        const loc = item.specific_address || (item.sectors ? item.sectors.sector_name || 'Unknown' : 'Unknown');
        tbody.innerHTML += `
        <tr>
            <td data-label="Index">${i+1}</td>
            <td data-label="Image"><img src="${img}" style="width:50px;height:50px;border-radius:6px;object-fit:cover"></td>
            <td data-label="Title" style="font-weight:600;">${item.title}</td>
            <td data-label="Price">${Number(item.price_per_day || 0).toLocaleString()} RWF</td>
            <td data-label="Location">${loc}</td>
            <td data-label="Owner">${item.profiles?.full_name || 'N/A'}</td>
            <td data-label="Action"><button class="btn-small btn-danger" onclick="deleteItem('listings','${item.id}')"><i class="fa-solid fa-trash"></i></button></td>
        </tr>
        `;
    });
}

// ----------------- OWNER SEARCH -----------------
async function searchOwners() {
    const q = document.getElementById('ownerSearch')?.value.trim();
    const results = document.getElementById('ownerResults');
    if (!q) { if (results) results.style.display = 'none'; return; }
    clearTimeout(ownerSearchTimer);
    ownerSearchTimer = setTimeout(async () => {
        try {
        const { data, error } = await window.supabaseClient.from('profiles').select('id, full_name, email').ilike('full_name', `%${q}%`).limit(10);
        if (error) { handleSupabaseError(error, 'profiles.search'); return; }
        if (!results) return;
        results.innerHTML = (data || []).map(p => `<div class="search-result-item" onclick="selectOwner('${p.id}','${(p.full_name||'').replace(/'/g,"")}','${(p.email||'').replace(/'/g,"")}')"><div><strong>${p.full_name}</strong><small>${p.email||''}</small></div></div>`).join('');
        results.style.display = data && data.length ? 'block' : 'none';
        } catch (err) { console.error('searchOwners unexpected', err); }
    }, 180);
}

function selectOwner(id, name, email) {
    document.getElementById('selectedOwnerId').value = id;
    document.getElementById('selectedOwnerName').innerText = `${name}${email ? ' • ' + email : ''}`;
    document.getElementById('ownerResults').style.display = 'none';
}

// ----------------- CREATE LISTING -----------------
async function createListing(e) {
    e.preventDefault();
    const btn = document.getElementById('createBtn'); btn.disabled = true; btn.innerText = 'Creating...';
    try {
        const ownerId = document.getElementById('selectedOwnerId').value || null;
        const category = document.getElementById('listCategory').value;
        const price = Number(document.getElementById('listPrice').value || 0);
        const title = document.getElementById('listTitle').value.trim();
        const description = document.getElementById('listDesc').value.trim();
        const sector = document.getElementById('selSector')?.value || null;
        const address = document.getElementById('listAddress').value.trim();
        const fileInput = document.getElementById('listImageFile');

        if (!title || !price || !address || !fileInput.files.length) { toast('Please fill required fields and upload an image.', 'error'); btn.disabled = false; btn.innerText = 'Create Listing'; return; }

        const listingPayload = {
        owner_id: ownerId || currentAdminId,
        title, description, category,
        price_per_day: price,
        specific_address: address,
        sector_id: sector || null,
        is_available: true
        };

        const { data: inserted, error: insertErr } = await window.supabaseClient.from('listings').insert([listingPayload]).select().maybeSingle();
        if (insertErr) { handleSupabaseError(insertErr, 'listings.insert'); btn.disabled = false; btn.innerText = 'Create Listing'; return; }

        const file = fileInput.files[0];
        const fileName = `${Date.now()}_${file.name.replace(/\s/g,'_')}`;
        const bucket = 'listing-images';
        const { error: upErr } = await window.supabaseClient.storage.from(bucket).upload(fileName, file, { cacheControl: '3600', upsert: false });
        if (upErr) { handleSupabaseError(upErr, `storage.upload ${bucket}`); } 
        else {
        const { data: urlData } = window.supabaseClient.storage.from(bucket).getPublicUrl(fileName);
        const publicUrl = urlData?.publicUrl || null;
        if (publicUrl) {
            const { error: mediaErr } = await window.supabaseClient.from('listing_media').insert([{ listing_id: inserted.id, url: publicUrl, media_type: 'image' }]);
            if (mediaErr) handleSupabaseError(mediaErr, 'listing_media.insert');
        }
        }

        toast('Listing created!');
        closeModal('listingModal');
        fetchAllListings();
    } catch (err) { console.error('createListing unexpected', err); toast('Listing creation failed: ' + (err.message || err), 'error'); }
    finally { btn.disabled = false; btn.innerText = 'Create Listing'; }
}

// ----------------- PROMOTIONS -----------------
async function openPromoModal() {
    try {
        openModal('promotionModal');
        const { data: listings, error } = await window.supabaseClient.from('listings').select('id,title').limit(200);
        if (error) { handleSupabaseError(error, 'listings.read'); return; }
        const select = document.getElementById('promoListingId'); let opts = '<option value="">-- General Promo (All) --</option>';
        (listings || []).forEach(l => opts += `<option value="${l.id}">${l.title}</option>`);
        select.innerHTML = opts;
    } catch (err) { console.error('openPromoModal unexpected', err); }
}

async function createPromotion(e) {
    e.preventDefault();
    const btn = document.getElementById('createPromoBtn'); btn.disabled = true; btn.innerText = 'Creating...';
    try {
        const code = document.getElementById('promoCode').value.trim();
        const listingId = document.getElementById('promoListingId').value || null;
        const discount = Number(document.getElementById('promoDiscount').value || 0);
        const start = document.getElementById('promoStart').value;
        const end = document.getElementById('promoEnd').value;
        const desc = document.getElementById('promoDesc').value.trim();
        const file = document.getElementById('promoImage').files[0];

        if (!code || !discount || !start || !end) { toast('Fill required promo fields', 'error'); btn.disabled = false; btn.innerText = 'Create Promotion'; return; }

        let imageUrl = null;
        if (file) {
        const fileName = `${Date.now()}_${file.name.replace(/\s/g,'_')}`;
        const { error: upErr } = await window.supabaseClient.storage.from('promotion-images').upload(fileName, file, { cacheControl: '3600' });
        if (upErr) { handleSupabaseError(upErr, 'storage.upload promotion-images'); } 
        else {
            const { data } = window.supabaseClient.storage.from('promotion-images').getPublicUrl(fileName);
            imageUrl = data?.publicUrl || null;
        }
        }

        const payload = { promo_code: code, listing_id: listingId || null, discount_percent: discount, valid_from: start, valid_until: end, description: desc, image_url: imageUrl };
        const { error } = await window.supabaseClient.from('promotions').insert([payload]);
        if (error) { handleSupabaseError(error, 'promotions.insert'); }
        else { toast('Promotion created'); closeModal('promotionModal'); fetchPromotions(); }
    } catch (err) { console.error('createPromotion unexpected', err); toast('Promo failed: ' + (err.message || err), 'error'); }
    finally { btn.disabled = false; btn.innerText = 'Create Promotion'; }
}

async function fetchPromotions() {
    try {
        const { data, error } = await window.supabaseClient.from('promotions').select('*, listings(title)');
        if (error) { handleSupabaseError(error, 'promotions.read'); return; }
        const tbody = document.getElementById('promotionsTableBody'); tbody.innerHTML = '';
        (data || []).forEach(p => {
        const img = p.image_url ? `<img src="${p.image_url}" style="width:40px;border-radius:4px;">` : '-';
        tbody.innerHTML += `<tr>
            <td data-label="Image">${img}</td>
            <td data-label="Code">${p.promo_code}</td>
            <td data-label="Listing">${p.listings?.title || 'All'}</td>
            <td data-label="Discount">${p.discount_percent}%</td>
            <td data-label="Dates">${p.valid_from || '-'} → ${p.valid_until || '-'}</td>
            <td data-label="Action"><button class="btn-small btn-danger" onclick="deleteItem('promotions','${p.id}')"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
        });
    } catch (err) { console.error('fetchPromotions unexpected', err); }
}

// ----------------- EVENTS -----------------
async function fetchEvents() {
    try {
        const { data, error } = await window.supabaseClient.from('events').select('*').order('event_date', { ascending: false });
        if (error) { handleSupabaseError(error, 'events.read'); return; }
        const tbody = document.getElementById('eventsTableBody'); tbody.innerHTML = '';
        (data || []).forEach((e, i) => {
        tbody.innerHTML += `<tr>
            <td data-label="Index">${i+1}</td>
            <td data-label="Title">${e.title}</td>
            <td data-label="Date">${e.event_date}</td>
            <td data-label="Location">${e.specific_location || '—'}</td>
            <td data-label="Action"><button class="btn-small btn-danger" onclick="deleteItem('events','${e.id}')"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
        });
    } catch (err) { console.error('fetchEvents unexpected', err); }
}

// ----------------- BOOKINGS -----------------
async function fetchAllBookings() {
    try {
        const { data, error } = await window.supabaseClient.from('bookings').select('*, listings(title), profiles(full_name)').order('created_at', { ascending: false });
        if (error) { handleSupabaseError(error, 'bookings.read'); return; }
        const tbody = document.getElementById('allBookingsBody'); tbody.innerHTML = '';
        (data || []).forEach((b, i) => {
        tbody.innerHTML += `<tr>
            <td data-label="Index">${i+1}</td>
            <td data-label="ID">${b.id?.substring(0,8)}</td>
            <td data-label="Listing">${b.listings?.title || '-'}</td>
            <td data-label="Renter">${b.profiles?.full_name || '-'}</td>
            <td data-label="Dates">${b.start_date || '-'} → ${b.end_date || '-'}</td>
            <td data-label="Total">${b.total_price || '-'}</td>
            <td data-label="Status">${b.status}</td>
        </tr>`;
        });
    } catch (err) { console.error('fetchAllBookings unexpected', err); }
}

// ----------------- MESSAGES -----------------
async function fetchChatUsers() {
    try {
        const myId = currentAdminId;
        console.log('fetchChatUsers: reading messages to find user list....');
        const { data: msgs, error } = await window.supabaseClient.from('messages').select('sender_id,receiver_id').or(`sender_id.eq.${myId},receiver_id.eq.${myId}`);
        if (error) { handleSupabaseError(error, 'messages.read'); return; }
        if (!msgs || msgs.length === 0) { document.getElementById('chatUserList').innerHTML = '<p style="padding:12px;color:#888;">No messages yet.</p>'; return; }
        const ids = new Set();
        msgs.forEach(m => { if (m.sender_id !== myId) ids.add(m.sender_id); if (m.receiver_id !== myId) ids.add(m.receiver_id); });
        const { data: profiles, error: profErr } = await window.supabaseClient.from('profiles').select('id, full_name').in('id', Array.from(ids));
        if (profErr) { handleSupabaseError(profErr, 'profiles.read'); return; }
        const list = document.getElementById('chatUserList'); list.innerHTML = '';
        (profiles || []).forEach(p => {
        const item = document.createElement('div'); item.className = 'chat-user-item';
        item.innerHTML = `<div class="chat-user-avatar">${(p.full_name||'?').charAt(0).toUpperCase()}</div><span>${p.full_name}</span>`;
        item.onclick = () => loadChat(p);
        list.appendChild(item);
        });
    } catch (err) { console.error('fetchChatUsers unexpected', err); }
}

// ----------------- remaining helpers -----------------
async function loadChat(userProfile) {
    document.getElementById('chatWindowHeader').innerText = userProfile.full_name;
    document.getElementById('currentChatUserId').value = userProfile.id;
    document.getElementById('messageInput').disabled = false;
    document.getElementById('sendMessageBtn').disabled = false;

    try {
        const myId = currentAdminId, theirId = userProfile.id;
        const { data: messages, error } = await window.supabaseClient.from('messages').select('*').or(`and(sender_id.eq.${myId},receiver_id.eq.${theirId}),and(sender_id.eq.${theirId},receiver_id.eq.${myId})`).order('created_at', { ascending: true });
        if (error) { handleSupabaseError(error, 'messages.read'); return; }
        const chatArea = document.getElementById('chatMessagesArea'); chatArea.innerHTML = '';
        (messages || []).forEach(m => {
        const bubble = document.createElement('div'); const isMe = m.sender_id === myId;
        bubble.className = `message-bubble ${isMe ? 'message-sent' : 'message-received'}`; bubble.innerText = m.content;
        chatArea.appendChild(bubble);
        });
        chatArea.scrollTop = chatArea.scrollHeight;
    } catch (err) { console.error('loadChat unexpected', err); }
}

async function sendMessage() {
    const input = document.getElementById('messageInput'); const content = input.value.trim();
    const receiverId = document.getElementById('currentChatUserId').value; const senderId = currentAdminId;
    if (!content || !receiverId) return;
    try {
        const { error } = await window.supabaseClient.from('messages').insert([{ sender_id: senderId, receiver_id: receiverId, content }]);
        if (error) { handleSupabaseError(error, 'messages.insert'); return; }
        input.value = ''; loadChat({ id: receiverId, full_name: document.getElementById('chatWindowHeader').innerText });
    } catch (err) { console.error('sendMessage unexpected', err); }
}

async function deleteItem(table, id) {
    if (!confirm('Delete?')) return;
    try {
        const { error } = await window.supabaseClient.from(table).delete().eq('id', id);
        if (error) { handleSupabaseError(error, `${table}.delete`); return; }
        toast('Deleted');
        if (table === 'listings') fetchAllListings();
        if (table === 'events') fetchEvents();
        if (table === 'promotions') fetchPromotions();
        if (table === 'profiles') fetchUsers();
    } catch (err) { console.error('deleteItem unexpected', err); }
}

function filterTable(inputId, tableId) {
    const val = document.getElementById(inputId)?.value?.toLowerCase() || '';
    const rows = document.getElementById(tableId)?.getElementsByTagName('tr') || [];
    for (let i = 0; i < rows.length; i++) {
        const text = (rows[i].textContent || rows[i].innerText).toLowerCase();
        rows[i].style.display = text.indexOf(val) > -1 ? '' : 'none';
    }
}

function filterListings() {
    const q = document.getElementById('listingSearchInput').value.trim().toLowerCase();
    const rows = document.getElementById('listingsTableBody')?.getElementsByTagName('tr') || [];
    for (let r of rows) {
        const text = (r.textContent || r.innerText).toLowerCase();
        r.style.display = q ? (text.includes(q) ? '' : 'none') : '';
    }
}

// ----------------- LOCATION SELECTS FOR FORM (modal) -----------------
async function loadDistricts() {
    try {
        const provId = document.getElementById('selProvince')?.value;
        const distSelect = document.getElementById('selDistrict'); const sectSelect = document.getElementById('selSector');
        distSelect.disabled = true; sectSelect.disabled = true; distSelect.innerHTML = '<option value="">District</option>'; sectSelect.innerHTML = '<option value="">Sector</option>';
        if (!provId) return;
        const { data, error } = await window.supabaseClient.from('districts').select('*').eq('province_id', provId);
        if (error) { handleSupabaseError(error, 'districts.read (form)'); return; }
        let opts = '<option value="">District</option>'; (data || []).forEach(d => opts += `<option value="${d.id}">${d.district_name || d.name}</option>`);
        distSelect.innerHTML = opts; distSelect.disabled = false;
    } catch (err) { console.error('loadDistricts unexpected', err); }
}

async function loadSectors() {
    try {
        const distId = document.getElementById('selDistrict')?.value;
        const sectSelect = document.getElementById('selSector');
        sectSelect.disabled = true; sectSelect.innerHTML = '<option value="">Sector</option>';
        if (!distId) return;
        const { data, error } = await window.supabaseClient.from('sectors').select('*').eq('district_id', distId);
        if (error) { handleSupabaseError(error, 'sectors.read (form)'); return; }
        let opts = '<option value="">Sector</option>'; (data || []).forEach(s => opts += `<option value="${s.id}">${s.sector_name || s.name}</option>`);
        sectSelect.innerHTML = opts; sectSelect.disabled = false;
    } catch (err) { console.error('loadSectors unexpected', err); }
}

// ----------------- SETTINGS & LOGOUT -----------------
async function handleLogout() {
    try { await window.supabaseClient.auth.signOut(); window.location.href = 'auth.html'; }
    catch (err) { console.error('logout error', err); toast('Logout failed', 'error'); }
}

// ----------------- STARTUP -----------------
checkAdminAuth();

// expose debug helper to console if folks want it
window.debugCheckAuthAndPolicies = debugCheckAuthAndPolicies;
