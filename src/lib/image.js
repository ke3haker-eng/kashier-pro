// اختيار صورة (من المعرض أو الكاميرا) وتصغيرها إلى JPEG خفيف لحفظها داخل قاعدة البيانات
export function pickImage({ max = 320, quality = 0.72, capture = false } = {}) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; if (capture) i.capture = 'environment';
    i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); try { res(await shrink(f, max, quality)); } catch { res(null); } };
    i.oncancel = () => res(null); i.click();
  });
}
export async function shrink(file, max = 320, quality = 0.72, type = 'image/jpeg') {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}
