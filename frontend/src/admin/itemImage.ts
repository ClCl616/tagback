// Normalize uploads before storing in the local mock database.
export async function readItemImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('JPG, PNG, WEBP 이미지만 선택할 수 있습니다.');
  if (file.size > 5 * 1024 * 1024) throw new Error('5MB 이하의 이미지를 선택해 주세요.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('이미지를 읽을 수 없습니다. 다른 파일을 선택해 주세요.');
  }
  try {
    const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지를 처리할 수 없습니다. 다시 시도해 주세요.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.8);
    if (result.length > 700_000)
      throw new Error('이미지가 너무 복잡하거나 큽니다. 더 작은 이미지를 선택해 주세요.');
    return result;
  } finally {
    bitmap.close();
  }
}
