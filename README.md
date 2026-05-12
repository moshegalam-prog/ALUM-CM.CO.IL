<div align="center">

# ALUM(cm)

### מערכת הצעות מחיר חכמה לחלונאי אלומיניום

[![Live Site](https://img.shields.io/badge/Live-alum--cm.co.il-d97757?style=for-the-badge)](https://www.alum-cm.co.il)
[![Status](https://img.shields.io/badge/Status-Production-success?style=for-the-badge)](#)
[![Hebrew](https://img.shields.io/badge/Lang-עברית-blue?style=for-the-badge)](#)

**מ-3 שעות הכנת הצעה — ל-3 דקות.**

</div>

---

## 🪟 מה זה ALUM(cm)?

ALUM(cm) היא מערכת SaaS מודרנית בעברית, שמיועדת לחלונאי אלומיניום בישראל. במקום לבנות הצעות מחיר ידנית ב-Word או Excel, הקבלן יוצר תוך דקות הצעה מעוצבת, מודדת אוטומטית את השטח, מחשבת מע"מ והנחות, ושולחת ב-WhatsApp עם PDF מצורף.

> 💡 **למי זה מתאים?** חלונאים עצמאיים, בעלי עסקים קטנים בתחום האלומיניום, ומפעלים קטנים שרוצים להציג עצמם בצורה מקצועית מול הלקוח.

---

## ✨ פיצ'רים ראשיים

### 🪟 הצעות מחיר מקצועיות
- חישוב **אוטומטי לפי מ"ר** או מחיר קבוע
- שרטוט אוטומטי של חלון/דלת לפי מידות
- תמחור מותאם — הנחה באחוזים, עלות התקנה, מע"מ
- מינימום מחיר ליחידה (למניעת הצעות מפסידות)
- 📷 צילום פתחים וצירוף תמונות לכל פריט
- 🎙 הקלטת הערות קוליות (Pro)

### 📤 שיתוף חכם
- **WhatsApp** — שליחת PDF + לינק ציבורי ללקוח
- **מייל** — שליחה אוטומטית עם קובץ מצורף
- **PDF** — הורדה ישירה
- 🔗 **קישור ציבורי** — הלקוח רואה גרסה מעוצבת בלי להירשם

### 📊 ניהול מלא
- מעקב סטטוסים: טיוטה → נשלחה → נצפתה → אושרה → בייצור → הותקנה
- היסטוריית שינויים עם תאריכי שלבים
- 👥 מאגר לקוחות עם היסטוריית הצעות
- 🔁 שכפול הצעות ב-קליק אחד
- 📄 **דף ביצוע למפעל** — פלט נפרד למפעל הייצור

### 🌓 עיצוב
- מצב **בהיר** + מצב **כהה** מלא
- 📱 רספונסיבי לכל מסך
- 🇮🇱 RTL מלא בעברית

---

## 💰 תמחור

<table>
<tr><th>חינמי</th><th>Pro חודשי</th><th>Pro שנתי</th></tr>
<tr><td valign="top">

**₪0/חודש**

- עד 5 הצעות בחודש
- כל הפיצ'רים הבסיסיים
- 2 תמונות לפתח
- הקלטה 30 שנייה

</td><td valign="top">

**₪99/חודש**

- ⭐ הצעות ללא הגבלה
- ⭐ הלוגו שלך על כל הצעה
- ⭐ 10 תמונות לפתח
- ⭐ הקלטה 3 דקות
- ⭐ דף ביצוע למפעל
- ⭐ שליחת PDF במייל

</td><td valign="top">

**₪990/שנה** (חיסכון 17%)

- 🌟 הכל מהחודשי
- 🌟 ₪82.50 לחודש
- 🌟 חיסכון של ₪198 בשנה
- 🌟 גישה מוקדמת לפיצ'רים
- 🌟 תמיכה אישית

</td></tr></table>

---

## 🚀 התחלה מהירה

1. כניסה ל-[**www.alum-cm.co.il**](https://www.alum-cm.co.il)
2. הירשם בחינם ב-30 שניות
3. הזן את פרטי העסק והלוגו
4. צור את ההצעה הראשונה — דקות בלבד

---

## 📸 צילומי מסך

> *(כאן יתווספו צילומים מהאתר החי)*

---

<details>
<summary><h2>🛠 תיעוד טכני (לפיתוח)</h2></summary>

### Stack
- **Frontend:** Vanilla JavaScript + HTML5 + CSS3 (ללא React/Vue — אפס build steps)
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage)
- **PDF:** jsPDF + html2canvas
- **Payments:** Grow / משולם (אינטגרציה דרך Edge Functions)
- **Hosting:** Static — alum-cm.co.il (Cloudflare/Netlify-ready)
- **PWA:** Service Worker + Manifest

### מבנה קבצים

```
ALUM-CM.CO.IL/
├── index.html             ← דף הראשי של האפליקציה
├── admin.html             ← פאנל אדמין (גישה דרך /admin.html)
├── js/
│   └── app.js             ← כל הלוגיקה — Supabase, UI, PDF
├── css/
│   └── style.css          ← עיצוב גלובלי
├── sw.js                  ← Service Worker (PWA)
├── manifest.json          ← PWA manifest
├── _headers               ← Cloudflare/Netlify security headers
├── .htaccess              ← Apache config (אם רלוונטי)
└── images/
    ├── favicon-*.png
    └── maskable-icon-*.png
```

### סכמת DB ב-Supabase

```
profiles          ← פרופיל משתמש (id, email, full_name, plan, trial_ends_at)
business          ← פרטי העסק (user_id, name, phone, logo_url, terms, ...)
clients           ← לקוחות (user_id, name, phone, email, address)
quotes            ← הצעות מחיר (user_id, client_id, quote_number, status, pricing, ...)
quote_items       ← פריטים בהצעה (quote_id, position, name, dimensions, prices)
item_media        ← תמונות והקלטות (item_id, type, url)
payments          ← תשלומים (user_id, plan, amount, status, paid_at)
subscriptions    ← מנויים פעילים (user_id, plan, status, next_charge_at)
admins            ← מנהלי המערכת (user_id, role, created_at)
```

הרשאות גישה (RLS) מוגדרות לכל טבלה כך שמשתמשים רואים רק את הנתונים שלהם, ואדמינים רואים הכל.

### הרצה מקומית

```bash
# 1. שכפול הריפו
git clone https://github.com/moshegalam-prog/ALUM-CM.CO.IL.git
cd ALUM-CM.CO.IL

# 2. אין צורך ב-npm install — אין dependencies!

# 3. הרץ שרת מקומי (חובה — לא לפתוח כ-file://):
python3 -m http.server 8000
# או:
npx serve .

# 4. פתח בדפדפן:
# http://localhost:8000
```

### הגדרת Supabase

1. צור פרויקט חדש ב-[supabase.com](https://supabase.com)
2. תחת **SQL Editor** — הרץ את הסקריפט [`admin-setup.sql`](./admin-setup.sql) (אם קיים) או צור ידנית את הטבלאות לפי הסכמה למעלה
3. תחת **Storage** — צור 3 buckets: `logos`, `photos`, `audio` (ציבוריים)
4. עדכן ב-`js/app.js`:
   ```javascript
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGc...';
   ```

### פאנל ניהול (Admin)

הפאנל זמין ב-`/admin.html`. לאחר התחברות, המערכת בודקת בטבלת `admins` האם המשתמש מורשה.

**הוספת אדמין ראשון:**
```sql
INSERT INTO admins (user_id, email, full_name, role)
SELECT id, email, raw_user_meta_data->>'full_name', 'superadmin'
FROM auth.users WHERE email = 'YOUR_EMAIL@example.com';
```

**יכולות הפאנל:**
- 📊 דשבורד עם MRR, סה"כ משתמשים, Pro/Free
- 👥 רשימת משתמשים מלאה עם חיפוש וסינון
- 💰 היסטוריית תשלומים
- 🔑 ניהול מנהלים נוספים (superadmin בלבד)
- ⭐ שדרוג ידני / ביטול מנוי

### פריסה (Deployment)

האתר הוא **סטטי** לחלוטין — אפשר לפרוס לכל שירות:

- **Cloudflare Pages:** התחבר ל-GitHub, פרוס `main`
- **Netlify:** Drag & drop של תיקיית הפרויקט
- **Vercel:** `vercel deploy`
- **שרת רגיל:** העלאת קבצים דרך FTP

> 💡 שים לב שה-`sw.js` (Service Worker) מטמין קבצים — אחרי deploy חדש, גשו ל-DevTools → Application → Unregister Service Worker או המתינו שהמטמון יתחדש מעצמו.

### Environment

אין משתני סביבה — כל ההגדרות מקודדות ב-`js/app.js` כי המפתח `anon` של Supabase ציבורי בטבעו (מוגן ע"י RLS).

</details>

---

## 📝 רישיון

© 2026 [Moshe Galam](https://github.com/moshegalam-prog). כל הזכויות שמורות.

---

## 📞 יצירת קשר

- 🌐 [www.alum-cm.co.il](https://www.alum-cm.co.il)
- 📧 [moshegalam@gmail.com](mailto:moshegalam@gmail.com)
- 💬 [WhatsApp](https://wa.me/972523159988)

<div align="center">

**נבנה באהבה בישראל 🇮🇱**

</div>
