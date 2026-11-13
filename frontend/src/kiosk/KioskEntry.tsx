import { getKioskRuntime } from '../kiosk-host/runtime';
import KioskApp from './KioskApp';
import { Brand } from '../shared/ui';

export default function KioskEntry() {
  const runtime = getKioskRuntime();
  if (runtime.mode === 'blocked')
    return (
      <div className="kiosk-shell kiosk-v2">
        <header className="kiosk-header">
          <Brand />
        </header>
        <main className="kiosk-main">
          <section className="kiosk-title" role="alert">
            <h1>키오스크 연결을 확인해 주세요</h1>
            <p>{runtime.error}</p>
            <p>관리자에게 앱 설치 상태를 확인해 달라고 요청해 주세요.</p>
          </section>
        </main>
      </div>
    );
  return <KioskApp />;
}
