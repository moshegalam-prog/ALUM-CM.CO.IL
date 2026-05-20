
// ============ SUPABASE CONFIG ============
const SUPABASE_URL = 'https://gpbphwgoygcfzebmsplk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwYnBod2dveWdjZnplYm1zcGxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NzYwMzIsImV4cCI6MjA5MzI1MjAzMn0.3bbOukgs8NhxcdNNUH2svg1gptgwUAKBdvCE3np2Ivc';

// יצירת Supabase Client
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { 
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

let currentUserId = null;
// קטגוריות שתומכות בפרופיל אלומיניום (להרחבה בעתיד — פשוט הוסף שם פתח)
const PROFILE_CATEGORIES = ['חלון הזזה', 'חלון סלון', 'דלת מרפסת', 'תריס גלילה', 'רשת נגד יתושים'];
// ============ DB ABSTRACTION (Wraps Supabase) ============
// שכבת תאימות לאחור - מאפשרת לקוד הקיים להמשיך לעבוד

let db = null; // נשמר לתאימות אבל לא בשימוש

async function openDB() {
  // בדיקת session קיים
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUserId = session.user.id;
  }
  return Promise.resolve();
}

// פונקציה גנרית - שואפת dbGet ל-Supabase select
async function dbGet(store, key) {
  if (!currentUserId && store !== 'auth') {
    return null;
  }
  
  try {
    if (store === 'settings') {
      // הגדרות מטופלות בנפרד
      if (key === 'user') {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return null;
        const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        return { 
          key: 'user', 
          value: profile ? {
            id: profile.id,
            email: profile.email,
            name: profile.full_name,
            plan: profile.plan,
            trialEnds: profile.trial_ends_at
          } : null 
        };
      }
      if (key === 'business') {
        const { data } = await sb.from('business').select('*').eq('user_id', currentUserId).maybeSingle();
        return data ? { key: 'business', value: businessFromDb(data) } : null;
      }
      return null;
    }
    
    if (store === 'clients') {
      const { data } = await sb.from('clients').select('*').eq('id', key).maybeSingle();
      return data ? clientFromDb(data) : null;
    }
    
    if (store === 'quotes') {
      const { data: quote } = await sb.from('quotes').select('*').eq('id', key).maybeSingle();
      if (!quote) return null;
      // 🛠️ FIX: order by 'position' (לא order_idx — לא קיים בטבלה)
      const { data: items } = await sb.from('quote_items').select('*').eq('quote_id', key).order('position');
      return quoteFromDb(quote, items || []);
    }
    
    if (store === 'media') {
      const { data } = await sb.from('item_media').select('*').eq('id', key).maybeSingle();
      return data ? mediaFromDb(data) : null;
    }
    
    return null;
  } catch (e) {
    console.error('dbGet error:', store, key, e);
    return null;
  }
}

// dbPut - שואף לעדכון/יצירה
async function dbPut(store, value) {
  if (!currentUserId && store !== 'auth') {
    console.warn('dbPut without user:', store);
    return value;
  }
  
  try {
    if (store === 'settings') {
      if (value.key === 'user') {
        // הגדרות משתמש מתעדכנות דרך profile
        if (value.value && value.value.name) {
          await sb.from('profiles').update({ full_name: value.value.name }).eq('id', currentUserId);
        }
        return value;
      }
      if (value.key === 'business') {
        const v = value.value;
        const businessData = {
          user_id: currentUserId,
          name: v.name || null,
          phone: v.phone || null,
          email: v.email || null,
          address: v.address || null,
          business_id: v.id || null,
          website: v.website || null,
          terms: v.terms || null,
          validity_days: parseInt(v.validity) || 30,
          logo_url: v.logo || null
        };
        const { error } = await sb.from('business').upsert(businessData, { onConflict: 'user_id' });
        if (error) console.error('save business error:', error);
        return value;
      }
      return value;
    }
    
    if (store === 'clients') {
      const clientData = clientToDb(value);
      const { error } = await sb.from('clients').upsert(clientData);
      if (error) console.error('save client error:', error);
      return value;
    }
    
    if (store === 'quotes') {
      const { quoteData, items } = quoteToDb(value);
      
      // upsert ההצעה
      const { error: qErr } = await sb.from('quotes').upsert(quoteData);
      if (qErr) { console.error('save quote error:', qErr); return value; }
      
      // מחיקת פריטים ישנים והוספת חדשים
      const { error: dErr } = await sb.from('quote_items').delete().eq('quote_id', value.id);
      if (dErr) console.error('delete items error:', dErr);
      
      if (items.length > 0) {
        const { error: iErr } = await sb.from('quote_items').insert(items);
        if (iErr) console.error('save items error:', iErr);
      }
      
      return value;
    }
    
    if (store === 'media') {
      const mediaData = mediaToDb(value);
      const { error } = await sb.from('item_media').upsert(mediaData);
      if (error) console.error('save media error:', error);
      return value;
    }
    
    return value;
  } catch (e) {
    console.error('dbPut error:', store, e);
    return value;
  }
}

async function dbDelete(store, key) {
  if (!currentUserId) return;
  
  try {
    if (store === 'clients') {
      await sb.from('clients').delete().eq('id', key);
    } else if (store === 'quotes') {
      await sb.from('quote_items').delete().eq('quote_id', key);
      await sb.from('quotes').delete().eq('id', key);
    } else if (store === 'media') {
      await sb.from('item_media').delete().eq('id', key);
    }
  } catch (e) {
    console.error('dbDelete error:', store, key, e);
  }
}

async function dbAll(store) {
  if (!currentUserId) return [];
  
  try {
    if (store === 'clients') {
      const { data } = await sb.from('clients').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false });
      return (data || []).map(clientFromDb);
    }
    
    if (store === 'quotes') {
      const { data: quotes } = await sb.from('quotes').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false });
      if (!quotes || quotes.length === 0) return [];
      
      // טעינת items לכל ההצעות
      const ids = quotes.map(q => q.id);
      // 🛠️ FIX: order by 'position' (לא order_idx — לא קיים בטבלה)
      const { data: allItems, error: itemsErr } = await sb.from('quote_items').select('*').in('quote_id', ids).order('position');
      if (itemsErr) console.error('load items error:', itemsErr);
      
      const itemsByQuote = {};
      (allItems || []).forEach(it => {
        if (!itemsByQuote[it.quote_id]) itemsByQuote[it.quote_id] = [];
        itemsByQuote[it.quote_id].push(it);
      });
      
      return quotes.map(q => quoteFromDb(q, itemsByQuote[q.id] || []));
    }
    
    if (store === 'media') {
      // 🛠️ FIX: היה 'supabase' (לא קיים) — צריך 'sb'
      const { data } = await sb
        .from('item_media')
        .select('*, quote_items!inner(quote_id, quotes!inner(user_id))')
        .eq('quote_items.quotes.user_id', currentUserId);
      return (data || []).map(mediaFromDb);
    }
    
    return [];
  } catch (e) {
    console.error('dbAll error:', store, e);
    return [];
  }
}

// ============ DATA TRANSFORMERS ============

function clientFromDb(d) {
  return {
    id: d.id,
    name: d.name,
    phone: d.phone,
    email: d.email,
    address: d.address,
    notes: d.notes,
    createdAt: d.created_at
  };
}

function clientToDb(c) {
  return {
    id: c.id,
    user_id: currentUserId,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    address: c.address || null,
    notes: c.notes || null,
    created_at: c.createdAt || new Date().toISOString()
  };
}

function businessFromDb(d) {
  return {
    name: d.name,
    phone: d.phone,
    email: d.email,
    address: d.address,
    id: d.business_id,
    website: d.website,
    terms: d.terms,
    validity: d.validity_days,
    logo: d.logo_url
  };
}

function quoteFromDb(q, items) {
  return {
    id: q.id,
    number: q.quote_number,
    clientId: q.client_id,
    status: q.status,
    items: items.map(itemFromDb),
    pricing: q.pricing || { 
      discount: q.discount_percent ? parseFloat(q.discount_percent) : 0, 
      install: q.install_fee ? parseFloat(q.install_fee) : 0, 
      vat: q.vat_percent ? parseFloat(q.vat_percent) : 18, 
      notes: q.notes || '' 
    },
    total: q.total ? parseFloat(q.total) : 0,
    createdAt: q.created_at,
    sentAt: q.sent_at,
    viewedAt: q.viewed_at,
    approvedAt: q.approved_at,
    productionAt: q.production_at,
    installedAt: q.installed_at,
    rejectedAt: q.rejected_at,
   publicToken: q.public_token || null,
    history: q.history || [],
    timeline: q.history || []  // 🛠️ FIX: גם timeline (תאימות לאחור)
  };
}

function quoteToDb(q) {
  const pricing = q.pricing || { discount: 0, install: 0, vat: 18, notes: '' };
  
  const quoteData = {
    id: q.id,
    user_id: currentUserId,
    client_id: q.clientId,
    quote_number: q.number,
    status: q.status || 'draft',
    pricing: pricing,
    discount_percent: pricing.discount || 0,
    install_fee: pricing.install || 0,
    vat_percent: pricing.vat || 18,
    notes: pricing.notes || '',
    total: q.total || 0,
    public_token: q.publicToken || null,
    history: q.history || q.timeline || [],  // 🛠️ FIX: timeline נשמר כ-history
    created_at: q.createdAt || new Date().toISOString(),
    sent_at: q.sentAt || null,
    viewed_at: q.viewedAt || null,
    approved_at: q.approvedAt || null,
    production_at: q.productionAt || null,
    installed_at: q.installedAt || null,
    rejected_at: q.rejectedAt || null
  };
  
  const items = (q.items || []).map((item, idx) => itemToDb(item, q.id, idx));
  
  return { quoteData, items };
}

function itemFromDb(i) {
  return {
    id: i.id,
    name: i.name,
    mode: i.pricing_mode,
    width: i.width_cm ? parseFloat(i.width_cm) : null,
    height: i.height_cm ? parseFloat(i.height_cm) : null,
    qty: parseInt(i.qty) || 1,
    price: i.price_per_unit ? parseFloat(i.price_per_unit) : null,
    pricePerSqm: i.price_per_sqm ? parseFloat(i.price_per_sqm) : null,
    minPrice: i.min_price ? parseFloat(i.min_price) : null,
  note: i.note || '',
    media: Array.isArray(i.media_ids) ? i.media_ids : [],
    profileId: i.profile_id || null,
    profileValue: i.profile_value || null
  };
}

function itemToDb(i, quoteId, position) {
  // חישוב total_price בסיסי
  let totalPrice = 0;
  if (i.mode === 'area' && i.width && i.height && i.pricePerSqm) {
    const sqm = (i.width * i.height) / 10000;
    totalPrice = sqm * i.pricePerSqm * (i.qty || 1);
    if (i.minPrice && totalPrice < i.minPrice * (i.qty || 1)) {
      totalPrice = i.minPrice * (i.qty || 1);
    }
  } else if (i.price) {
    totalPrice = i.price * (i.qty || 1);
  }
  
  return {
    id: i.id,
    quote_id: quoteId,
    position: position,
    name: i.name || 'פתח',
    pricing_mode: i.mode || 'fixed',
    width_cm: i.width ? Math.round(i.width) : null,
    height_cm: i.height ? Math.round(i.height) : null,
    qty: i.qty || 1,
    price_per_unit: i.price || null,
    price_per_sqm: i.pricePerSqm || null,
    min_price: i.minPrice || null,
    total_price: totalPrice,
  note: i.note || null,
    media_ids: Array.isArray(i.media) ? i.media : [],
    profile_id: i.profileId || null,
    profile_value: i.profileValue || null
  };
}

function mediaFromDb(m) {
  return {
    id: m.id,
    type: m.type,
    data: m.url, // ב-Supabase שומרים URL במקום base64
    duration: m.duration_sec,
    itemId: m.item_id
  };
}

function mediaToDb(m) {
  return {
    id: m.id,
    item_id: m.itemId || null,
    type: m.type,
    url: m.data, // יכול להיות URL או base64 (לתאימות)
    duration_sec: m.duration ? Math.round(m.duration) : null,
    size_bytes: m.size || null
  };
}

// ============ STORAGE HELPERS (Supabase Storage) ============

async function uploadFile(bucket, file, fileName) {
  if (!currentUserId) throw new Error('Not authenticated');
  
  const path = `${currentUserId}/${fileName}`;
  const { data, error } = await sb.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type
  });
  
  if (error) throw error;
  
  // קבלת URL ציבורי
  const { data: urlData } = sb.storage.from(bucket).getPublicUrl(path);
  return { url: urlData.publicUrl, path: data.path };
}

async function uploadDataUrl(bucket, dataUrl, fileName) {
  // המרה מ-base64 dataURL ל-Blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return uploadFile(bucket, blob, fileName);
}

// dbClear - מחיקת כל הנתונים של משתמש (לצורך ה-demo)
async function dbClear(store) {
  if (!currentUserId) return;
  try {
    if (store === 'clients') {
      await sb.from('clients').delete().eq('user_id', currentUserId);
    } else if (store === 'quotes') {
      await sb.from('quotes').delete().eq('user_id', currentUserId);
    } else if (store === 'media') {
      // נמחק רק media של המשתמש דרך quotes
      // הם יימחקו אוטומטית עם CASCADE כשנמחק quote
    } else if (store === 'settings') {
      // לא נמחק profile/business
    }
  } catch (e) { console.error('dbClear error:', store, e); }
}

// ============ STATE ============
let user = null;
let currentScreen = 'dashboard';
let currentQuote = null;
let currentItem = null;
let itemMode = 'fixed';
let currentItemMedia = [];
let pendingClientForQuote = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStart = 0;
let recordingTimer = null;
let quotesFilter = 'all';

// ============ UTIL ============
// מייצר UUID v4 (תואם Supabase)
function uid() { 
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback ל-uuid v4 ידני
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('he-IL', {year:'numeric',month:'2-digit',day:'2-digit'});
}

function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleString('he-IL', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return 'לפני רגע';
  if (diff < 3600) return `לפני ${Math.floor(diff/60)} דקות`;
  if (diff < 86400) return `לפני ${Math.floor(diff/3600)} שעות`;
  if (diff < 604800) return `לפני ${Math.floor(diff/86400)} ימים`;
  return formatDate(date);
}

function formatMoney(num) {
  return '₪ ' + Math.round(num).toLocaleString('he-IL');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function showModal(id) { 
  const el = document.getElementById(id);
  if (el) el.classList.add('show'); 
}
function closeModal(id) { 
  const el = document.getElementById(id);
  if (el) el.classList.remove('show'); 
}

function confirmAction(title, body, action) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-body').innerText = body;
  const btn = document.getElementById('confirm-action');
  btn.onclick = () => { action(); closeModal('modal-confirm'); };
  showModal('modal-confirm');
}

const STATUS_LABELS = {
  draft: 'טיוטה', sent: 'נשלחה', viewed: 'נצפתה',
  approved: 'אושרה', production: 'בייצור', installed: 'הותקנה', rejected: 'נדחתה'
};

const STATUS_FLOW = ['draft', 'sent', 'viewed', 'approved', 'production', 'installed'];

// ============ NAVIGATION ============
function goTo(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  window.scrollTo(0, 0);
}

function showScreen(name, btn) {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById('screen-' + name).style.display = 'block';
  document.querySelectorAll('[data-screen]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`[data-screen="${name}"]`).forEach(b => b.classList.add('active'));
  currentScreen = name;
  
  // החבאת sticky total bar בכל מעבר מסך
  const stickyEl = document.getElementById('quote-sticky-total');
  if (stickyEl && name !== 'quote-detail') {
    stickyEl.style.display = 'none';
  }
  
  if (name === 'dashboard') renderDashboard();
  else if (name === 'quotes') renderQuotes();
  else if (name === 'clients') renderClients();
  else if (name === 'business') loadBusiness();
  else if (name === 'upgrade') renderSubscriptionScreen();
  
  window.scrollTo(0, 0);
}

function toggleMobileMenu() {
  const d = document.getElementById('mobile-drawer');
  d.classList.toggle('show');
}

// ============ AUTH (Supabase) ============
async function doSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const business = document.getElementById('signup-business').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  
  if (!name || !email || !password) {
    showToast('נא למלא את כל השדות');
    return;
  }
  
  if (password.length < 6) {
    showToast('הסיסמה חייבת להיות באורך 6 תווים לפחות');
    return;
  }
  
  showToast('יוצר חשבון...');
  
  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { 
        data: { full_name: name, business_name: business || name }
      }
    });
    
    if (error) {
      if (error.message.includes('already registered')) {
        showToast('משתמש קיים - נסה להתחבר');
      } else {
        showToast('שגיאה: ' + error.message);
      }
      return;
    }
    
    if (!data.user) {
      showToast('שגיאה ביצירת המשתמש');
      return;
    }
    
    currentUserId = data.user.id;
    
    // ה-trigger ב-Supabase יצר אוטומטית profile + business
    // אבל ננסה upsert לוודא תאימות
    await sb.from('profiles').upsert({
      id: data.user.id,
      email: email,
      full_name: name,
      plan: 'free',
      trial_ends_at: new Date(Date.now() + 14*86400000).toISOString()
    }, { onConflict: 'id' });
    
    // עדכון business עם תוכן מורחב
    await sb.from('business').upsert({
      user_id: data.user.id,
      name: business || name,
      email: email,
      terms: 'ההצעה תקפה ל-30 יום ממועד הוצאתה. כל המחירים כוללים אחריות יצרן.',
      validity_days: 30
    }, { onConflict: 'user_id' });
    
    user = {
      id: data.user.id,
      email: email,
      name: name,
      plan: 'free',
      createdAt: new Date().toISOString()
    };
    
    enterApp();
    showToast('ברוך הבא! 🎉');
    
  } catch (e) {
    console.error('signup error:', e);
    showToast('שגיאה: ' + e.message);
  }
}
  async function showForgotPassword() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    alert('נא להכניס אימייל תחילה');
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  if (error) {
    alert('שגיאה: ' + error.message);
    return;
  }
  alert('קישור לאיפוס סיסמה נשלח לאימייל שלך');
}
async function doLogin() {

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password') ? document.getElementById('login-password').value : '';
  
  if (!email) { showToast('נא למלא אימייל'); return; }
  if (!password) { showToast('נא למלא סיסמה'); return; }
  
  showToast('מתחבר...');
  
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        showToast('אימייל או סיסמה לא נכונים');
      } else {
        showToast('שגיאה: ' + error.message);
      }
      return;
    }
    
    currentUserId = data.user.id;
    
    // טעינת profile
    const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
    
    if (profile) {
      user = {
        id: profile.id,
        email: profile.email,
        name: profile.full_name,
        plan: profile.plan,
        createdAt: profile.created_at
      };
    } else {
      // במקרה שאין profile - יוצרים אחד
      user = { id: data.user.id, email: email, name: email.split('@')[0], plan: 'free' };
      await sb.from('profiles').upsert({
        id: data.user.id, email: email, full_name: user.name, plan: 'free',
        trial_ends_at: new Date(Date.now() + 14*86400000).toISOString()
      });
    }
    
    enterApp();
    showToast('ברוך הבא! 👋');
    
  } catch (e) {
    console.error('login error:', e);
    showToast('שגיאה: ' + e.message);
  }
}

async function loginAsDemo() {
  // מצב הדגמה - יוצר משתמש חדש כל פעם או נכנס לקיים
  const demoEmail = 'demo-' + Math.random().toString(36).substr(2, 8) + '@alumcm.demo';
  const demoPassword = 'demo123456';
  
  showToast('יוצר חשבון הדגמה...');
  
  try {
    const { data, error } = await sb.auth.signUp({
      email: demoEmail,
      password: demoPassword,
      options: { 
        data: { full_name: 'יוסי המקצוען', business_name: 'יוסי אלומיניום' }
      }
    });
    
    if (error || !data.user) {
      showToast('שגיאה ביצירת מצב הדגמה');
      console.error(error);
      return;
    }
    
    currentUserId = data.user.id;
    
    await sb.from('profiles').upsert({
      id: data.user.id, email: demoEmail, full_name: 'יוסי המקצוען', plan: 'free',
      trial_ends_at: new Date(Date.now() + 14*86400000).toISOString()
    }, { onConflict: 'id' });
    
    await sb.from('business').upsert({
      user_id: data.user.id,
      name: 'יוסי אלומיניום',
      phone: '050-123-4567',
      email: demoEmail,
      address: 'התעשייה 12, ראשון לציון',
      business_id: '123456789',
      website: 'yossi-aluminum.co.il',
      terms: 'ההצעה תקפה ל-30 יום. אחריות 5 שנים על פרופילים, שנתיים על אביזרים. תשלום 30/70 — מקדמה בהזמנה, יתרה בהתקנה.',
      validity_days: 30
    }, { onConflict: 'user_id' });
    
    user = {
      id: data.user.id,
      email: demoEmail,
      name: 'יוסי המקצוען',
      plan: 'free',
      createdAt: new Date().toISOString()
    };
    
    await seedDemoData();
    
    enterApp();
    showToast('ברוך הבא למצב הדגמה');
    
  } catch (e) {
    console.error('demo error:', e);
    showToast('שגיאה: ' + e.message);
  }
}

async function seedDemoData() {
  // Demo clients
  const clients = [
    { id: uid(), name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com', address: 'הרצל 47, ראשון לציון', notes: 'לקוחה ממליצה — מומלצת ע״י משפחת לוי', createdAt: new Date(Date.now() - 7*86400000).toISOString() },
    { id: uid(), name: 'יוסי פרץ', phone: '054-9876543', email: '', address: 'בן גוריון 12, חולון', notes: '', createdAt: new Date(Date.now() - 5*86400000).toISOString() },
    { id: uid(), name: 'משפחת לוי', phone: '050-5556666', email: 'levi@example.com', address: 'החלוצים 8, רמת גן', notes: 'דירת 5 חדרים, רוצים לרענן את כל החלונות', createdAt: new Date(Date.now() - 14*86400000).toISOString() },
    { id: uid(), name: 'רחל אברהם', phone: '053-1112222', email: '', address: 'סוקולוב 25, פתח תקוה', notes: '', createdAt: new Date(Date.now() - 30*86400000).toISOString() }
  ];
  
  for (const c of clients) await dbPut('clients', c);
  
  // Demo quotes
  const business = (await dbGet('settings', 'business')).value;
  
  const quotes = [
    {
      id: uid(),
      number: '2026-127',
      clientId: clients[0].id,
      status: 'viewed',
      createdAt: new Date(Date.now() - 7*86400000).toISOString(),
      sentAt: new Date(Date.now() - 6*86400000).toISOString(),
      viewedAt: new Date(Date.now() - 5*3600000).toISOString(),
      items: [
        { id: uid(), name: 'חלון סלון', mode: 'area', width: 180, height: 120, qty: 1, pricePerSqm: 2000, price: 4320, note: 'זכוכית טריפלקס, פרופיל אפור 7000', media: [] },
        { id: uid(), name: 'חלון מטבח', mode: 'area', width: 90, height: 120, qty: 1, pricePerSqm: 2000, price: 2160, note: '', media: [] },
        { id: uid(), name: 'דלת מרפסת', mode: 'area', width: 200, height: 210, qty: 1, pricePerSqm: 1300, price: 5460, note: 'דלת הזזה דו-כיוונית', media: [] }
      ],
      pricing: { discount: 0, install: 800, vat: 18, notes: 'מחיר כולל פירוק חלונות ישנים' },
      timeline: [
        { status: 'draft', at: new Date(Date.now() - 7*86400000).toISOString() },
        { status: 'sent', at: new Date(Date.now() - 6*86400000).toISOString(), via: 'WhatsApp' },
        { status: 'viewed', at: new Date(Date.now() - 5*3600000).toISOString(), views: 3 }
      ]
    },
    {
      id: uid(),
      number: '2026-126',
      clientId: clients[1].id,
      status: 'sent',
      createdAt: new Date(Date.now() - 2*86400000).toISOString(),
      sentAt: new Date(Date.now() - 86400000).toISOString(),
      items: [
        { id: uid(), name: 'חלון חדר שינה', mode: 'fixed', qty: 2, price: 2400, note: '', media: [] },
        { id: uid(), name: 'רשת נגד יתושים', mode: 'fixed', qty: 1, price: 1000, note: '', media: [] }
      ],
      pricing: { discount: 0, install: 0, vat: 18, notes: '' },
      timeline: [
        { status: 'draft', at: new Date(Date.now() - 2*86400000).toISOString() },
        { status: 'sent', at: new Date(Date.now() - 86400000).toISOString(), via: 'WhatsApp' }
      ]
    },
    {
      id: uid(),
      number: '2026-125',
      clientId: clients[2].id,
      status: 'approved',
      createdAt: new Date(Date.now() - 14*86400000).toISOString(),
      sentAt: new Date(Date.now() - 13*86400000).toISOString(),
      viewedAt: new Date(Date.now() - 12*86400000).toISOString(),
      approvedAt: new Date(Date.now() - 2*86400000).toISOString(),
      items: [
        { id: uid(), name: 'חלון סלון', mode: 'area', width: 220, height: 140, qty: 1, pricePerSqm: 2200, price: 6776, note: '', media: [] },
        { id: uid(), name: 'חלון מטבח', mode: 'area', width: 100, height: 120, qty: 1, pricePerSqm: 2200, price: 2640, note: '', media: [] },
        { id: uid(), name: 'חלון חדר שינה', mode: 'area', width: 150, height: 120, qty: 2, pricePerSqm: 2200, price: 3960, note: '', media: [] },
        { id: uid(), name: 'חלון אמבטיה', mode: 'area', width: 60, height: 60, qty: 1, pricePerSqm: 2500, price: 900, note: 'זכוכית מט', media: [] },
        { id: uid(), name: 'דלת מרפסת', mode: 'area', width: 200, height: 210, qty: 1, pricePerSqm: 1400, price: 5880, note: '', media: [] },
        { id: uid(), name: 'תריס חיצוני', mode: 'fixed', qty: 4, price: 1800, note: 'חשמלי', media: [] }
      ],
      pricing: { discount: 5, install: 1500, vat: 18, notes: 'אחריות מלאה ל-5 שנים. תשלום: 30% מקדמה, 70% בהתקנה' },
      timeline: [
        { status: 'draft', at: new Date(Date.now() - 14*86400000).toISOString() },
        { status: 'sent', at: new Date(Date.now() - 13*86400000).toISOString(), via: 'WhatsApp' },
        { status: 'viewed', at: new Date(Date.now() - 12*86400000).toISOString(), views: 5 },
        { status: 'approved', at: new Date(Date.now() - 2*86400000).toISOString() }
      ]
    },
    {
      id: uid(),
      number: '2026-110',
      clientId: clients[3].id,
      status: 'installed',
      createdAt: new Date(Date.now() - 30*86400000).toISOString(),
      sentAt: new Date(Date.now() - 29*86400000).toISOString(),
      viewedAt: new Date(Date.now() - 28*86400000).toISOString(),
      approvedAt: new Date(Date.now() - 25*86400000).toISOString(),
      installedAt: new Date(Date.now() - 7*86400000).toISOString(),
      items: [
        { id: uid(), name: 'חלון סלון', mode: 'area', width: 180, height: 130, qty: 1, pricePerSqm: 2100, price: 4914, note: '', media: [] },
        { id: uid(), name: 'חלון חדר שינה', mode: 'area', width: 140, height: 110, qty: 2, pricePerSqm: 2100, price: 3234, note: '', media: [] }
      ],
      pricing: { discount: 0, install: 600, vat: 18, notes: '' },
      timeline: [
        { status: 'draft', at: new Date(Date.now() - 30*86400000).toISOString() },
        { status: 'sent', at: new Date(Date.now() - 29*86400000).toISOString(), via: 'Email' },
        { status: 'viewed', at: new Date(Date.now() - 28*86400000).toISOString(), views: 2 },
        { status: 'approved', at: new Date(Date.now() - 25*86400000).toISOString() },
        { status: 'production', at: new Date(Date.now() - 20*86400000).toISOString() },
        { status: 'installed', at: new Date(Date.now() - 7*86400000).toISOString() }
      ]
    }
  ];
  
  for (const q of quotes) await dbPut('quotes', q);
}

async function logout() {
  if (currentScreen === 'business') saveBusiness();
  
  try {
    await sb.auth.signOut();
  } catch(e) { console.error('logout error:', e); }
  
  user = null;
  currentUserId = null;
  goTo('landing');
}

// ============ THEME (Light / Dark Mode) ============
function toggleTheme() {
  const isDark = document.getElementById('theme-toggle').checked;
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  // שמירה ב-localStorage כדי שהבחירה תישמר
  try {
    localStorage.setItem('alumcm-theme', isDark ? 'dark' : 'light');
  } catch (e) {}
}

function loadTheme() {
  try {
    const saved = localStorage.getItem('alumcm-theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      const toggle = document.getElementById('theme-toggle');
      if (toggle) toggle.checked = true;
    }
  } catch (e) {}
}

function enterApp() {
  goTo('app');
  document.getElementById('user-name').innerText = user.name;
  document.getElementById('user-avatar').innerText = user.name[0];
  const planEl = document.getElementById('user-plan');
if (planEl) {
  if (user.plan === 'pro_annual') planEl.innerHTML = '⭐ Pro שנתי';
  else if (user.plan === 'pro_monthly') planEl.innerHTML = '⭐ Pro חודשי';
  else planEl.innerHTML = 'חינם <span class="upgrade-pill">שדרג</span>';
}
  // ברכה דינמית לפי שעה ביום
  const hour = new Date().getHours();
  let greeting = 'שלום';
  if (hour >= 5 && hour < 12) greeting = 'בוקר טוב';
  else if (hour >= 12 && hour < 17) greeting = 'צהריים טובים';
  else if (hour >= 17 && hour < 21) greeting = 'ערב טוב';
  else greeting = 'לילה טוב';
  
  const firstName = user.name.split(' ')[0];
  document.getElementById('welcome-msg').innerHTML = 
    `${greeting}, <span class="greeting-name">${escapeHTML(firstName)}</span>`;
  
  showScreen('dashboard', document.querySelector('[data-screen="dashboard"]'));
}

// ============ BUSINESS ============
async function loadBusiness() {
  const b = await dbGet('settings', 'business');
  if (!b) return;
  const v = b.value;
  document.getElementById('business-name').value = v.name || '';
  document.getElementById('business-phone').value = v.phone || '';
  document.getElementById('business-email').value = v.email || '';
  document.getElementById('business-address').value = v.address || '';
  document.getElementById('business-id').value = v.id || '';
  document.getElementById('business-website').value = v.website || '';
  document.getElementById('business-terms').value = v.terms || '';
  document.getElementById('business-validity').value = v.validity || 30;
  
  const logoEl = document.getElementById('logo-upload-content');
  if (v.logo) {
    logoEl.innerHTML = `<img src="${v.logo}" alt="logo">`;
  } else {
    logoEl.innerHTML = '+';
  }
  
  // סנכרון מצב הטוגל של ה-theme
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.checked = document.documentElement.getAttribute('data-theme') === 'dark';
  }
}

async function saveBusiness() {
  const b = await dbGet('settings', 'business');
  const v = b ? b.value : {};
  v.name = document.getElementById('business-name').value;
  v.phone = document.getElementById('business-phone').value;
  v.email = document.getElementById('business-email').value;
  v.address = document.getElementById('business-address').value;
  v.id = document.getElementById('business-id').value;
  v.website = document.getElementById('business-website').value;
  v.terms = document.getElementById('business-terms').value;
  v.validity = parseInt(document.getElementById('business-validity').value) || 30;
  await dbPut('settings', { key: 'business', value: v });
}

function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // הצגת preview מיידי
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('logo-upload-content').innerHTML = `<img src="${e.target.result}" alt="logo">`;
  };
  reader.readAsDataURL(file);
  
  // העלאה ל-Supabase Storage
  showToast('מעלה לוגו...');
  (async () => {
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const fileName = `logo-${Date.now()}.${ext}`;
      const { url } = await uploadFile('logos', file, fileName);
      
      // שמירה ב-business
      const b = await dbGet('settings', 'business');
      const v = b ? b.value : {};
      v.logo = url;
      await dbPut('settings', { key: 'business', value: v });
      
      showToast('הלוגו נשמר ✓');
    } catch (e) {
      console.error('logo upload error:', e);
      showToast('שגיאה בהעלאת הלוגו: ' + e.message);
    }
  })();
}

// ============ DASHBOARD ============
async function renderDashboard() {
  const quotes = await dbAll('quotes');
  const clients = await dbAll('clients');
  
  // Stats
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  
  const thisMonth = quotes.filter(q => new Date(q.createdAt) >= monthStart);
  const lastMonth = quotes.filter(q => {
    const d = new Date(q.createdAt);
    return d >= lastMonthStart && d <= lastMonthEnd;
  });
  
  document.getElementById('stat-month').innerText = thisMonth.length;
  
  if (lastMonth.length > 0) {
    const change = Math.round(((thisMonth.length - lastMonth.length) / lastMonth.length) * 100);
    const trendEl = document.getElementById('stat-month-trend');
    trendEl.innerText = (change >= 0 ? '+' : '') + change + '% מהחודש שעבר';
    trendEl.className = 'stat-trend' + (change >= 0 ? '' : ' warning');
  }
  
  const active = quotes.filter(q => ['sent','viewed'].includes(q.status));
  document.getElementById('stat-active').innerText = active.length;
  if (active.length > 0) {
    document.getElementById('stat-active-trend').innerText = active.length + ' ממתינות לתגובה';
  }
  
  const projected = active.reduce((sum, q) => sum + calcQuoteTotal(q), 0);
  document.getElementById('stat-revenue').innerText = formatMoney(projected);
  
  // חישוב סטטוסים לדונאט
  const totalQuotes = quotes.length;
  document.getElementById('donut-total').innerText = totalQuotes;
  
  const greenCount = quotes.filter(q => q.status === 'installed').length;
  const blueCount = quotes.filter(q => ['sent','viewed'].includes(q.status)).length;
  const orangeCount = quotes.filter(q => ['approved','production'].includes(q.status)).length;
  const yellowCount = quotes.filter(q => q.status === 'draft').length;
  
  const circumference = 238.76; // 2 * π * 38
  
  function setSegment(elementId, count, total, offset) {
    const el = document.getElementById(elementId);
    if (!el) return 0;
    if (total === 0 || count === 0) {
      el.setAttribute('stroke-dasharray', `0 ${circumference}`);
      el.setAttribute('stroke-dashoffset', '0');
      return 0;
    }
    const length = (count / total) * circumference;
    const gap = circumference - length;
    el.setAttribute('stroke-dasharray', `${length} ${gap}`);
    el.setAttribute('stroke-dashoffset', `${-offset}`);
    return length;
  }
  
  let runningOffset = 0;
  runningOffset += setSegment('donut-green', greenCount, totalQuotes, runningOffset);
  runningOffset += setSegment('donut-blue', blueCount, totalQuotes, runningOffset);
  runningOffset += setSegment('donut-orange', orangeCount, totalQuotes, runningOffset);
  runningOffset += setSegment('donut-yellow', yellowCount, totalQuotes, runningOffset);
  
  // Recent quotes
  const recent = quotes.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const list = document.getElementById('dashboard-quotes-list');
  
  if (recent.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">עדיין אין הצעות מחיר</div>
      <div class="empty-text">צור את ההצעה הראשונה שלך — תהליך מהיר של דקות.</div>
      <button class="btn btn-accent" onclick="newQuote()">+ הצעה חדשה</button>
    </div>`;
  } else {
    list.innerHTML = recent.map(q => {
      const client = clients.find(c => c.id === q.clientId);
      const total = calcQuoteTotal(q);
      return `
        <div class="list-item" onclick="openQuote('${q.id}')">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHTML(client?.name || 'לקוח')}</div>
            <div class="list-item-meta">
              <span>הצעה #${q.number}</span>
              <span>·</span>
              <span>${q.items.length} פריטים</span>
              <span>·</span>
              <span>${timeAgo(q.createdAt)}</span>
            </div>
          </div>
          <div style="text-align:left;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div class="list-item-amount">${formatMoney(total)}</div>
            <span class="status-pill status-${q.status}">${STATUS_LABELS[q.status]}</span>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Sidebar badge
  document.getElementById('badge-quotes').innerText = quotes.length;
}

// ============ QUOTES LIST ============
function setQuotesFilter(filter, btn) {
  quotesFilter = filter;
  document.querySelectorAll('#quotes-filters .filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  renderQuotes();
}

async function renderQuotes() {
  const quotes = await dbAll('quotes');
  const clients = await dbAll('clients');
  const search = document.getElementById('quotes-search').value.toLowerCase();
  
  let filtered = quotes.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (quotesFilter !== 'all') {
    filtered = filtered.filter(q => q.status === quotesFilter);
  }
  
  if (search) {
    filtered = filtered.filter(q => {
      const c = clients.find(c => c.id === q.clientId);
      return (c?.name || '').toLowerCase().includes(search) ||
             q.number.toLowerCase().includes(search);
    });
  }
  
  document.getElementById('quotes-count').innerText = `${filtered.length} מתוך ${quotes.length} הצעות`;
  
  const list = document.getElementById('quotes-list');
  
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">${search || quotesFilter !== 'all' ? 'אין תוצאות' : 'עדיין אין הצעות'}</div>
      <div class="empty-text">${search ? 'נסה חיפוש אחר' : 'צור הצעה חדשה כדי להתחיל'}</div>
    </div>`;
  } else {
    list.innerHTML = filtered.map(q => {
      const client = clients.find(c => c.id === q.clientId);
      const total = calcQuoteTotal(q);
      return `
        <div class="list-item" onclick="openQuote('${q.id}')">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHTML(client?.name || 'לקוח')}</div>
            <div class="list-item-meta">
              <span>#${q.number}</span>
              <span>·</span>
              <span>${q.items.length} פריטים</span>
              <span>·</span>
              <span>${formatDate(q.createdAt)}</span>
            </div>
          </div>
          <div style="text-align:left;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div class="list-item-amount">${formatMoney(total)}</div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="status-pill status-${q.status}">${STATUS_LABELS[q.status]}</span>
              <button class="quote-quick-action" onclick="event.stopPropagation();duplicateQuoteById('${q.id}')" title="שכפל הצעה">⎘</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ============ CLIENTS LIST ============
async function renderClients() {
  const clients = (await dbAll('clients')).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const quotes = await dbAll('quotes');
  const search = document.getElementById('clients-search').value.toLowerCase();
  
  const filtered = search 
    ? clients.filter(c => c.name.toLowerCase().includes(search) || (c.phone||'').includes(search))
    : clients;
  
  document.getElementById('clients-count').innerText = `${clients.length} לקוחות`;
  
  const list = document.getElementById('clients-list');
  
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">👥</div>
      <div class="empty-title">${search ? 'אין תוצאות' : 'עדיין אין לקוחות'}</div>
      <div class="empty-text">${search ? 'נסה חיפוש אחר' : 'הוסף לקוח חדש כדי להתחיל'}</div>
      ${!search ? '<button class="btn btn-accent" onclick="newClient()">+ לקוח חדש</button>' : ''}
    </div>`;
  } else {
    list.innerHTML = filtered.map(c => {
      const cQuotes = quotes.filter(q => q.clientId === c.id);
      const totalRevenue = cQuotes.filter(q => ['approved','production','installed'].includes(q.status))
        .reduce((s, q) => s + calcQuoteTotal(q), 0);
      return `
        <div class="list-item" onclick="editClient('${c.id}')">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHTML(c.name)}</div>
            <div class="list-item-meta">
              ${c.phone ? `<span>${escapeHTML(c.phone)}</span><span>·</span>` : ''}
              <span>${cQuotes.length} הצעות</span>
              ${totalRevenue > 0 ? `<span>·</span><span>${formatMoney(totalRevenue)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ============ CLIENT MODAL ============
let editingClientId = null;

function newClient() {
  editingClientId = null;
  document.getElementById('modal-client-title').innerText = 'לקוח חדש';
  document.getElementById('client-name').value = '';
  document.getElementById('client-phone').value = '';
  document.getElementById('client-email').value = '';
  document.getElementById('client-address').value = '';
  document.getElementById('client-notes').value = '';
  document.getElementById('modal-client-save').onclick = saveClient;
  showModal('modal-client');
  setTimeout(() => document.getElementById('client-name').focus(), 100);
}

async function editClient(id) {
  const c = await dbGet('clients', id);
  editingClientId = id;
  document.getElementById('modal-client-title').innerText = 'עריכת לקוח';
  document.getElementById('client-name').value = c.name || '';
  document.getElementById('client-phone').value = c.phone || '';
  document.getElementById('client-email').value = c.email || '';
  document.getElementById('client-address').value = c.address || '';
  document.getElementById('client-notes').value = c.notes || '';
  document.getElementById('modal-client-save').onclick = saveClient;
  showModal('modal-client');
}

async function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  if (!name) { showToast('חובה להזין שם'); return; }
  
  const client = {
    id: editingClientId || uid(),
    name,
    phone: document.getElementById('client-phone').value.trim(),
    email: document.getElementById('client-email').value.trim(),
    address: document.getElementById('client-address').value.trim(),
    notes: document.getElementById('client-notes').value.trim(),
    createdAt: editingClientId ? (await dbGet('clients', editingClientId)).createdAt : new Date().toISOString()
  };
  
  await dbPut('clients', client);
  closeModal('modal-client');
  showToast(editingClientId ? 'הלקוח עודכן' : 'הלקוח נוצר');
  
  if (currentScreen === 'clients') renderClients();
  
  if (pendingClientForQuote) {
    pendingClientForQuote = null;
    await createQuote(client.id);
  }
}

// ============ NEW QUOTE FLOW ============
async function newQuote() {
  // Check free plan limit
  if (user.plan === 'free') {
    const quotes = await dbAll('quotes');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0,0,0,0);
    const thisMonth = quotes.filter(q => new Date(q.createdAt) >= monthStart);
    if (thisMonth.length >= 5) {
      confirmAction('הגעת למגבלת החינם', 'יצרת כבר 5 הצעות החודש. שדרג ל-Pro כדי להמשיך ללא הגבלה.', () => {
        showScreen('upgrade', document.querySelector('[data-screen="upgrade"]'));
      });
      return;
    }
  }
  
  const clients = (await dbAll('clients')).sort((a,b) => a.name.localeCompare(b.name));
  const select = document.getElementById('new-quote-client-select');
  select.innerHTML = '<option value="">— בחר —</option>' + 
    clients.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  showModal('modal-new-quote');
}

function newClientThenQuote() {
  closeModal('modal-new-quote');
  pendingClientForQuote = true;
  newClient();
}

async function createQuoteFromSelected() {
  const id = document.getElementById('new-quote-client-select').value;
  if (!id) { showToast('בחר לקוח או צור חדש'); return; }
  closeModal('modal-new-quote');
  await createQuote(id);
}

async function createQuote(clientId) {
  const quotes = await dbAll('quotes');
  const year = new Date().getFullYear();
  const yearQuotes = quotes.filter(q => q.number.startsWith(year + '-'));
  const nextNum = Math.max(
  0,
  ...yearQuotes.map(q => parseInt(q.number.split('-')[1]) || 0)
) + 1;
  
  const quote = {
    id: uid(),
    number: `${year}-${String(nextNum).padStart(3, '0')}`,
    clientId,
    status: 'draft',
    createdAt: new Date().toISOString(),
    items: [],
    pricing: { discount: 0, install: 0, vat: 18, notes: '' },
    timeline: [{ status: 'draft', at: new Date().toISOString() }],
    history: [{ status: 'draft', at: new Date().toISOString() }]
  };
  
  await dbPut('quotes', quote);
  openQuote(quote.id);
}

// ============ QUOTE DETAIL ============
async function openQuote(id) {
  currentQuote = await dbGet('quotes', id);
  showScreen('quote-detail', null);
  renderQuoteDetail();
}

async function renderQuoteDetail() {
  if (!currentQuote) return;
  const client = await dbGet('clients', currentQuote.clientId);
  const business = (await dbGet('settings', 'business'))?.value || {};
  
  // Restore media for items
  for (const item of currentQuote.items) {
    if (!item.media) item.media = [];
  }
  
  const subtotal = currentQuote.items.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
  const discountAmt = subtotal * ((currentQuote.pricing.discount || 0) / 100);
  const afterDiscount = subtotal - discountAmt;
  const beforeVat = afterDiscount + (currentQuote.pricing.install || 0);
  const vatAmt = beforeVat * ((currentQuote.pricing.vat || 0) / 100);
  const total = beforeVat + vatAmt;
  
  const c = document.getElementById('quote-detail-content');
  
  const isEditable = ['draft'].includes(currentQuote.status);
  
  c.innerHTML = `
    <div class="main-header">
      <div>
        <h1 class="main-title">הצעה #${currentQuote.number}</h1>
        <div class="main-subtitle">
          <span class="status-pill status-${currentQuote.status}">${STATUS_LABELS[currentQuote.status]}</span>
          · ${escapeHTML(client?.name || 'לקוח')} · ${formatDate(currentQuote.createdAt)}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap" class="quote-actions">
       ${currentQuote.status === 'draft' ? `<button class="btn btn-accent" onclick="sendQuoteEmail()">📤 שלח ללקוח</button>` : ''}
        ${currentQuote.status === 'sent' || currentQuote.status === 'viewed' ? `<button class="btn btn-accent" onclick="markAsApproved()">✓ סמן כאושר</button>` : ''}
        ${currentQuote.status === 'approved' ? `<button class="btn btn-accent" onclick="markAsProduction()">→ העבר לייצור</button>` : ''}
        ${currentQuote.status === 'production' ? `<button class="btn btn-accent" onclick="markAsInstalled()">✓ סמן כהותקן</button>` : ''}
        ${['approved','production','installed'].includes(currentQuote.status) ? `<button class="btn btn-pro" onclick="openWorkOrder()">📄 דף ביצוע למפעל ${user.plan === 'free' ? '⭐' : ''}</button>` : ''}
        ${currentQuote.status !== 'draft' ? `<button class="btn" onclick="reopenForEdit()">✏️ פתח לעריכה</button>` : ''}
        <button class="btn" onclick="duplicateQuote()">⎘ שכפל הצעה</button>
        <button class="btn" onclick="openStatusEditor()">⚙ תקן סטטוס</button>
        <button class="btn" onclick="window.print()">🖨 הדפס הצעה</button>
       
     <button class="btn" onclick="shareWhatsAppPDF()" style="background:#25D366;border:1px solid #25D366;color:#fff !important;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;padding:10px 16px;min-width:140px;white-space:nowrap;">שלח וואצאפ</button>
        <button class="btn" onclick="sendQuoteEmail()">📧 שלח במייל</button>
        <button class="btn" onclick="downloadQuotePDF()">⬇ הורד PDF</button>
        <button class="btn" onclick="deleteQuote()">🗑 מחק</button>
      </div>
    </div>
    
    <div style="display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start" class="quote-grid">
      <div>
        ${isEditable ? `
       <div class="card-section">
          <div class="card-section-header">
            <div class="card-section-title">פריטים (${currentQuote.items.length})</div>
            <button class="card-section-action" onclick="newItem()">+ פתח חדש</button>
          </div>
          <div style="padding:16px">
            ${currentQuote.items.length === 0 ? '' : currentQuote.items.map((item, i) => renderItemCard(item, i)).join('')}
            
            <div class="${currentQuote.items.length === 0 ? 'empty-state' : ''}" style="padding:${currentQuote.items.length === 0 ? '30px' : '20px 0 0'}">
              ${currentQuote.items.length === 0 ? '<div class="empty-text">עדיין לא נוספו פתחים</div>' : '<div style="font-size:13px;color:var(--steel);text-align:center;margin-bottom:12px;font-weight:600">+ הוסף פתח חדש</div>'}
              <div class="template-grid" style="margin-top:${currentQuote.items.length === 0 ? '16px' : '0'};max-width:600px;margin-left:auto;margin-right:auto">
                <div class="template-btn" onclick="newItemTemplate('חלון הזזה', 'area', {width:120, height:100})">
                  <div class="template-icon">🪟</div>
                  <div class="template-name">חלון הזזה</div>
                  <div class="template-meta">120×100 ס״מ</div>
                </div>
                <div class="template-btn" onclick="newItemTemplate('חלון סלון', 'area', {width:240, height:160})">
                  <div class="template-icon">🪟</div>
                  <div class="template-name">חלון סלון</div>
                  <div class="template-meta">240×160 ס״מ</div>
                </div>
                <div class="template-btn" onclick="newItemTemplate('דלת מרפסת', 'area', {width:200, height:210})">
                  <div class="template-icon">🚪</div>
                  <div class="template-name">דלת מרפסת</div>
                  <div class="template-meta">200×210 ס״מ</div>
                </div>
                <div class="template-btn" onclick="newItemTemplate('רשת נגד יתושים', 'area', {width:120, height:100})">
                  <div class="template-icon">🦟</div>
                  <div class="template-name">רשת</div>
                  <div class="template-meta">לפי מ״ר</div>
                </div>
                <div class="template-btn" onclick="newItemTemplate('תריס גלילה', 'area', {width:120, height:140})">
                  <div class="template-icon">🌅</div>
                  <div class="template-name">תריס גלילה</div>
                  <div class="template-meta">חשמלי / ידני</div>
                </div>
                <div class="template-btn" onclick="newItemTemplate('פתח אחר', 'fixed')">
                  <div class="template-icon">＋</div>
                  <div class="template-name">פתח אחר</div>
                  <div class="template-meta">מותאם אישית</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="card-section">
          <div class="card-section-header">
            <div class="card-section-title">חישובים</div>
            <button class="card-section-action" onclick="openPricingModal()">⚙ פירוט</button>
          </div>
          <div style="padding:16px 24px">
            <div class="quote-doc-total-row"><span>סכום ביניים</span><span>${formatMoney(subtotal)}</span></div>
            
            <div class="quick-pricing-row">
              <label class="quick-pricing-label">הנחה</label>
              <div class="quick-pricing-input-wrap">
                <input type="number" min="0" max="100" class="quick-pricing-input" 
                  value="${currentQuote.pricing.discount || 0}" 
                  onchange="updatePricingField('discount', this.value)"
                  onclick="this.select()">
                <span class="quick-pricing-suffix">%</span>
              </div>
              <span class="quick-pricing-result">${currentQuote.pricing.discount > 0 ? '-' + formatMoney(discountAmt) : '—'}</span>
            </div>
            
            <div class="quick-pricing-row">
              <label class="quick-pricing-label">התקנה / משלוח</label>
              <div class="quick-pricing-input-wrap">
                <span class="quick-pricing-prefix">₪</span>
                <input type="number" min="0" class="quick-pricing-input" 
                  value="${currentQuote.pricing.install || 0}" 
                  onchange="updatePricingField('install', this.value)"
                  onclick="this.select()">
              </div>
              <span class="quick-pricing-result">${currentQuote.pricing.install > 0 ? '+' + formatMoney(currentQuote.pricing.install) : '—'}</span>
            </div>
            
            ${currentQuote.pricing.vat > 0 ? `<div class="quote-doc-total-row" style="margin-top:8px"><span>מע״מ (${currentQuote.pricing.vat}%)</span><span>${formatMoney(vatAmt)}</span></div>` : ''}
            
            <div class="quote-doc-grand">
              <div class="quote-doc-grand-label">סה״כ לתשלום</div>
              <div class="quote-doc-grand-val">${formatMoney(total)}</div>
            </div>
          </div>
        </div>
        ` : `
        <div class="card-section">
          ${renderQuoteDoc(currentQuote, client, business, subtotal, discountAmt, beforeVat, vatAmt, total)}
        </div>
        `}
      </div>
      
      <div>
        <div class="card-section">
          <div class="card-section-header">
            <div class="card-section-title">סטטוס</div>
          </div>
          <div style="padding:8px 16px">
            ${renderTimeline()}
          </div>
        </div>
        
        <div class="card-section">
          <div class="card-section-header">
            <div class="card-section-title">לקוח</div>
            <button class="card-section-action" onclick="editClient('${client?.id}')">ערוך</button>
          </div>
          <div style="padding:16px">
            <div style="font-weight:600;font-size:16px">${escapeHTML(client?.name || '')}</div>
            ${client?.phone ? `<div style="font-size:13px;margin-top:6px">📞 ${escapeHTML(client.phone)}</div>` : ''}
            ${client?.email ? `<div style="font-size:13px;margin-top:4px">✉ ${escapeHTML(client.email)}</div>` : ''}
            ${client?.address ? `<div style="font-size:13px;color:var(--steel);margin-top:4px">📍 ${escapeHTML(client.address)}</div>` : ''}
            ${client?.notes ? `<div style="font-size:12px;color:var(--steel);margin-top:10px;padding-top:10px;border-top:1px solid var(--line-soft)">${escapeHTML(client.notes)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
    
    <style>
      @media (max-width: 900px) {
        .quote-grid { grid-template-columns: 1fr !important; }
      }
    </style>
  `;
  
  // עדכון Sticky Total Bar
  const stickyEl = document.getElementById('quote-sticky-total');
  const stickyAmount = document.getElementById('sticky-total-amount');
  const stickyMeta = document.getElementById('sticky-total-meta');
  const screenEl = document.getElementById('screen-quote-detail');
  
  if (currentQuote.items.length > 0) {
    stickyEl.style.display = 'flex';
    stickyAmount.innerText = formatMoney(total);
    
    const totalUnits = currentQuote.items.reduce((s, i) => s + (i.qty || 1), 0);
    const itemsCount = currentQuote.items.length;
    let metaText = `${itemsCount} פריט${itemsCount > 1 ? 'ים' : ''}`;
    if (totalUnits !== itemsCount) {
      metaText += ` · ${totalUnits} יחידות`;
    }
    stickyMeta.innerText = metaText;
    screenEl.classList.add('has-sticky');
  } else {
    stickyEl.style.display = 'none';
    screenEl.classList.remove('has-sticky');
  }
}

/**
 * יצירת SVG ויזואלי של פתח אלומיניום
 * סגנון שרטוט הנדסי מקצועי
 */
function renderWindowSVG(width, height, name = '') {
  if (!width || !height) {
    return `<svg viewBox="0 0 80 80" class="window-svg-empty" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="14" y="14" width="52" height="52" rx="0.5"/>
      <line x1="40" y1="14" x2="40" y2="66"/>
      <line x1="14" y1="40" x2="66" y2="40"/>
    </svg>`;
  }
  
  const ratio = width / height;
  const maxDim = 70;
  let svgW, svgH;
  
  if (ratio >= 1) {
    svgW = maxDim;
    svgH = maxDim / ratio;
  } else {
    svgH = maxDim;
    svgW = maxDim * ratio;
  }
  
  const padX = 18;
  const padY = 14;
  const totalW = svgW + padX * 2;
  const totalH = svgH + padY * 2;
  
  const hasTwoWings = width >= 150;
  const hasTopPanel = height >= 220 && width >= 100;
  
  const startX = padX;
  const startY = padY;
  const endX = startX + svgW;
  const endY = startY + svgH;
  
  let topY = startY;
  let bottomY = endY;
  let middleStartY = startY;
  let middleEndY = endY;
  
  if (hasTopPanel) {
    topY = startY + svgH * 0.18;
    bottomY = endY - svgH * 0.22;
    middleStartY = topY;
    middleEndY = bottomY;
  }
  
  const middleX = startX + svgW / 2;
  const stroke = "#0a1628";
  
  let panels = '';
  
  // מסגרת חיצונית - דקה
  panels += `<rect x="${startX}" y="${startY}" width="${svgW}" height="${svgH}" stroke="${stroke}" stroke-width="0.9" fill="rgba(74,107,138,0.03)" rx="0.3"/>`;
  
  // מסגרת פנימית עדינה (פאנל זכוכית)
  panels += `<rect x="${startX + 1.2}" y="${startY + 1.2}" width="${svgW - 2.4}" height="${svgH - 2.4}" stroke="${stroke}" stroke-width="0.3" fill="none" opacity="0.4"/>`;
  
  if (hasTopPanel) {
    panels += `<line x1="${startX}" y1="${topY}" x2="${endX}" y2="${topY}" stroke="${stroke}" stroke-width="0.7"/>`;
    panels += `<line x1="${startX}" y1="${bottomY}" x2="${endX}" y2="${bottomY}" stroke="${stroke}" stroke-width="0.7"/>`;
  }
  
  if (hasTwoWings) {
    panels += `<line x1="${middleX}" y1="${middleStartY}" x2="${middleX}" y2="${middleEndY}" stroke="${stroke}" stroke-width="0.7"/>`;
    
    // אלכסונים דקיקים מקווקווים
    panels += `<line x1="${startX + 1.5}" y1="${middleStartY + 1.5}" x2="${middleX - 1.5}" y2="${middleEndY - 1.5}" stroke="${stroke}" stroke-width="0.35" stroke-dasharray="1.5,1" opacity="0.5"/>`;
    panels += `<line x1="${middleX - 1.5}" y1="${middleStartY + 1.5}" x2="${startX + 1.5}" y2="${middleEndY - 1.5}" stroke="${stroke}" stroke-width="0.35" stroke-dasharray="1.5,1" opacity="0.5"/>`;
    panels += `<line x1="${middleX + 1.5}" y1="${middleStartY + 1.5}" x2="${endX - 1.5}" y2="${middleEndY - 1.5}" stroke="${stroke}" stroke-width="0.35" stroke-dasharray="1.5,1" opacity="0.5"/>`;
    panels += `<line x1="${endX - 1.5}" y1="${middleStartY + 1.5}" x2="${middleX + 1.5}" y2="${middleEndY - 1.5}" stroke="${stroke}" stroke-width="0.35" stroke-dasharray="1.5,1" opacity="0.5"/>`;
    
    // ידית אנכית במרכז (קו עבה קצר)
    const handleY = (middleStartY + middleEndY) / 2;
    panels += `<line x1="${middleX}" y1="${handleY - 1.5}" x2="${middleX}" y2="${handleY + 1.5}" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>`;
  } else {
    panels += `<line x1="${startX + 1.5}" y1="${middleStartY + 1.5}" x2="${endX - 1.5}" y2="${middleEndY - 1.5}" stroke="${stroke}" stroke-width="0.35" stroke-dasharray="1.5,1" opacity="0.5"/>`;
    panels += `<line x1="${endX - 1.5}" y1="${middleStartY + 1.5}" x2="${startX + 1.5}" y2="${middleEndY - 1.5}" stroke="${stroke}" stroke-width="0.35" stroke-dasharray="1.5,1" opacity="0.5"/>`;
  }
  
  // קווי מידה - רוחב (למטה)
  const dimY = endY + 6;
  const dimColor = "#7a96b8";
  panels += `<line x1="${startX}" y1="${dimY}" x2="${endX}" y2="${dimY}" stroke="${dimColor}" stroke-width="0.3"/>`;
  panels += `<line x1="${startX}" y1="${dimY - 1.8}" x2="${startX}" y2="${dimY + 1.8}" stroke="${dimColor}" stroke-width="0.4"/>`;
  panels += `<line x1="${endX}" y1="${dimY - 1.8}" x2="${endX}" y2="${dimY + 1.8}" stroke="${dimColor}" stroke-width="0.4"/>`;
  panels += `<text x="${(startX + endX) / 2}" y="${dimY + 5.5}" text-anchor="middle" font-size="5.5" font-family="Arial" fill="#4a6b8a" font-weight="600">${width}</text>`;
  
  // קווי מידה - גובה (משמאל)
  const dimX = startX - 6;
  panels += `<line x1="${dimX}" y1="${startY}" x2="${dimX}" y2="${endY}" stroke="${dimColor}" stroke-width="0.3"/>`;
  panels += `<line x1="${dimX - 1.8}" y1="${startY}" x2="${dimX + 1.8}" y2="${startY}" stroke="${dimColor}" stroke-width="0.4"/>`;
  panels += `<line x1="${dimX - 1.8}" y1="${endY}" x2="${dimX + 1.8}" y2="${endY}" stroke="${dimColor}" stroke-width="0.4"/>`;
  panels += `<text x="${dimX - 2}" y="${(startY + endY) / 2 + 1.8}" text-anchor="end" font-size="5.5" font-family="Arial" fill="#4a6b8a" font-weight="600" transform="rotate(-90 ${dimX - 2} ${(startY + endY) / 2 + 1.8})">${height}</text>`;
  
  return `<svg viewBox="0 0 ${totalW} ${totalH}" class="window-svg" xmlns="http://www.w3.org/2000/svg">${panels}</svg>`;
}

function renderItemCard(item, idx) {
  const lineTotal = item.price * (item.qty || 1);
  let detail = '';
  if (item.mode === 'area') {
    const sqm = ((item.width * item.height) / 10000).toFixed(2);
    detail = `${item.width}×${item.height} ס״מ · ${sqm} מ״ר × ${formatMoney(item.pricePerSqm)}/מ״ר`;
  } else {
    detail = `מחיר קבוע · ${formatMoney(item.price)}/יח׳`;
  }
  
  const mediaCount = (item.media || []).length;
  const photoCount = (item.media || []).filter(m => m.type === 'photo').length;
  const audioCount = (item.media || []).filter(m => m.type === 'audio').length;
  
  // SVG ויזואלי של החלון - רק במצב area עם מידות
  const hasMeasurements = item.mode === 'area' && item.width && item.height;
  const windowSvg = hasMeasurements ? renderWindowSVG(item.width, item.height, item.name) : '';
  
  return `
    <div class="item-card">
      <div class="item-card-row">
        ${hasMeasurements ? `<div class="item-window-thumb">${windowSvg}</div>` : ''}
        <div class="item-card-info">
          <div class="item-card-name">${escapeHTML(item.name)}</div>
          <div class="item-card-detail">${detail}${item.qty > 1 ? ` · כמות ${item.qty}` : ''}</div>
          ${item.profileValue ? `<div class="item-card-detail" style="margin-top:6px">🔩 פרופיל ${escapeHTML(item.profileValue)}</div>` : ''}
          ${item.note ? `<div class="item-card-detail" style="margin-top:6px">📎 ${escapeHTML(item.note)}</div>` : ''}
          ${mediaCount > 0 ? `<div class="item-card-detail" style="margin-top:6px">${photoCount > 0 ? `📷 ${photoCount}` : ''} ${audioCount > 0 ? `🎙 ${audioCount}` : ''}</div>` : ''}
        </div>
        <div class="item-card-meta">
          <div class="item-card-price">${formatMoney(lineTotal)}</div>
          <div class="item-card-actions">
            <button onclick="editItem(${idx})" title="ערוך">✏️</button>
            <button class="btn-dup" onclick="duplicateItem(${idx})" title="שכפל">⎘</button>
            <button class="btn-del" onclick="deleteItem(${idx})" title="מחק">🗑</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderQuoteDoc(quote, client, business, subtotal, discountAmt, beforeVat, vatAmt, total) {
  const logo = business.logo;
  return `
    <div class="quote-doc">
      <div class="quote-doc-header">
        <div>
          ${logo ? `<img src="${logo}" style="width:50px;height:50px;border-radius:10px;object-fit:cover;margin-bottom:12px">` : `<div class="quote-doc-logo">${escapeHTML((business.name || 'A')[0])}</div>`}
          <div class="quote-doc-business">${escapeHTML(business.name || 'העסק שלי')}</div>
          <div class="quote-doc-business-meta">
            ${business.phone ? `📞 ${escapeHTML(business.phone)}` : ''}
            ${business.email ? ` · ✉ ${escapeHTML(business.email)}` : ''}
            ${business.id ? `<br>ע.מ. ${escapeHTML(business.id)}` : ''}
          </div>
        </div>
        <div class="quote-doc-num">
          <div>הצעת מחיר</div>
          <div class="quote-doc-num-val">#${quote.number}</div>
          <div style="margin-top:8px">${formatDate(quote.createdAt)}</div>
        </div>
      </div>
      
      <div class="quote-doc-body">
        <div class="quote-doc-client">
          <div class="quote-doc-client-label">עבור</div>
          <div class="quote-doc-client-name">${escapeHTML(client?.name || '')}</div>
          ${client?.phone ? `<div class="quote-doc-client-meta">📞 ${escapeHTML(client.phone)}</div>` : ''}
          ${client?.address ? `<div class="quote-doc-client-meta">📍 ${escapeHTML(client.address)}</div>` : ''}
        </div>
        
        <table class="quote-doc-table">
          <thead>
            <tr><th>#</th><th>פריט</th><th>פירוט</th><th>כמות</th><th class="num">סה״כ</th></tr>
          </thead>
          <tbody>
            ${quote.items.map((item, i) => {
              let detail = '';
              if (item.mode === 'area') {
                const sqm = ((item.width*item.height)/10000).toFixed(2);
                detail = `${item.width}×${item.height} ס״מ · ${sqm} מ״ר × ${formatMoney(item.pricePerSqm)}/מ״ר`;
              } else {
                detail = `מחיר קבוע ${formatMoney(item.price)}/יח׳`;
              }
              const hasMeasurements = item.mode === 'area' && item.width && item.height;
              const itemSvg = hasMeasurements ? renderWindowSVG(item.width, item.height) : '';
              return `
                <tr>
                  <td>${i+1}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:10px">
                      ${hasMeasurements ? `<div class="quote-doc-item-thumb">${itemSvg}</div>` : ''}
                      <div>
                        <div class="item-name">${escapeHTML(item.name)}</div>
                       ${item.profileValue ? `<div class="item-detail">פרופיל ${escapeHTML(item.profileValue)}</div>` : ''}
                        ${item.note ? `<div class="item-detail">${escapeHTML(item.note)}</div>` : ''}
                      </div>
                    </div>
                  </td>
                  <td><div class="item-detail">${detail}</div></td>
                  <td>${item.qty || 1}</td>
                  <td class="num">${formatMoney(item.price * (item.qty || 1))}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        
        <div class="quote-doc-totals">
          <div class="quote-doc-total-row"><span>סכום ביניים</span><span>${formatMoney(subtotal)}</span></div>
          ${quote.pricing.discount > 0 ? `<div class="quote-doc-total-row discount"><span>הנחה (${quote.pricing.discount}%)</span><span>-${formatMoney(discountAmt)}</span></div>` : ''}
          ${quote.pricing.install > 0 ? `<div class="quote-doc-total-row"><span>התקנה / משלוח</span><span>${formatMoney(quote.pricing.install)}</span></div>` : ''}
          ${quote.pricing.vat > 0 ? `<div class="quote-doc-total-row"><span>מע״מ (${quote.pricing.vat}%)</span><span>${formatMoney(vatAmt)}</span></div>` : ''}
          <div class="quote-doc-grand">
            <div class="quote-doc-grand-label">סה״כ לתשלום</div>
            <div class="quote-doc-grand-val">${formatMoney(total)}</div>
          </div>
        </div>
        
        ${quote.pricing.notes ? `
          <div style="margin-top:20px;padding:14px;background:var(--paper);border-radius:10px;font-size:13px;color:var(--ink-soft)">
            <strong>הערות:</strong> ${escapeHTML(quote.pricing.notes)}
          </div>
        ` : ''}
      </div>
      
      <div class="quote-doc-footer">
        ${escapeHTML(business.terms || '')}
        ${business.website ? `<br><br>${escapeHTML(business.website)}` : ''}
      </div>
    </div>
  `;
}

function renderTimeline() {
  const flow = STATUS_FLOW;
  const currentIdx = flow.indexOf(currentQuote.status);
  const timeline = currentQuote.timeline || currentQuote.history || [];
  
  return `<div class="timeline">${flow.map((status, idx) => {
    const event = timeline.find(e => e.status === status);
    let cls = '';
    let icon = '';
    
    if (idx < currentIdx || (idx === currentIdx && currentIdx === flow.length - 1)) {
      cls = 'done';
      icon = '✓';
    } else if (idx === currentIdx) {
      cls = 'active';
      icon = '●';
    }
    
    return `
      <div class="timeline-row ${cls}">
        <div class="timeline-dot">${icon}</div>
        <div class="timeline-content">
          <div class="timeline-status">${STATUS_LABELS[status]}</div>
          ${event ? `<div class="timeline-time">${formatDateTime(event.at)}${event.via ? ' · ' + event.via : ''}${event.views ? ' · ' + event.views + ' צפיות' : ''}</div>` : ''}
        </div>
      </div>
    `;
  }).join('')}</div>`;
}

function calcQuoteTotal(quote) {
  const subtotal = quote.items.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
  const discountAmt = subtotal * ((quote.pricing?.discount || 0) / 100);
  const afterDiscount = subtotal - discountAmt;
  const beforeVat = afterDiscount + (quote.pricing?.install || 0);
  const vatAmt = beforeVat * ((quote.pricing?.vat || 0) / 100);
  return beforeVat + vatAmt;
}

// ============ QUOTE STATUS ============
// 🛠️ FIX: וידוא ש-timeline הוא array לפני push (קריטי!)
function ensureTimeline() {
  if (!Array.isArray(currentQuote.timeline)) currentQuote.timeline = [];
  if (!Array.isArray(currentQuote.history)) currentQuote.history = [];
}

async function markAsSent() {
  ensureTimeline();
  currentQuote.status = 'sent';
  currentQuote.sentAt = new Date().toISOString();
  currentQuote.timeline.push({ status: 'sent', at: currentQuote.sentAt, via: 'מערכת' });
  await dbPut('quotes', currentQuote);
  renderQuoteDetail();
  showToast('ההצעה סומנה כנשלחה');
}

async function markAsApproved() {
  ensureTimeline();
  currentQuote.status = 'approved';
  currentQuote.approvedAt = new Date().toISOString();
  currentQuote.timeline.push({ status: 'approved', at: currentQuote.approvedAt });
  await dbPut('quotes', currentQuote);
  renderQuoteDetail();
  showToast('ההצעה אושרה! 🎉');
}

async function markAsProduction() {
  ensureTimeline();
  currentQuote.status = 'production';
  currentQuote.timeline.push({ status: 'production', at: new Date().toISOString() });
  await dbPut('quotes', currentQuote);
  renderQuoteDetail();
  showToast('הועבר לייצור');
}

async function markAsInstalled() {
  ensureTimeline();
  currentQuote.status = 'installed';
  currentQuote.installedAt = new Date().toISOString();
  currentQuote.timeline.push({ status: 'installed', at: currentQuote.installedAt });
  await dbPut('quotes', currentQuote);
  renderQuoteDetail();
  showToast('פרויקט הושלם! 🎉');
}

// ============ STATUS FIX (תיקון סטטוס ידני) ============
function openStatusEditor() {
  if (!currentQuote) return;
  
  document.getElementById('status-current').innerText = STATUS_LABELS[currentQuote.status] || currentQuote.status;
  document.getElementById('status-new').value = currentQuote.status;
  document.getElementById('status-reason').value = '';
  
  showModal('modal-status-editor');
}

async function applyStatusFix() {
  ensureTimeline();
  const newStatus = document.getElementById('status-new').value;
  const reason = document.getElementById('status-reason').value.trim();
  
  if (newStatus === currentQuote.status) {
    showToast('הסטטוס לא שונה');
    return;
  }
  
  const oldStatus = currentQuote.status;
  
  // עדכון הסטטוס
  currentQuote.status = newStatus;
  
  // נקה תאריכים של סטטוסים שאנחנו לא בהם יותר
  if (newStatus === 'draft') {
    currentQuote.sentAt = null;
    currentQuote.viewedAt = null;
    currentQuote.approvedAt = null;
    currentQuote.installedAt = null;
  } else if (newStatus === 'sent') {
    currentQuote.viewedAt = null;
    currentQuote.approvedAt = null;
    currentQuote.installedAt = null;
    if (!currentQuote.sentAt) currentQuote.sentAt = new Date().toISOString();
  } else if (newStatus === 'viewed') {
    currentQuote.approvedAt = null;
    currentQuote.installedAt = null;
    if (!currentQuote.sentAt) currentQuote.sentAt = new Date().toISOString();
    if (!currentQuote.viewedAt) currentQuote.viewedAt = new Date().toISOString();
  } else if (newStatus === 'approved') {
    currentQuote.installedAt = null;
    if (!currentQuote.approvedAt) currentQuote.approvedAt = new Date().toISOString();
  } else if (newStatus === 'installed') {
    if (!currentQuote.installedAt) currentQuote.installedAt = new Date().toISOString();
  }
  
  // הוסף רשומה ל-timeline
  currentQuote.timeline.push({
    status: newStatus,
    at: new Date().toISOString(),
    manual: true,
    fromStatus: oldStatus,
    reason: reason || 'תיקון ידני'
  });
  
  await dbPut('quotes', currentQuote);
  closeModal('modal-status-editor');
  renderQuoteDetail();
  showToast(`הסטטוס שונה ל-${STATUS_LABELS[newStatus]}`);
}

async function deleteQuote() {
  confirmAction('מחיקת הצעה', 'האם אתה בטוח? פעולה זו לא ניתנת לביטול.', async () => {
    await dbDelete('quotes', currentQuote.id);
    showToast('ההצעה נמחקה');
    showScreen('quotes', document.querySelector('[data-screen="quotes"]'));
  });
}

// ============ DUPLICATE QUOTE ============
/**
 * שכפול הצעת מחיר קיימת
 * יוצר הצעה חדשה במצב טיוטה עם כל הפריטים, התמחור והמדיה
 */
async function duplicateQuote() {
  // בדיקת מגבלת חבילה חינמית
 const { data: freshProfile } = await sb.from('profiles').select('plan').eq('id', currentUserId).maybeSingle();
if (freshProfile?.plan === 'free') {
    const quotes = await dbAll('quotes');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0,0,0,0);
    const thisMonth = quotes.filter(q => new Date(q.createdAt) >= monthStart);
    if (thisMonth.length >= 5) {
      confirmAction('הגעת למגבלת החינם', 'יצרת כבר 5 הצעות החודש. שדרג ל-Pro כדי להמשיך ללא הגבלה.', () => {
        showScreen('upgrade', document.querySelector('[data-screen="upgrade"]'));
      });
      return;
    }
  }
  
  confirmAction('שכפול הצעה', `ההצעה הנוכחית (#${currentQuote.number}) תשוכפל להצעה חדשה במצב טיוטה. תוכל לערוך את העותק החדש בלי להשפיע על המקורי.`, async () => {
    // יצירת מספר הצעה חדש
    const allQuotes = await dbAll('quotes');
    const year = new Date().getFullYear();
    const yearQuotes = allQuotes.filter(q => q.number && q.number.startsWith(year + '-'));
    const newNum = `${year}-${String(yearQuotes.length + 1).padStart(3, '0')}`;
    
    // העתק עמוק של ההצעה
    const newQuote = JSON.parse(JSON.stringify(currentQuote));
    
    // שינויים נדרשים
    newQuote.id = uid();
    newQuote.number = newNum;
    newQuote.status = 'draft';
    newQuote.createdAt = new Date().toISOString();
    newQuote.sentAt = null;
    newQuote.viewedAt = null;
    newQuote.approvedAt = null;
    newQuote.installedAt = null;
    newQuote.timeline = [{
      status: 'draft',
      at: new Date().toISOString(),
      duplicatedFrom: currentQuote.number
    }];
    
    // החלפת ID של פריטים (לא לחלוק עם המקור)
    if (newQuote.items) {
      newQuote.items.forEach(item => {
        item.id = uid();
        // המדיה נשארת — היא זהה כי זה אותו פתח
      });
    }
    
    await dbPut('quotes', newQuote);
    
    // מעבר להצעה החדשה
    currentQuote = newQuote;
    showToast(`שוכפלה כהצעה #${newNum}`);
    renderQuoteDetail();
  });
}

/**
 * שכפול הצעה לפי ID (מהרשימה, כשהיא לא פתוחה)
 */
async function duplicateQuoteById(id) {
  const quote = await dbGet('quotes', id);
  if (!quote) return;
  currentQuote = quote;
  await duplicateQuote();
}

/**
 * פתיחה מחדש לעריכה - מחזיר הצעה שנשלחה למצב טיוטה
 * שימוש: כשצריך לתקן הצעה שנשלחה ללקוח (טעות במחיר, טעות בפריט וכו')
 */
async function reopenForEdit() {
  const statusLabel = STATUS_LABELS[currentQuote.status];
  
  confirmAction(
    'פתיחה מחדש לעריכה',
    `ההצעה #${currentQuote.number} נמצאת כעת במצב "${statusLabel}". פתיחה מחדש תחזיר אותה למצב "טיוטה" ותאפשר עריכה מלאה.\n\n⚠ חשוב לדעת:\n• אם ההצעה כבר נשלחה ללקוח — שלח לו את הגרסה המעודכנת\n• אם הסטטוס היה "אושרה / בייצור / הותקנה" — חשוב לתאם עם הלקוח לפני שינויים\n\nהאם להמשיך?`,
    async () => {
      ensureTimeline();
      const oldStatus = currentQuote.status;
      currentQuote.status = 'draft';
      
      // שמירה של ההיסטוריה
      currentQuote.timeline.push({
        status: 'draft',
        at: new Date().toISOString(),
        reopenedFrom: oldStatus,
        reason: 'נפתחה מחדש לעריכה'
      });
      
      await dbPut('quotes', currentQuote);
      renderQuoteDetail();
      showToast('ההצעה נפתחה לעריכה');
    }
  );
}

// ============ ITEM MODAL ============
function newItem() {
  currentItem = null;
  currentItemMedia = [];
  document.getElementById('modal-item-title').innerText = 'פתח חדש';
  document.getElementById('item-name').value = '';
  document.getElementById('item-width').value = '';
  document.getElementById('item-height').value = '';
  document.getElementById('item-qty').value = 1;
  document.getElementById('item-qty-area').value = 1;
  document.getElementById('item-price').value = '';
  document.getElementById('item-price-sqm').value = '';
  document.getElementById('item-min-price').value = '';
  document.getElementById('item-note').value = '';
  setItemMode('fixed');
  renderItemMedia();
  updateAreaPreview();
  showModal('modal-item');
  setTimeout(() => document.getElementById('item-name').focus(), 100);
 // טיפול בהוספה/מחיקה של פרופיל
  document.getElementById('item-profile').onchange = async function() {
    // ===== מחיקת פרופיל =====
    if (this.value === '__delete__') {
      const category = this.dataset.category;
      if (!category) { this.value = ''; return; }

      const profiles = await getProfiles(category);
      if (profiles.length === 0) {
        showToast('אין פרופילים למחיקה');
        this.value = '';
        return;
      }

      const list = profiles.map((p, i) => `${i + 1}) ${p.value}`).join('\n');
      const choice = prompt(`בחר פרופיל למחיקה (הזן מספר):\n\n${list}`);
      this.value = '';

      if (!choice) return;
      const idx = parseInt(choice) - 1;
      if (isNaN(idx) || idx < 0 || idx >= profiles.length) {
        showToast('בחירה לא תקינה');
        return;
      }

      const target = profiles[idx];
      if (!confirm(`למחוק את פרופיל "${target.value}"?\nפעולה זו לא הפיכה.`)) return;

      await deleteProfile(target.id);
      showToast('פרופיל נמחק ✓');

      // רענון הרשימה ב-select
      const fresh = await getProfiles(category);
      this.innerHTML = '<option value="">— בחר פרופיל —</option>' +
        fresh.map(p => `<option value="${p.id}">${p.value}</option>`).join('') +
        '<option value="__add__">+ הוסף פרופיל חדש</option>' +
        (fresh.length > 0 ? '<option value="__delete__">🗑 מחק פרופיל...</option>' : '');
      return;
    }

    // ===== הוספת פרופיל חדש =====
    if (this.value !== '__add__') return;

    const category = this.dataset.category;
    if (!category) {
      this.value = '';
      showToast('לא ניתן להוסיף פרופיל לקטגוריה זו');
      return;
    }

    const val = prompt(`הזן מספר פרופיל חדש עבור ${category}:`);
    if (!val || !val.trim()) { this.value = ''; return; }

    const ok = await addProfile(category, val.trim());
    if (!ok) { showToast('שגיאה בהוספת פרופיל'); this.value = ''; return; }

    showToast('פרופיל נוסף ✓');
    const profiles = await getProfiles(category);
    const fresh = profiles[profiles.length - 1];
    const newOpt = document.createElement('option');
    newOpt.value = fresh.id;
    newOpt.text = val.trim();
    this.insertBefore(newOpt, this.lastChild);
    this.value = fresh.id;
  };
}

function newItemTemplate(name, mode, dims) {
  newItem();
  document.getElementById('item-name').value = name;
 // הצגת שדה פרופיל לקטגוריות נתמכות
  const profileField = document.getElementById('profile-field');
  const profileSelect = document.getElementById('item-profile');
  if (PROFILE_CATEGORIES.includes(name)) {
    profileField.style.display = 'block';
    profileSelect.dataset.category = name; // נשמור את הקטגוריה על האלמנט
    getProfiles(name).then(profiles => {
      profileSelect.innerHTML = '<option value="">— בחר פרופיל —</option>' +
        profiles.map(p => `<option value="${p.id}">${p.value}</option>`).join('') +
        '<option value="__add__">+ הוסף פרופיל חדש</option>' +
        (profiles.length > 0 ? '<option value="__delete__">🗑 מחק פרופיל...</option>' : '');
    });
  } else {
    profileField.style.display = 'none';
    profileSelect.dataset.category = '';
    profileSelect.innerHTML = '<option value="">— בחר פרופיל —</option>';
  }
  if (mode === 'area') {
    setItemMode('area');
  } else {
    setItemMode('fixed');
  }
  
  if (dims) {
    if (dims.width) document.getElementById('item-width').value = dims.width;
    if (dims.height) document.getElementById('item-height').value = dims.height;
    updateAreaPreview();
  }
  
  // פוקוס לשדה המחיר אחרי המידות
  setTimeout(() => {
    if (mode === 'area') {
      document.getElementById('item-price-sqm').focus();
    } else {
      document.getElementById('item-price').focus();
    }
  }, 100);
}

function editItem(idx) {
  const item = currentQuote.items[idx];
  currentItem = idx;
  currentItemMedia = [...(item.media || [])];
  
  document.getElementById('modal-item-title').innerText = 'עריכת פתח';
  document.getElementById('item-name').value = item.name;
  document.getElementById('item-width').value = item.width || '';
  document.getElementById('item-height').value = item.height || '';
  document.getElementById('item-note').value = item.note || '';
  
  if (item.mode === 'area') {
    setItemMode('area');
    document.getElementById('item-qty-area').value = item.qty || 1;
    document.getElementById('item-price-sqm').value = item.pricePerSqm || '';
    document.getElementById('item-min-price').value = item.minPrice || '';
  } else {
    setItemMode('fixed');
    document.getElementById('item-qty').value = item.qty || 1;
    document.getElementById('item-price').value = item.price || '';
    document.getElementById('item-min-price').value = '';
  }
  
  renderItemMedia();
  updateAreaPreview();
  showModal('modal-item');
}

function setItemMode(mode) {
  itemMode = mode;
  document.getElementById('mode-fixed').classList.toggle('active', mode === 'fixed');
  document.getElementById('mode-area').classList.toggle('active', mode === 'area');
  document.getElementById('fixed-price-fields').style.display = mode === 'fixed' ? 'block' : 'none';
  document.getElementById('area-price-fields').style.display = mode === 'area' ? 'block' : 'none';
  updateAreaPreview();
}

function updateAreaPreview() {
  const w = parseFloat(document.getElementById('item-width').value) || 0;
  const h = parseFloat(document.getElementById('item-height').value) || 0;
  const sqm = (w * h) / 10000;
  
  let html = '';
  if (w > 0 && h > 0) {
    html = `<div style="font-size:13px;color:var(--steel);margin-bottom:4px">${w} × ${h} ס״מ</div>`;
    html += `<div class="area-result">${sqm.toFixed(2)} מ״ר</div>`;
    
    if (itemMode === 'area') {
      const p = parseFloat(document.getElementById('item-price-sqm').value) || 0;
      const q = parseInt(document.getElementById('item-qty-area').value) || 1;
      const minPrice = parseFloat(document.getElementById('item-min-price').value) || 0;
      
      if (p > 0) {
        const calculatedPrice = sqm * p;
        const finalPrice = Math.max(calculatedPrice, minPrice);
        const isMinApplied = minPrice > 0 && minPrice > calculatedPrice;
        
        if (isMinApplied) {
          html += `<div style="margin-top:6px;font-size:13px;color:var(--steel);text-decoration:line-through">${formatMoney(calculatedPrice)} × ${q}</div>`;
          html += `<div style="margin-top:2px;font-size:14px;color:var(--accent-deep)">⚠ מחיר מינימום: ${formatMoney(minPrice)} × ${q} = <strong>${formatMoney(finalPrice * q)}</strong></div>`;
        } else {
          html += `<div style="margin-top:6px;font-size:14px;color:var(--ink)">${formatMoney(calculatedPrice)} × ${q} = <strong>${formatMoney(finalPrice * q)}</strong></div>`;
        }
      }
    } else {
      const p = parseFloat(document.getElementById('item-price').value) || 0;
      const q = parseInt(document.getElementById('item-qty').value) || 1;
      if (p > 0) {
        html += `<div style="margin-top:6px;font-size:14px;color:var(--ink)">${formatMoney(p)} × ${q} = <strong>${formatMoney(p * q)}</strong></div>`;
      }
    }
  } else {
    html = `<div style="font-size:13px;color:var(--steel)">השטח יוצג כשתזין מידות</div>`;
  }
  
  document.getElementById('area-preview').innerHTML = html;
}

document.addEventListener('input', e => {
  if (['item-price','item-price-sqm','item-qty','item-qty-area','item-min-price'].includes(e.target.id)) {
    updateAreaPreview();
  }
});

function renderItemMedia() {
  const strip = document.getElementById('item-media-strip');
  strip.innerHTML = currentItemMedia.map((m, i) => {
    if (m.type === 'photo') {
      return `<div class="media-item">
        <img src="${m.data}">
        <button class="media-remove" onclick="removeMedia(${i})">✕</button>
      </div>`;
    } else if (m.type === 'audio') {
      return `<div class="media-item audio">
        🎙
        <span class="media-badge">${m.duration || 0}s</span>
        <button class="media-remove" onclick="removeMedia(${i})">✕</button>
      </div>`;
    }
  }).join('');
}

function removeMedia(idx) {
  currentItemMedia.splice(idx, 1);
  renderItemMedia();
}

async function handleItemPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const limit = user && user.plan !== 'free' ? 10 : 2;
  const photos = currentItemMedia.filter(m => m.type === 'photo').length;
  
  if (photos >= limit) {
    showToast(`מגבלת ${limit} תמונות לפתח. שדרג ל-Pro לעד 10 תמונות.`);
    event.target.value = '';
    return;
  }
  
  showToast('מעלה תמונה...');
  
  // קידוד base64 לתצוגה מיידית
  const reader = new FileReader();
  reader.onload = async (e) => {
    const img = new Image();
    img.onload = async () => {
      // כיווץ התמונה
      const canvas = document.createElement('canvas');
      const maxDim = 1200;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = h * maxDim / w; w = maxDim; }
        else { w = w * maxDim / h; h = maxDim; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.8);
      
      // מבנה מדיה עם base64 לתצוגה מקומית
      const mediaObj = {
        id: uid(),
        type: 'photo',
        data: compressed,
        at: new Date().toISOString()
      };
      
      // ניסיון העלאה ל-Supabase Storage
      try {
        const blob = await (await fetch(compressed)).blob();
        const fileName = `photo-${Date.now()}.jpg`;
        const { url, path } = await uploadFile('photos', blob, fileName);
        mediaObj.data = url;  // מחליפים base64 ב-URL
        mediaObj.path = path;
        showToast('תמונה נוספה ✓');
      } catch (err) {
        console.warn('Storage upload failed, using local base64:', err);
        showToast('תמונה נוספה (מקומית)');
      }
      
      currentItemMedia.push(mediaObj);
      renderItemMedia();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// ============ AUDIO RECORDING ============
async function startRecording() {
  const limit = user.plan === 'free' ? 30 : 180;
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      const duration = Math.round((Date.now() - recordingStart) / 1000);
      
      const mediaObj = {
        id: uid(),
        type: 'audio',
        duration,
        at: new Date().toISOString()
      };
      
      // ניסיון העלאה ל-Supabase Storage
      try {
        const fileName = `audio-${Date.now()}.webm`;
        const { url, path } = await uploadFile('audio', blob, fileName);
        mediaObj.data = url;
        mediaObj.path = path;
        showToast(`הקלטה נוספה (${duration}ש׳) ✓`);
      } catch (err) {
        console.warn('Audio upload failed, using local base64:', err);
        // fallback ל-base64
        const reader = new FileReader();
        reader.onload = (e) => { mediaObj.data = e.target.result; };
        reader.readAsDataURL(blob);
        showToast(`הקלטה נוספה (${duration}ש׳)`);
      }
      
      currentItemMedia.push(mediaObj);
      renderItemMedia();
      stream.getTracks().forEach(t => t.stop());
    };
    
    recordingStart = Date.now();
    mediaRecorder.start();
    
    document.getElementById('recording-overlay').classList.add('show');
    
    recordingTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recordingStart) / 1000);
      document.getElementById('recording-time').innerText = 
        String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0');
      
      if (sec >= limit) {
        stopRecording();
        showToast(`הגעת למגבלת ${limit} שניות`);
      }
    }, 100);
  } catch (err) {
    showToast('לא ניתן לגשת למיקרופון. אשר הרשאות.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  document.getElementById('recording-overlay').classList.remove('show');
}

async function saveItem() {
  const name = document.getElementById('item-name').value.trim();
  if (!name) { showToast('חובה להזין שם'); return; }
  
  let item = { id: currentItem !== null ? currentQuote.items[currentItem].id : uid(), name, mode: itemMode, media: currentItemMedia, note: document.getElementById('item-note').value.trim() };
  // שמירת פרופיל אלומיניום (אם נבחר)
  const profileSelect = document.getElementById('item-profile');
  const profileField = document.getElementById('profile-field');
  if (profileField && profileField.style.display !== 'none' && profileSelect.value && profileSelect.value !== '__add__') {
    const selectedOption = profileSelect.options[profileSelect.selectedIndex];
    item.profileId = profileSelect.value;
    item.profileValue = selectedOption ? selectedOption.text : '';
  }
  const w = parseFloat(document.getElementById('item-width').value);
  const h = parseFloat(document.getElementById('item-height').value);
  
  if (itemMode === 'area') {
    if (!w || !h) { showToast('חובה להזין רוחב וגובה'); return; }
    const psqm = parseFloat(document.getElementById('item-price-sqm').value);
    if (isNaN(psqm) || psqm < 0) { showToast('חובה להזין מחיר למ״ר'); return; }
    
    item.width = w;
    item.height = h;
    item.pricePerSqm = psqm;
    item.qty = parseInt(document.getElementById('item-qty-area').value) || 1;
    
    // חישוב מחיר עם מינימום
    const calculatedPrice = (w * h / 10000) * psqm;
    const minPrice = parseFloat(document.getElementById('item-min-price').value) || 0;
    item.minPrice = minPrice;
    item.price = Math.max(calculatedPrice, minPrice);
  } else {
    if (w) item.width = w;
    if (h) item.height = h;
    const p = parseFloat(document.getElementById('item-price').value);
    if (isNaN(p) || p < 0) { showToast('חובה להזין מחיר'); return; }
    item.price = p;
    item.qty = parseInt(document.getElementById('item-qty').value) || 1;
  }
  
  if (currentItem !== null) {
    currentQuote.items[currentItem] = item;
  } else {
    currentQuote.items.push(item);
  }
  
  await dbPut('quotes', currentQuote);
  closeModal('modal-item');
  renderQuoteDetail();
  showToast(currentItem !== null ? 'הפתח עודכן' : 'הפתח נוסף');
}

async function duplicateItem(idx) {
  const original = currentQuote.items[idx];
  // Deep clone כולל מדיה
  const item = JSON.parse(JSON.stringify(original));
  item.id = uid();
  // הוסף ליד הפריט המקורי, לא בסוף
  currentQuote.items.splice(idx + 1, 0, item);
  await dbPut('quotes', currentQuote);
  renderQuoteDetail();
  showToast('הפתח שוכפל');
}

async function deleteItem(idx) {
  confirmAction('מחיקת פתח', 'האם אתה בטוח?', async () => {
    currentQuote.items.splice(idx, 1);
    await dbPut('quotes', currentQuote);
    renderQuoteDetail();
    showToast('הפתח נמחק');
  });
}

// ============ PRICING MODAL ============
function openPricingModal() {
  document.getElementById('pricing-discount').value = currentQuote.pricing.discount || 0;
  document.getElementById('pricing-install').value = currentQuote.pricing.install || 0;
  document.getElementById('pricing-vat').value = currentQuote.pricing.vat || 18;
  document.getElementById('pricing-notes').value = currentQuote.pricing.notes || '';
  showModal('modal-pricing');
}

async function savePricing() {
  currentQuote.pricing = {
    discount: parseFloat(document.getElementById('pricing-discount').value) || 0,
    install: parseFloat(document.getElementById('pricing-install').value) || 0,
    vat: parseFloat(document.getElementById('pricing-vat').value) || 0,
    notes: document.getElementById('pricing-notes').value
  };
  await dbPut('quotes', currentQuote);
  closeModal('modal-pricing');
  renderQuoteDetail();
  showToast('החישובים נשמרו');
}

/**
 * עדכון מהיר של שדה תמחור (הנחה / התקנה) ישירות מסיכום ההצעה
 */
async function updatePricingField(field, value) {
  const numValue = parseFloat(value) || 0;
  if (!currentQuote.pricing) currentQuote.pricing = {};
  currentQuote.pricing[field] = numValue;
  await dbPut('quotes', currentQuote);
  renderQuoteDetail();
}

// ============ SHARING ============
// ============ PDF GENERATION ============

async function generateQuotePDF() {
  showToast('מכין PDF...');
  
  // יצירת div זמני עם תוכן ה-quote-doc
  const client = await dbGet('clients', currentQuote.clientId);
  const business = (await dbGet('settings', 'business'))?.value || {};
  const { subtotal, discountAmt, beforeVat, vatAmt, total } = calcQuoteTotals(currentQuote);
  
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: fixed; top: -9999px; left: -9999px;
    width: 794px; background: white; padding: 0;
    font-family: 'Heebo', sans-serif; direction: rtl;
    z-index: -1;
  `;
  wrapper.innerHTML = renderQuoteDoc(currentQuote, client, business, subtotal, discountAmt, beforeVat, vatAmt, total);
  document.body.appendChild(wrapper);
  
  try {
    const { jsPDF } = window.jspdf;
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 794,
      onclone: (doc) => {
        // וידוא Light Mode לייצוא
        doc.documentElement.removeAttribute('data-theme');
      }
    });
    
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * pageW) / canvas.width;
    
    let yPos = 0;
    let heightLeft = imgH;
    
    pdf.addImage(imgData, 'JPEG', 0, yPos, imgW, imgH);
    heightLeft -= pageH;
    
    while (heightLeft > 0) {
      yPos = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, yPos, imgW, imgH);
      heightLeft -= pageH;
    }
    
    return { pdf, canvas, imgData };
  } finally {
    document.body.removeChild(wrapper);
  }
}

function calcQuoteTotals(quote) {
  const items = quote.items || [];
  let subtotal = 0;
  items.forEach(item => {
    let itemTotal = 0;
    if (item.mode === 'area' && item.width && item.height && item.pricePerSqm) {
      const sqm = (item.width * item.height) / 10000;
      itemTotal = sqm * item.pricePerSqm * (item.qty || 1);
      if (item.minPrice && itemTotal < item.minPrice * (item.qty || 1)) {
        itemTotal = item.minPrice * (item.qty || 1);
      }
    } else if (item.price) {
      itemTotal = item.price * (item.qty || 1);
    }
    subtotal += itemTotal;
  });
  
  const p = quote.pricing || {};
  const discountAmt = subtotal * ((p.discount || 0) / 100);
  const afterDiscount = subtotal - discountAmt;
  const install = p.install || 0;
  const beforeVat = afterDiscount + install;
  const vatAmt = beforeVat * ((p.vat || 0) / 100);
  const total = beforeVat + vatAmt;
  
  return { subtotal, discountAmt, beforeVat, vatAmt, total };
}

async function downloadQuotePDF() {
  try {
    const { pdf } = await generateQuotePDF();
    pdf.save(`הצעה-${currentQuote.number}.pdf`);
    showToast('PDF הורד בהצלחה ✓');
  } catch (e) {
    console.error('PDF error:', e);
    showToast('שגיאה ביצירת PDF: ' + e.message);
  }
}

async function shareWhatsAppPDF() {
  try {
    const client = await dbGet('clients', currentQuote.clientId);
    const business = (await dbGet('settings', 'business'))?.value || {};
    const { total } = calcQuoteTotals(currentQuote);
    
    const { pdf } = await generateQuotePDF();
    
    // המרה ל-Blob
    const pdfBlob = pdf.output('blob');
    const fileName = `הצעה-${currentQuote.number}-${business.name || 'ALUM'}.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    
    const text = `שלום ${client?.name || ''},\nמצורפת הצעת מחיר #${currentQuote.number}.\nסה״כ: ${formatMoney(total)}\n\nמ-${business.name || 'העסק'}`;
    
    // ניסיון שיתוף עם Web Share API (מובייל)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      await navigator.share({
        title: `הצעת מחיר #${currentQuote.number}`,
        text,
        files: [pdfFile]
      });
      
      if (currentQuote.status === 'draft') {
        setTimeout(() => confirmAction('סמן כנשלח?', 'האם לסמן את ההצעה כנשלחה?', () => markAsSent()), 500);
      }
    } else {
      // Fallback: הורד PDF ואז פתח WhatsApp עם טקסט
      pdf.save(fileName);
      showToast('PDF הורד — עכשיו שלח אותו ידנית ב-WhatsApp');
      
      setTimeout(() => {
        const phone = (client?.phone || '').replace(/[^\d]/g, '').replace(/^0/, '972');
        const waUrl = phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
          : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(waUrl, '_blank');
      }, 1500);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('WhatsApp PDF error:', e);
      showToast('שגיאה: ' + e.message);
    }
  }
}

async function sendQuoteEmail() {
  try {
    if (!currentQuote || !currentQuote.clientId) {
      showToast('שגיאה: אין הצעה פעילה');
      return;
    }

    const client = await dbGet('clients', currentQuote.clientId);

    // אם ללקוח אין מייל — שאל אם לסמן ידנית כנשלחה (רק אם בטיוטה)
    if (!client?.email) {
      if (currentQuote.status === 'draft') {
        confirmAction(
          'אין מייל ללקוח',
          'ללקוח זה אין כתובת מייל. האם לסמן את ההצעה כנשלחה ידנית (בלי לשלוח מייל)?',
          () => markAsSent()
        );
      } else {
        showToast('אין אימייל ללקוח — הוסף אימייל בכרטיס הלקוח');
      }
      return;
    }

    const business = (await dbGet('settings', 'business'))?.value || {};
    const { total } = calcQuoteTotals(currentQuote);

    showEmailModal(client, business, total);
  } catch (e) {
    console.error('sendQuoteEmail error:', e);
    showToast('שגיאה: ' + e.message);
  }
}

function showEmailModal(client, business, total) {
  // הצגת מודאל שליחת מייל
  const existingModal = document.getElementById('modal-email-quote');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'modal-email-quote';
  modal.className = 'modal-bg show';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <div class="modal-title">📧 שליחת הצעה במייל</div>
        <button class="icon-btn" id="email-modal-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="input-group">
          <label>אל</label>
          <input class="input" id="email-to" type="email" value="${client.email || ''}" placeholder="email@example.com">
        </div>
        <div class="input-group">
          <label>נושא</label>
          <input class="input" id="email-subject" value="הצעת מחיר #${currentQuote.number} מ-${business.name || 'העסק'}">
        </div>
        <div class="input-group">
          <label>הודעה</label>
          <textarea class="input" id="email-body" rows="4" style="resize:vertical">שלום ${client.name || ''},

מצורפת הצעת מחיר מספר ${currentQuote.number}.
סה״כ לתשלום: ${formatMoney(total)}

לשאלות אני זמין בכל עת.
${user.name || ''}
${business.phone || ''}</textarea>
        </div>
        <div style="background:var(--bg-section);border-radius:10px;padding:12px;font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:8px">
          📎 קובץ PDF של ההצעה יצורף אוטומטית
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="email-modal-cancel">ביטול</button>
        <button class="btn btn-primary" id="send-email-btn">📧 שלח מייל</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // 🛠️ FIX: חיבור event listeners אחרי appendChild (לא בתוך ה-innerHTML!)
  document.getElementById('send-email-btn').addEventListener('click', doSendQuoteEmail);
  document.getElementById('email-modal-close').addEventListener('click', () => modal.remove());
  document.getElementById('email-modal-cancel').addEventListener('click', () => modal.remove());
}
async function doSendQuoteEmail() {
  const to = (document.getElementById('email-to').value || document.getElementById('email-to').textContent || '').trim();

  const subjectEl = document.getElementById('email-subject');
const subject = subjectEl ? (subjectEl.value || subjectEl.textContent || '').trim() : '';
  const bodyEl = document.getElementById('email-body');
const body = bodyEl ? (bodyEl.value || bodyEl.innerHTML || '').trim() : '';
  
  if (!to || !to.includes('@')) {
    showToast('כתובת מייל לא תקינה');
    return;
  }
  
  const btn = document.querySelector('#modal-email-quote .btn-primary');
  btn.disabled = true;
  btn.textContent = 'שולח...';
  showToast('מכין PDF ושולח...');
  
  try {
    const { pdf } = await generateQuotePDF();
    const pdfBase64 = pdf.output('datauristring').split(',')[1];
    
    const business = (await dbGet('settings', 'business'))?.value || {};
    const fromName = business.name || user.name || 'ALUM(cm)';
    const fromEmail = business.email || user.email || '';
    
    // יצירת public token אם אין
if (!currentQuote.publicToken) {
  currentQuote.publicToken = uid();
  await dbPut('quotes', currentQuote);
}

const quoteUrl = `${window.location.origin}?quote=${currentQuote.publicToken}`;
const { total } = calcQuoteTotals(currentQuote);

// שליחה דרך Supabase Edge Function (Resend)
const { data, error } = await sb.functions.invoke('send-quote-email', {
  body: {
    to,
    clientName: currentQuote.clientName || 'לקוח יקר',
    businessName: business.name || user.name || 'ALUM(cm)',
    businessEmail: business.email || user.email || '',
    quoteNumber: currentQuote.number,
    quoteTotal: Math.round(total).toLocaleString('he-IL'),
    quoteUrl,
   senderName: user.name,
    pdfBase64,
    pdfFileName: `הצעה-${currentQuote.number || currentQuote.id}.pdf`
  }
});
    
    if (error) throw error;
    
    document.getElementById('modal-email-quote').remove();
    showToast('המייל נשלח בהצלחה! ✓');
    
   if (currentQuote.status === 'draft') {
      await markAsSent();
    }
  } catch (e) {
    console.error('Email error:', e);
    btn.disabled = false;
    btn.textContent = '📧 שלח מייל';
    
    // Fallback — פתח client email עם הוראות
    showToast('שגיאה בשליחה. פותח מייל ידני...');
    const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n[צרף את ה-PDF שהורד]')}`;
    await downloadQuotePDF();
    setTimeout(() => window.open(mailtoUrl), 1000);
  }
}

async function shareWhatsApp() {
  const client = await dbGet('clients', currentQuote.clientId);
  const total = calcQuoteTotal(currentQuote);
  const business = (await dbGet('settings', 'business'))?.value || {};
  
  // יצירת public token אם אין
  if (!currentQuote.publicToken) {
    currentQuote.publicToken = uid();
    await dbPut('quotes', currentQuote);
  }
  
  // URL ציבורי לצפייה בהצעה
  const appUrl = window.location.origin + window.location.pathname;
  const publicUrl = `${appUrl}?quote=${currentQuote.publicToken}`;
  
  const text = `שלום ${client?.name || ''},\n\nמצורפת הצעת מחיר #${currentQuote.number} מ-${business.name || 'העסק'}.\n\nסה״כ: ${formatMoney(total)}\nמספר פריטים: ${currentQuote.items.length}\n\nלצפייה בהצעה המלאה:\n${publicUrl}\n\nבכל שאלה אשמח לעזור.\nתודה,\n${user.name}\n\n— נשלח מ-ALUM(cm)`;
  
  const phone = (client?.phone || '').replace(/[^\d]/g, '').replace(/^0/, '972');
  const url = phone 
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  
  window.open(url, '_blank');
  
  if (currentQuote.status === 'draft') {
    setTimeout(() => {
      confirmAction('סמן כנשלח?', 'האם תרצה לסמן את ההצעה כנשלחה?', () => markAsSent());
    }, 500);
  }
}

// ============ SUBSCRIPTION SYSTEM ============

/**
 * רנדור מסך המנוי - מציג מצב דינמי לפי החבילה הנוכחית
 */
async function renderSubscriptionScreen() {
  const sub = await getCurrentSubscription();
  
  // טעינת תשלומים מ-Supabase
  let payments = [];
  if (currentUserId) {
    const { data } = await sb
      .from('payments')
      .select('*')
      .eq('user_id', currentUserId)
      .order('paid_at', { ascending: false })
      .limit(20);
    payments = data || [];
  }
  
  // טעינת הצעות החודש
  const quotes = await dbAll('quotes');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0,0,0,0);
  const thisMonthQuotes = quotes.filter(q => new Date(q.createdAt) >= monthStart).length;
  
  // קריאת plan מ-Supabase profile (הכי עדכני)
  let currentPlan = user.plan || 'free';
  if (currentUserId) {
    const { data: profile } = await sb.from('profiles').select('plan').eq('id', currentUserId).maybeSingle();
    if (profile) { currentPlan = profile.plan; user.plan = profile.plan; }
  }
  
  const isFree = currentPlan === 'free' || currentPlan === 'trial';
  const isCanceling = sub && sub.status === 'canceling';
  const isPro = !isFree;
  
  let cardClass = 'sub-status-card';
  if (isFree) cardClass += ' free';
  if (isCanceling) cardClass += ' canceling';
  
  let tierLabel, tierName, metaItems = [], actions = [];
  
  if (isFree) {
    tierLabel = 'חבילה חינמית';
    tierName = 'התחלה';
    metaItems = [
      { label: 'הצעות בחודש', value: `${thisMonthQuotes} / 5` },
      { label: 'פיצ\'רים', value: 'בסיסיים' }
    ];
    actions = `<button class="btn btn-accent" onclick="startUpgrade('pro_monthly')">⭐ שדרג ל-Pro</button>`;
  } else if (isCanceling) {
    tierLabel = 'Pro · בתהליך ביטול';
    tierName = sub.plan === 'pro_annual' ? 'Pro שנתי' : 'Pro חודשי';
    metaItems = [
      { label: 'פעיל עד', value: sub.ends_at ? formatDate(sub.ends_at) : '-' },
      { label: 'לאחר מכן', value: 'יעבור ל-Free' }
    ];
    actions = `<button class="btn btn-accent" onclick="resumeSubscription()">חידוש מנוי</button>`;
  } else {
    tierLabel = 'Pro פעיל ✓';
    tierName = sub?.plan === 'pro_annual' ? 'Pro שנתי' : 'Pro חודשי';
    metaItems = [
      { label: 'חיוב הבא', value: sub?.next_charge_at ? formatDate(sub.next_charge_at) : '-' },
      { label: 'סכום חיוב', value: sub?.plan === 'pro_annual' ? '₪ 990' : '₪ 99' }
    ];
    actions = `
      <button class="btn" onclick="cancelSubscription()">ביטול מנוי</button>
      ${sub?.plan === 'pro_monthly' ? `<button class="btn btn-accent" onclick="startUpgrade('pro_annual')">עבור לשנתי – חיסכון 17%</button>` : ''}
    `;
  }
  
  const usagePct = Math.min(100, (thisMonthQuotes / 5) * 100);
  const usageBarClass = usagePct >= 100 ? 'danger' : usagePct >= 80 ? 'warning' : '';
  
  const usageHtml = isFree ? `
    <div class="usage-section">
      <div class="usage-row">
        <strong>שימוש החודש</strong>
        <span>${thisMonthQuotes} / 5 הצעות</span>
      </div>
      <div class="usage-bar">
        <div class="usage-bar-fill ${usageBarClass}" style="width:${usagePct}%"></div>
      </div>
      <div class="usage-meta">
        ${thisMonthQuotes >= 5
          ? '⚠ הגעת למגבלת החינם — שדרג להמשיך'
          : `נותרו ${5 - thisMonthQuotes} הצעות החודש`}
      </div>
    </div>` : '';
  
  // היסטוריית חיובים מ-Supabase
  const paymentsHtml = payments.length > 0 ? `
    <div class="card-section" style="margin-top:24px">
      <div class="card-section-header">
        <div class="card-section-title">היסטוריית חיובים</div>
      </div>
      <div>
        ${payments.map(p => `
          <div class="billing-row">
            <div class="billing-info">
              <div class="billing-desc">${p.plan === 'pro_annual' ? 'Pro שנתי' : 'Pro חודשי'} ALUM(cm)</div>
              <div class="billing-date">${p.paid_at ? formatDateTime(p.paid_at) : '-'}${p.invoice_url ? ` · <a href="${p.invoice_url}" target="_blank">📄 חשבונית</a>` : ''}</div>
            </div>
            <div class="billing-amount">${formatMoney(p.amount)}</div>
            <div class="billing-status">
              <span class="status-pill ${p.status === 'success' ? 'status-approved' : p.status === 'failed' ? 'status-rejected' : 'status-sent'}">
                ${p.status === 'success' ? 'שולם' : p.status === 'failed' ? 'נכשל' : 'בהמתנה'}
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>` : '';
  
  // הצעת שדרוג (רק ל-Free)
  const upgradePricingHtml = isFree ? `
    <div style="margin-top:32px">
      <h2 style="font-size:24px;font-weight:800;margin-bottom:20px">שדרג ל-Pro</h2>
      <div class="pricing-grid">
        <div class="pricing-card">
          <div class="pricing-tier-label">חודשי</div>
          <div class="pricing-tier-name">גמישות מלאה</div>
          <div class="pricing-amount">
            <span class="pricing-amount-num">99</span>
            <span class="pricing-amount-currency">₪/חודש</span>
          </div>
          <div class="pricing-period">חיוב חודשי · ביטול בכל עת</div>
          <ul class="pricing-features">
            <li>הצעות ללא הגבלה</li>
            <li>הלוגו שלך על כל הצעה</li>
            <li>10 תמונות לפתח · הקלטה 3 דקות</li>
            <li>📄 דף ביצוע למפעל</li>
            <li>📧 שליחת PDF במייל</li>
          </ul>
          <button class="btn btn-accent" style="width:100%" onclick="startUpgrade('pro_monthly')">בחר Pro חודשי →</button>
        </div>
        
        <div class="pricing-card pro">
          <div class="pricing-badge-top">המומלץ · חיסכון 17%</div>
          <div class="pricing-tier-label">שנתי</div>
          <div class="pricing-tier-name">הכי משתלם</div>
          <div class="pricing-amount">
            <span class="pricing-amount-num">990</span>
            <span class="pricing-amount-currency">₪/שנה</span>
          </div>
          <div class="pricing-period">₪82.50 לחודש · חיסכון ₪198</div>
          <ul class="pricing-features">
            <li>הכל מהחודשי</li>
            <li>חיוב אחד בשנה</li>
            <li>גישה מוקדמת לפיצ'רים</li>
            <li>תמיכה אישית</li>
          </ul>
          <button class="btn btn-accent" style="width:100%" onclick="startUpgrade('pro_annual')">בחר Pro שנתי →</button>
        </div>
      </div>
    </div>` : '';
  
  document.getElementById('subscription-content').innerHTML = `
    <div class="${cardClass}">
      <div class="sub-tier-label">${tierLabel}</div>
      <div class="sub-tier-name">${tierName}</div>
      <div class="sub-meta-grid">
        ${metaItems.map(m => `
          <div class="sub-meta-item">
            <div class="sub-meta-label">${m.label}</div>
            <div class="sub-meta-value">${m.value}</div>
          </div>`).join('')}
      </div>
      <div class="sub-actions">${actions}</div>
    </div>
    ${usageHtml}
    ${paymentsHtml}
    ${upgradePricingHtml}
  `;
}

/**
 * קבלת המנוי הנוכחי
 */
async function getCurrentSubscription() {
  if (!currentUserId) return null;
  try {
    const { data } = await sb
      .from('subscriptions')
      .select('*')
      .eq('user_id', currentUserId)
      .in('status', ['active', 'canceling'])
      .maybeSingle();
    return data;
  } catch (e) {
    console.error('getCurrentSubscription error:', e);
    return null;
  }
}

async function saveSubscription(sub) {
  // לא שומרים ידנית — Webhook מ-Grow יעדכן אוטומטית
  console.log('saveSubscription called (handled by webhook)', sub);
}

// ============ UPGRADE FLOW (Grow / משולם) ============

const GROW_PAGE_MONTHLY = ''; // ← הכנס כאן את ה-Page Code החודשי מ-Grow
const GROW_PAGE_ANNUAL  = ''; // ← הכנס כאן את ה-Page Code השנתי מ-Grow

let upgradePlan = null;

function startUpgrade(plan) {
  upgradePlan = plan;
  const amount   = plan === 'pro_annual' ? 990 : 99;
  const label    = plan === 'pro_annual' ? 'Pro שנתי' : 'Pro חודשי';
  const pageCode = plan === 'pro_annual' ? GROW_PAGE_ANNUAL : GROW_PAGE_MONTHLY;
  
  // אם Grow עדיין לא מוגדר — הראה מודאל הסבר
  if (!pageCode) {
    showUpgradeModal(plan, amount, label);
    return;
  }
  
  // Grow redirect — עם פרמטרים לזיהוי המשתמש
  const returnUrl = encodeURIComponent(window.location.origin + '/?upgrade=success&plan=' + plan);
  const cancelUrl = encodeURIComponent(window.location.origin + '/?upgrade=cancel');
  
  const growUrl = `https://secure.meshulam.co.il/p/${pageCode}?` +
    `userId=${encodeURIComponent(currentUserId)}&` +
    `email=${encodeURIComponent(user.email || '')}&` +
    `fullName=${encodeURIComponent(user.name || '')}&` +
    `successUrl=${returnUrl}&` +
    `cancelUrl=${cancelUrl}`;
  
  window.location.href = growUrl;
}

// מודאל זמני כשGrow עדיין לא מוגדר
function showUpgradeModal(plan, amount, label) {
  const overlay = document.getElementById('payment-overlay');
  document.getElementById('payment-body').innerHTML = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:56px;margin-bottom:16px">⭐</div>
      <h2 style="font-size:24px;font-weight:800;margin-bottom:8px">${label} — ${formatMoney(amount)}</h2>
      <p style="color:var(--text-secondary);margin-bottom:24px;line-height:1.6">
        מערכת התשלומים (Grow) בהגדרה.<br>
        לשדרוג ידני — צור קשר:
      </p>
      <a href="https://wa.me/9720523159988?text=${encodeURIComponent(`שלום, אני רוצה לשדרג ל-ALUM(cm) ${label}`)}"
         target="_blank"
         class="btn btn-accent" style="display:inline-block;padding:14px 28px;text-decoration:none;font-size:16px;margin-bottom:12px">
        💬 שדרג דרך WhatsApp
      </a>
      <p style="font-size:12px;color:var(--text-muted)">
        לאחר אישור התשלום החשבון יעודכן תוך שעה
      </p>
      <button class="btn" style="margin-top:16px;width:100%" 
        onclick="document.getElementById('payment-overlay').classList.remove('show')">
        סגור
      </button>
    </div>
  `;
  overlay.classList.add('show');
}

// טיפול בחזרה מ-Grow אחרי תשלום
async function handleGrowReturn() {
  const params = new URLSearchParams(window.location.search);
  const upgradeStatus = params.get('upgrade');
  const plan = params.get('plan');
  
  if (!upgradeStatus) return;
  
  // נקה את ה-URL
  window.history.replaceState({}, '', window.location.pathname);
  
  if (upgradeStatus === 'success') {
    showToast('🎉 התשלום אושר! מעדכן חשבון...');
    
    // חכה שה-Webhook יעבד ואז רענן
    await sleep(3000);
    
    // טען מחדש את ה-profile
    const { data: profile } = await sb.from('profiles').select('plan').eq('id', currentUserId).maybeSingle();
    if (profile && profile.plan !== 'free') {
      user.plan = profile.plan;
      showToast('✅ שודרגת ל-Pro! ברוך הבא!');
      renderSubscriptionScreen();
    } else {
      showToast('התשלום עובר עיבוד... יעודכן תוך מספר דקות');
    }
  } else if (upgradeStatus === 'cancel') {
    showToast('התשלום בוטל');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function cancelSubscription() {
  confirmAction('ביטול מנוי', 'החשבון שלך יישאר פעיל עד סוף תקופת החיוב, ואז יעבור לחבילה חינמית. האם להמשיך?', async () => {
    try {
      const sub = await getCurrentSubscription();
      if (!sub) { showToast('לא נמצא מנוי פעיל'); return; }
      
      // עדכון ב-Supabase
      await sb.from('subscriptions').update({
        status: 'canceling',
        canceled_at: new Date().toISOString()
      }).eq('user_id', currentUserId);
      
      showToast('המנוי בוטל — פעיל עד ' + (sub.next_charge_at ? formatDate(sub.next_charge_at) : 'סוף התקופה'));
      
      // TODO: קריאה ל-Grow API לביטול הוראת קבע
      // בינתיים — יצירת קשר ידני
      
      renderSubscriptionScreen();
    } catch (e) {
      showToast('שגיאה: ' + e.message);
    }
  });
}

async function resumeSubscription() {
  try {
    await sb.from('subscriptions').update({
      status: 'active',
      canceled_at: null,
      ends_at: null
    }).eq('user_id', currentUserId);
    
    showToast('🎉 המנוי חודש!');
    renderSubscriptionScreen();
  } catch (e) {
    showToast('שגיאה: ' + e.message);
  }
}

function upgradeToPro() {
  startUpgrade('pro_monthly');
}

function closeModalAndNavigate() {
  document.getElementById('payment-overlay').classList.remove('show');
  showScreen('upgrade', document.querySelector('[data-screen="upgrade"]'));
}

function downloadInvoice() {
  window.print();
}

function showInvoice(invoiceUrl) {
  if (invoiceUrl && invoiceUrl.startsWith('http')) {
    window.open(invoiceUrl, '_blank');
  } else {
    showToast('חשבונית לא זמינה');
  }
}

// ============ WORK ORDER (דף ביצוע למפעל) ============
async function openWorkOrder() {
  // בדיקת Pro
  if (user.plan === 'free') {
    confirmAction('פיצ\'ר Pro', 'דף ביצוע למפעל זמין רק במנוי Pro. הדף מציג רשימת פריטים מסודרת לייצור עם מידות והערות, ללא מחירים. שדרג עכשיו?', () => {
      closeModal('modal-confirm');
      showScreen('upgrade', document.querySelector('[data-screen="upgrade"]'));
    });
    return;
  }
  
  const client = await dbGet('clients', currentQuote.clientId);
  const business = (await dbGet('settings', 'business'))?.value || {};
  
  document.getElementById('work-order-content').innerHTML = renderWorkOrder(currentQuote, client, business);
  showModal('modal-work-order');
}

function renderWorkOrder(quote, client, business) {
  // חישוב סטטיסטיקות מצרפיות
  const totalItems = quote.items.length;
  const totalUnits = quote.items.reduce((s, i) => s + (i.qty || 1), 0);
  const totalArea = quote.items.reduce((s, i) => {
    if (i.mode === 'area' && i.width && i.height) {
      return s + ((i.width * i.height) / 10000) * (i.qty || 1);
    }
    return s;
  }, 0);
  const itemsWithMedia = quote.items.filter(i => (i.media || []).length > 0).length;
  
  // חישוב חתכי פרופיל אוטומטיים (אורכי חיתוך)
  const cuts = calculateCuts(quote.items);
  
  return `
    <div class="work-order" id="work-order-print-area">
      <div class="work-order-header">
        <div>
          <div class="work-order-title">דף ביצוע למפעל</div>
          <div class="work-order-subtitle">WORK ORDER · FACTORY PRODUCTION</div>
          <div style="font-size:11px;color:#666;margin-top:4px">${escapeHTML(business.name || '')}</div>
        </div>
        <div class="work-order-meta">
          <div>הזמנה</div>
          <div class="work-order-meta-num">#${quote.number}</div>
          <div style="margin-top:8px">תאריך הזמנה: ${formatDate(quote.approvedAt || quote.createdAt)}</div>
          <div>תאריך הדפסה: ${formatDate(new Date().toISOString())}</div>
        </div>
      </div>
      
      <div class="work-order-info">
        <div>
          <div class="work-order-info-block-label">לקוח</div>
          <div class="work-order-info-block-value">${escapeHTML(client?.name || '')}</div>
          ${client?.phone ? `<div class="work-order-info-block-meta">📞 ${escapeHTML(client.phone)}</div>` : ''}
        </div>
        <div>
          <div class="work-order-info-block-label">כתובת התקנה</div>
          <div class="work-order-info-block-value" style="font-size:13px">${escapeHTML(client?.address || '—')}</div>
        </div>
      </div>
      
      <div class="work-order-summary-grid">
        <div class="work-order-summary-box">
          <div class="work-order-summary-label">פריטים</div>
          <div class="work-order-summary-value">${totalItems}</div>
        </div>
        <div class="work-order-summary-box">
          <div class="work-order-summary-label">יחידות</div>
          <div class="work-order-summary-value">${totalUnits}</div>
        </div>
        <div class="work-order-summary-box">
          <div class="work-order-summary-label">סה״כ מ״ר</div>
          <div class="work-order-summary-value">${totalArea.toFixed(2)}</div>
        </div>
        <div class="work-order-summary-box">
          <div class="work-order-summary-label">סטטוס</div>
          <div class="work-order-summary-value" style="font-size:14px;text-transform:uppercase">${STATUS_LABELS[quote.status]}</div>
        </div>
      </div>
      
      <div class="work-order-section-title">📐 רשימת פריטים לייצור</div>
      
      <table class="work-order-table">
        <thead>
          <tr>
            <th class="center" style="width:50px">#</th>
            <th>פריט</th>
            <th class="center" style="width:140px">מידות</th>
            <th class="center" style="width:60px">כמות</th>
            <th class="center" style="width:80px">שטח (מ״ר)</th>
            <th>פירוט / הערות</th>
          </tr>
        </thead>
        <tbody>
          ${quote.items.map((item, i) => {
            let dimensions = '—';
            let area = '—';
            if (item.width && item.height) {
              dimensions = `<div class="dimensions">${item.width} × ${item.height}</div><div class="dimensions-detail">רוחב × גובה (ס״מ)</div>`;
              const sqm = (item.width * item.height) / 10000;
              area = `${sqm.toFixed(2)} × ${item.qty || 1}<br><strong>${(sqm * (item.qty || 1)).toFixed(2)}</strong>`;
            }
            const hasMeasurements = item.mode === 'area' && item.width && item.height;
            const itemSvg = hasMeasurements ? renderWindowSVG(item.width, item.height) : '';
            return `
              <tr>
                <td class="num"><span class="item-num">${i+1}</span></td>
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    ${hasMeasurements ? `<div class="work-order-thumb">${itemSvg}</div>` : ''}
                    <div>
                      <div style="font-weight:700;font-size:14px">${escapeHTML(item.name)}</div>
                      ${item.mode === 'area' ? `<div style="font-size:10px;color:#999;margin-top:2px">תמחור לפי מ״ר</div>` : `<div style="font-size:10px;color:#999;margin-top:2px">מחיר קבוע</div>`}
                    </div>
                  </div>
                </td>
                <td class="num">${dimensions}</td>
                <td class="num">${item.qty || 1}</td>
                <td class="num">${area}</td>
                <td>
                  ${item.note ? escapeHTML(item.note) : '<span style="color:#aaa">—</span>'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      
      ${cuts.length > 0 ? `
        <div class="work-order-cuts">
          <div class="work-order-cuts-title">📋 הערה למפעל</div>
          <div style="font-size:12px;line-height:1.6">
            המידות לעיל הן <strong>מידות חיצוניות של הפתח</strong>. חישוב חתכי הפרופיל יבוצע במפעל לפי:
            <ul style="margin:8px 0;padding-right:20px;font-size:11px">
              <li>סוג הפרופיל הספציפי (7000 / 9000 / קליל / וכו׳)</li>
              <li>סוג הפתיחה (הזזה / ציר / נטוי)</li>
              <li>זווית החיתוך (45° / 90°)</li>
              <li>תוספת לעיבוד וריווח לזיגוג</li>
            </ul>
          </div>
        </div>
      ` : ''}
      
      ${quote.pricing.notes ? `
        <div class="work-order-notes">
          <strong>הערות מההצעה:</strong> ${escapeHTML(quote.pricing.notes)}
        </div>
      ` : ''}
      
      ${itemsWithMedia > 0 ? `
        <div class="work-order-section-title">📷 תמונות התקנה (${itemsWithMedia} פריטים)</div>
        ${quote.items.filter(i => (i.media || []).filter(m => m.type === 'photo').length > 0).map((item, i) => {
          const photos = (item.media || []).filter(m => m.type === 'photo');
          return `
            <div style="margin-bottom:14px">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px">פריט: ${escapeHTML(item.name)}</div>
              <div class="work-order-photos">
                ${photos.map(p => `<img class="work-order-photo" src="${p.data}" alt="">`).join('')}
              </div>
            </div>
          `;
        }).join('')}
      ` : ''}
      
      <div class="work-order-section-title">📋 הוראות לייצור</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr>
          <td style="padding:6px;border-bottom:1px solid #ddd;width:30%;color:#666">תאריך התחלת ייצור צפוי:</td>
          <td style="padding:6px;border-bottom:1px solid #ddd">_______________________</td>
        </tr>
        <tr>
          <td style="padding:6px;border-bottom:1px solid #ddd;color:#666">תאריך סיום ייצור צפוי:</td>
          <td style="padding:6px;border-bottom:1px solid #ddd">_______________________</td>
        </tr>
        <tr>
          <td style="padding:6px;border-bottom:1px solid #ddd;color:#666">צבע פרופיל:</td>
          <td style="padding:6px;border-bottom:1px solid #ddd">_______________________</td>
        </tr>
        <tr>
          <td style="padding:6px;border-bottom:1px solid #ddd;color:#666">סוג זכוכית:</td>
          <td style="padding:6px;border-bottom:1px solid #ddd">_______________________</td>
        </tr>
        <tr>
          <td style="padding:6px;color:#666">אביזרים:</td>
          <td style="padding:6px">_______________________</td>
        </tr>
      </table>
      
      <div class="work-order-signature">
        <div class="signature-box">חתימת מנהל ייצור</div>
        <div class="signature-box">חתימת בודק איכות</div>
        <div class="signature-box">חתימת מתקין</div>
      </div>
      
      <div class="work-order-footer-print">
        מסמך פנימי · ${escapeHTML(business.name || '')} · נוצר ע״י ALUM(cm)
      </div>
    </div>
  `;
}

// חישוב אורכי חיתוך פרופיל לפי מידות (פריימטרי)
function calculateCuts(items) {
  const cuts = [];
  items.forEach((item, idx) => {
    if (!item.width || !item.height) return;
    const qty = item.qty || 1;
    
    // חלון/דלת סטנדרטי: 2 אורכים אופקיים (רוחב) + 2 אורכים אנכיים (גובה)
    // יחידה אחת = 2×רוחב + 2×גובה
    const horizontalLength = item.width * 2 * qty;
    const verticalLength = item.height * 2 * qty;
    const totalLength = (horizontalLength + verticalLength) / 100; // ס״מ → מטר
    
    cuts.push({
      itemIdx: idx,
      name: item.name,
      cuts: `אופקי: ${(horizontalLength/100).toFixed(2)} מ׳ (${qty}×${item.width*2} ס״מ) | אנכי: ${(verticalLength/100).toFixed(2)} מ׳ (${qty}×${item.height*2} ס״מ) | סה״כ: ${totalLength.toFixed(2)} מ׳`
    });
  });
  return cuts;
}

function printWorkOrder() {
  document.body.classList.add('printing-work-order');
  // הזז את ה-print area ל-body root
  const printArea = document.getElementById('work-order-print-area');
  const originalParent = printArea.parentElement;
  document.body.appendChild(printArea);
  
  setTimeout(() => {
    window.print();
    
    setTimeout(() => {
      // החזר את ה-print area למקומו
      originalParent.appendChild(printArea);
      document.body.classList.remove('printing-work-order');
    }, 100);
  }, 100);
}
// ============ PRODUCT PROFILES ============

async function getProfiles(category) {
  const { data } = await sb
    .from('product_profiles')
    .select('*')
    .eq('user_id', currentUserId)
    .eq('category', category)
    .order('sort_order');
  return data || [];
}

async function addProfile(category, value) {
  const profiles = await getProfiles(category);
  const { error } = await sb.from('product_profiles').insert({
    id: uid(),
    user_id: currentUserId,
    category,
    value: value.trim(),
    sort_order: profiles.length
  });
  return !error;
}

async function deleteProfile(id) {
  await sb.from('product_profiles').delete().eq('id', id);
}
// ============ KEYBOARD HANDLING ============
// כשמתמקדים בשדה, ודא שהוא נראה גם כשהמקלדת פתוחה
function setupKeyboardHandling() {
  // עובד עם Visual Viewport API — תומך בכל הדפדפנים המודרניים
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) {
        setTimeout(() => {
          focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 100);
      }
    });
  }

  // גלילה אוטומטית כשמתמקדים בשדה במובייל
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      // חכה שהמקלדת תיפתח
      setTimeout(() => {
        e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 300);
    }
  });
}

// ============ INIT ============
async function init() {
  loadTheme();
  setupKeyboardHandling();
  
  // בדיקה שה-Supabase SDK נטען
  if (!window.supabase) {
    console.error('Supabase SDK not loaded');
    showToast('שגיאת טעינה — פתח את הקובץ דרך שרת (לא file://)');
    // הצג הודעה בולטת
    document.body.insertAdjacentHTML('afterbegin', `
      <div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#c44a4a;color:white;padding:16px;text-align:center;font-family:Heebo,sans-serif;direction:rtl;font-size:15px">
        ⚠️ לא ניתן להתחבר לשרת. וודא שהאתר נפתח מ-HTTPS (למשל alum-cm.co.il) ולא מקובץ מקומי.
        <button onclick="this.parentElement.remove()" style="margin-right:16px;background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 12px;border-radius:6px;cursor:pointer">✕</button>
      </div>`);
    return;
  }
  
  // בדיקת חזרה מ-Grow אחרי תשלום
  const params = new URLSearchParams(window.location.search);
  if (params.get('upgrade')) {
    setTimeout(handleGrowReturn, 1000);
  }
  
  // בדיקת URL ציבורי - הצעת מחיר לצפייה
  const publicQuoteToken = params.get('quote');
  if (publicQuoteToken) {
    await showPublicQuote(publicQuoteToken);
    return;
  }
  
  // בדיקת session קיים ב-Supabase
  try {
    const { data: { session } } = await sb.auth.getSession();
    
    if (session) {
      currentUserId = session.user.id;
const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
if (profile?.plan === 'suspended') {
  await sb.auth.signOut();
  document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;direction:rtl"><h2>החשבון שלך הושהה</h2><p>לפרטים נוספים צור קשר עם התמיכה.</p></div>';
  return null;
}      
      if (profile) {
        user = {
          id: profile.id,
          email: profile.email,
          name: profile.full_name,
          plan: profile.plan,
          createdAt: profile.created_at
        };
        enterApp();
      }
    }
  } catch (e) {
    console.error('Session check failed:', e);
    showToast('בעיית חיבור — בדוק את החיבור לאינטרנט');
  }
  
  // האזנה לשינויי auth
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUserId = null;
      user = null;
      goTo('landing');
    }
  });
}

// הצגת הצעה ציבורית (ללא התחברות)
async function showPublicQuote(token) {
  try {
   const { data: quote } = await sb
      .from('quotes')
      .select('*, quote_items(*)')
      .eq('public_token', token)
      .maybeSingle();
    
    if (!quote) {
      document.body.innerHTML = `
        <div style="text-align:center;padding:60px 20px;font-family:Heebo,sans-serif;direction:rtl">
          <h2 style="color:#0a1628;margin-bottom:12px">הצעה לא נמצאה</h2>
          <p style="color:#4a6b8a">הלינק שגוי או שההצעה הוסרה</p>
        </div>`;
      return;
    }
    
    // טעינת פרטי הלקוח
    if (quote.client_id) {
      const { data: client } = await sb
        .from('clients')
        .select('name, phone, address')
        .eq('id', quote.client_id)
        .maybeSingle();
      if (client) {
        quote.client_name = client.name;
        quote.client_phone = client.phone;
        quote.client_address = client.address;
      }
    }
    
    // טעינת פרטי העסק
    const { data: business } = await sb
      .from('business')
      .select('*')
      .eq('user_id', quote.user_id)
      .maybeSingle();
    
    // עדכון viewed_at
    if (!quote.viewed_at) {
      await sb.from('quotes').update({ 
        viewed_at: new Date().toISOString(),
        status: quote.status === 'sent' ? 'viewed' : quote.status
      }).eq('id', quote.id);
    }
    
   // הצגת ההצעה — חישוב נכון של מע"מ
    const items = quote.quote_items || [];
    const subtotal = items.reduce((s, it) => s + (parseFloat(it.total_price) || 0), 0);
    const discountPct = parseFloat(quote.discount_percent) || 0;
    const installFee = parseFloat(quote.install_fee) || 0;
    const vatPct = parseFloat(quote.vat_percent) || 18;
    
    const discountAmt = subtotal * (discountPct / 100);
    const beforeVat = subtotal - discountAmt + installFee;
    const vatAmt = beforeVat * (vatPct / 100);
    const total = beforeVat + vatAmt;
    
    document.body.innerHTML = `
      <div style="font-family:'Heebo',sans-serif;direction:rtl;max-width:700px;margin:0 auto;padding:20px;background:#fff;min-height:100vh">
        <div style="background:#0a1628;color:white;padding:24px 28px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:800;font-size:20px;margin-bottom:4px">${business?.name || 'העסק'}</div>
            <div style="font-size:12px;opacity:0.6">${business?.phone || ''} ${business?.email ? '· ' + business.email : ''}</div>
          </div>
          <div style="text-align:left">
            <div style="font-size:11px;opacity:0.6">הצעת מחיר</div>
            <div style="font-weight:700;font-size:18px">#${quote.quote_number || ''}</div>
          </div>
        </div>
        <div style="padding:24px 28px;background:#f8f9fb;border:1px solid rgba(0,0,0,0.08);border-top:none">
          <div style="font-size:11px;color:#4a6b8a;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">הצעה עבור</div>
          <div style="font-weight:800;font-size:22px;color:#0a1628;margin-bottom:0">${quote.client_name || 'לקוח'}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:0;border:1px solid rgba(0,0,0,0.08);border-top:none">
          <thead style="background:#0a1628;color:white">
            <tr>
              <th style="padding:10px 12px;text-align:right">#</th>
              <th style="padding:10px 12px;text-align:right">פריט</th>
              <th style="padding:10px 12px;text-align:right">מידות</th>
              <th style="padding:10px 12px;text-align:left">סכום</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, i) => `
              <tr style="border-bottom:1px solid rgba(0,0,0,0.06)">
                <td style="padding:12px;color:#7a96b8">${i+1}</td>
               <td style="padding:12px;font-weight:600">
                  ${it.name || ''}
                  ${it.profile_value ? `<br><span style="font-size:11px;color:#4a6b8a;font-weight:500">פרופיל ${it.profile_value}</span>` : ''}
                  ${it.note ? `<br><span style="font-size:11px;color:#4a6b8a;font-weight:400">${it.note}</span>` : ''}
                  <br><span style="font-size:11px;color:#7a96b8;font-weight:400">×${it.qty || 1}</span>
                </td>
                <td style="padding:12px;color:#4a6b8a">${it.width_cm ? it.width_cm + '×' + it.height_cm + ' ס״מ' : '-'}</td>
                <td style="padding:12px;text-align:left;font-weight:700;color:#3a7bd5">₪${parseFloat(it.total_price||0).toLocaleString()}</td>
              </tr>`).join('')}
          </tbody>
        </table>
       <div style="background:#f0f4fa;padding:20px 24px;border:1px solid rgba(0,0,0,0.08);border-top:none;border-radius:0 0 16px 16px">
          <div style="display:flex;justify-content:space-between;font-size:14px;color:#4a6b8a;margin-bottom:6px">
            <span>סכום ביניים</span><span>₪${subtotal.toLocaleString()}</span>
          </div>
          ${discountPct > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:14px;color:#4a8a4a;margin-bottom:6px">
            <span>הנחה (${discountPct}%)</span><span>−₪${discountAmt.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
          </div>` : ''}
          ${installFee > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:14px;color:#4a6b8a;margin-bottom:6px">
            <span>התקנה / משלוח</span><span>₪${installFee.toLocaleString()}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:14px;color:#4a6b8a;margin-bottom:6px">
            <span>מע״מ (${vatPct}%)</span><span>₪${vatAmt.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:800;color:#0a1628;margin-top:12px;padding-top:12px;border-top:2px solid #0a1628">
            <span>סה״כ לתשלום</span><span>₪${total.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
          </div>
          ${business?.terms ? `<div style="margin-top:16px;font-size:12px;color:#7a96b8;line-height:1.6">${business.terms}</div>` : ''}
        </div>
        <div style="text-align:center;padding:20px;font-size:12px;color:#b0b8c8;margin-top:16px">
          נשלח מ-<strong>ALUM(cm)</strong> — מערכת הצעות מחיר לאלומיניום
        </div>
      </div>`;
  } catch (e) {
    console.error('showPublicQuote error:', e);
    document.body.innerHTML = `<div style="text-align:center;padding:60px;font-family:Heebo,sans-serif;direction:rtl"><h2>שגיאה בטעינת ההצעה</h2></div>`;
  }
}

init();
function gTo(selector) {
  const el = document.querySelector(selector);
  if (el) {
    el.scrollIntoView({
      behavior: "smooth"
    });
  }
}
// ============ FORGOT PASSWORD ============

async function openForgotPassword() {
  const emailInLogin = document.getElementById('login-email')?.value?.trim();
  const email = prompt('הזן את כתובת המייל לאיפוס סיסמה:', emailInLogin || '');
  
  if (!email || !email.trim()) return;
  
  showToast('שולח...');
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email.trim());
    if (error) {
      showToast('שגיאה: ' + error.message);
      return;
    }
    showToast('אימייל איפוס נשלח ✓ בדוק את התיבה');
  } catch (e) {
    console.error('reset email error:', e);
    showToast('שגיאה: ' + e.message);
  }
}
