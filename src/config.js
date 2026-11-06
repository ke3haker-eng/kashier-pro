// إعداد الربط مع Supabase (اختياري). اتركه فارغاً لتعمل كل الأجهزة بالوضع المحلي كما كانت.
//
// إن أردت أن تتصل كل الأجهزة بنفس مشروع Supabase دون إدخال البيانات يدوياً في كل جهاز، ضع القيمتين هنا
// ثم ارفع الملف إلى GitHub:
//   url     : Project URL، شكله  https://abcdxyz.supabase.co
//   anonKey : المفتاح العام  (anon public  أو  publishable) من  Project Settings ← API
//
// تنبيه أمان مهم: هذا المفتاح العام يظهر لكل من يفتح الموقع — وهذا طبيعي ومقصود في Supabase، والحماية الحقيقية
// في تسجيل الدخول وقواعد قاعدة البيانات (supabase/schema.sql). ممنوع منعاً باتاً وضع مفتاح service_role أو
// secret هنا أو في أي مكان بالمستودع.
export default {
  supabase: {
    url: '',
    anonKey: '',
  },
};
