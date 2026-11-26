// Shrinks pasted or uploaded images before they are saved.

/* Shrink images before saving. Small PNGs stay PNG so diagrams and text stay sharp. */
export function compressImage(file, o) {
  o = o || {};
  const max = o.max || 1400, q = o.q || 0.86;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || 800, h0 = img.naturalHeight || 500;
        const s = Math.min(1, max / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        if (o.keepPng && file.type === 'image/png') {
          const png = c.toDataURL('image/png');
          if (png.length < 700000) { resolve(png); return; }
        }
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', q));
      } catch (err) { reject(err); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
