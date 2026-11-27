import { useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { kioskRequest } from '../kiosk-host/transport';
export function ItemPicture({ src, alt = '' }: { src?: string; alt?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (!src) return;
    const id = src.match(/^\/api\/v1\/catalog\/images\/([0-9a-f-]{36})$/i)?.[1];
    if (!id) return;
    if (window.tagbackKioskHost?.version === 2) {
      void kioskRequest({ action: 'image', imageId: id })
        .then(async (r) => {
          const data: any = await r.json();
          if (
            alive &&
            r.ok &&
            typeof data?.dataUrl === 'string' &&
            data.dataUrl.startsWith('data:image/png;base64,')
          )
            setUrl(data.dataUrl);
        })
        .catch(() => {});
    } else setUrl(src);
    return () => {
      alive = false;
    };
  }, [src]);
  return url ? (
    <img src={url} alt={alt} onError={() => setUrl(undefined)} />
  ) : (
    <Box size={64} aria-label={alt || undefined} />
  );
}
