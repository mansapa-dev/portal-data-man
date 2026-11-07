const maxImageBytes = 2 * 1024 * 1024;
const maxImageDimension = 1200;

export async function resizeQuestionImage(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Gunakan gambar PNG, JPEG, WebP, atau GIF.');
  }
  // Keep GIF animation intact; the browser limits its displayed dimensions.
  if (file.type === 'image/gif') {
    if (file.size > maxImageBytes) throw new Error('GIF maksimal 2 MB. Gunakan PNG/JPEG/WebP untuk pengecilan otomatis.');
    return file;
  }
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Gambar tidak dapat dibuka oleh browser.'));
      image.src = objectUrl;
    });
    if (file.size <= maxImageBytes && Math.max(image.naturalWidth, image.naturalHeight) <= maxImageDimension) return file;
    const canvas = document.createElement('canvas');
    for (const limit of [1200, 900, 720, 540]) {
      const ratio = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Gambar tidak dapat diproses oleh browser.');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob?.type === 'image/webp' && blob.size <= maxImageBytes) {
          return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
        }
      }
    }
    throw new Error('Gambar masih lebih dari 2 MB setelah diperkecil. Pilih gambar dengan detail lebih sederhana.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function imageBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

export async function resizeQuestionDataUrl(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Format gambar soal tidak didukung.');
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const file = await resizeQuestionImage(new File([bytes], 'gambar-soal', { type: match[1] }));
  return `data:${file.type};base64,${await imageBase64(file)}`;
}
