export interface NfcAdapter {
  subscribe(listener: (tag: string) => void): () => void;
}
// Only /dev/simulator publishes these events. Replace this adapter after hardware transport is agreed.
export const nfc: NfcAdapter = {
  subscribe(listener) {
    const channel = new BroadcastChannel('tagback-nfc');
    channel.onmessage = (e) => {
      if (typeof e.data?.tag === 'string') listener(e.data.tag);
    };
    return () => channel.close();
  },
};
export function emitTag(tag: string) {
  const channel = new BroadcastChannel('tagback-nfc');
  channel.postMessage({ tag });
  channel.close();
}
