const { BrowserWindow, ipcMain, dialog, shell, app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { defaults, validateConfig, atomicWrite } = require("./profile.cjs");
const {
  createHttpsClient,
  certificateInfo,
  connectionMessage,
} = require("./https-client.cjs");
const URL = "tagback://operator/index.html";
function installOperator(ctx) {
  let panel,
    unlockedUntil = 0,
    busy = false;
  const bootstrap = () =>
    !ctx.config() || !ctx.hasSecret() || process.argv.includes("--configure");
  const allowed = () => bootstrap() || Date.now() < unlockedUntil;
  const assertAllowed = () => {
    if (!allowed()) throw Error("관리자 비밀번호로 먼저 잠금을 해제하세요.");
  };
  const publicState = () => ({
    version: app.getVersion(),
    config: { ...(ctx.config() || defaults) },
    unlocked: allowed(),
    configured: !!ctx.config(),
    keyReady: ctx.hasSecret(),
    reader: ctx.readerStatus(),
    pending: ctx.transport().pendingSummary(),
    recoveryLocked: ctx.recoveryLocked(),
    startup: app.getLoginItemSettings().openAtLogin,
  });
  async function authenticate(credentials) {
    const { adminNumber, password } = credentials || {};
    if (!/^[0-9]{3}$/.test(adminNumber))
      throw Error("관리자 번호를 입력하세요.");
    if (
      typeof password !== "string" ||
      !password.length ||
      password.length > 128
    )
      throw Error("관리자 비밀번호를 입력하세요.");
    const cfg = ctx.config() || defaults,
      client = createHttpsClient(cfg.apiBaseUrl, cfg.certificate);
    try {
      const response = await client(
        cfg.apiBaseUrl + "/api/v1/kiosk/admin/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminNumber, password }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw Error(
          response.status === 429
            ? "로그인 시도가 많습니다. 1분 뒤 다시 시도하세요."
            : "관리자 인증에 실패했습니다. 비밀번호와 서버 설정을 확인하세요.",
        );
      const data = await response.json();
      if (data.mustChangePassword)
        throw Error("키오스크 관리자 화면에서 먼저 비밀번호를 변경하세요.");
      if (typeof data.token !== "string")
        throw Error("관리자 응답을 확인하지 못했습니다.");
      await client(cfg.apiBaseUrl + "/api/v1/kiosk/admin/logout", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + data.token,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      unlockedUntil = Date.now() + 5 * 60 * 1000;
    } finally {
      client.close();
    }
  }
  ipcMain.handle("operator:action", async (event, action, input) => {
    if (
      !panel ||
      event.sender !== panel.webContents ||
      event.senderFrame !== panel.webContents.mainFrame ||
      event.senderFrame.url !== URL
    )
      throw Error("UNTRUSTED_SENDER");
    if (busy)
      return { ok: false, message: "이전 작업이 끝날 때까지 기다려 주세요." };
    busy = true;
    try {
      let value;
      switch (action) {
        case "state":
          value = publicState();
          break;
        case "unlock":
          await authenticate(input);
          value = publicState();
          break;
        case "diagnose": {
          const cfg = allowed()
            ? validateConfig(input)
            : ctx.config() || defaults;
          const client = createHttpsClient(cfg.apiBaseUrl, cfg.certificate),
            start = Date.now();
          try {
            const response = await client(
              cfg.apiBaseUrl + "/api/v1/kiosk/health",
              { signal: AbortSignal.timeout(8000) },
            );
            value = {
              server: response.ok ? "connected" : "error",
              message: response.ok
                ? `서버 연결 정상 · ${Date.now() - start}ms`
                : `서버 응답 오류 (${response.status}). 서버 관리자에게 문의하세요.`,
              reader: ctx.readerStatus(),
              keyReady: ctx.hasSecret(),
            };
          } catch (error) {
            value = {
              server: "error",
              message: connectionMessage(error),
              reader: ctx.readerStatus(),
              keyReady: ctx.hasSecret(),
            };
          } finally {
            client.close();
          }
          break;
        }
        case "certificate": {
          assertAllowed();
          const selected = await dialog.showOpenDialog(panel, {
            title: "관리자가 제공한 서버/CA 인증서 선택",
            properties: ["openFile"],
            filters: [{ name: "PEM 인증서", extensions: ["crt", "pem"] }],
          });
          if (selected.canceled) {
            value = null;
            break;
          }
          const file = selected.filePaths[0];
          if (fs.statSync(file).size > 65536)
            throw Error("인증서 파일이 너무 큽니다.");
          const certificate = fs.readFileSync(file, "utf8"),
            info = certificateInfo(certificate);
          const answer = await dialog.showMessageBox(panel, {
            type: "question",
            title: "앱 전용 인증서 확인",
            message: info.subject,
            detail: `SHA-256: ${info.fingerprint}\n유효기간: ${info.validTo}\n이 인증서는 저장한 서버에만 적용됩니다. 관리자가 제공한 지문과 대조하세요.`,
            buttons: ["취소", "이 인증서 사용"],
            defaultId: 0,
            cancelId: 0,
          });
          value = answer.response === 1 ? { certificate, info } : null;
          break;
        }
        case "save": {
          assertAllowed();
          if (ctx.transport().hasPending() || ctx.recoveryLocked())
            throw Error(
              "미확인 거래를 먼저 확인하세요. 설정은 아직 변경하지 않았습니다.",
            );
          const cfg = validateConfig(input.config),
            secret = input.secret;
          if (
            typeof secret !== "string" ||
            (secret &&
              (Buffer.byteLength(secret) < 32 ||
                Buffer.byteLength(secret) > 4096))
          )
            throw Error("리더기 서명 키는 32~4096바이트로 입력하세요.");
          if (!ctx.hasSecret() && !secret)
            throw Error("최초 설정에는 리더기 서명 키가 필요합니다.");
          if (
            ctx.config() &&
            cfg.apiBaseUrl !== ctx.config().apiBaseUrl &&
            !secret
          )
            throw Error(
              "서버를 변경할 때는 해당 서버의 리더기 서명 키를 함께 입력하세요.",
            );
          await ctx.save(cfg, secret);
          unlockedUntil = 0;
          value = publicState();
          break;
        }
        case "reader-restart":
          assertAllowed();
          if (ctx.transport().hasPending() || ctx.recoveryLocked())
            throw Error("미확인 거래를 먼저 확인하세요.");
          ctx.restartReader();
          value = publicState();
          break;
        case "readers":
          assertAllowed();
          value = await ctx.listReaders();
          break;
        case "retry": {
          assertAllowed();
          if (!ctx.recoveryLocked())
            throw Error("진행 중인 화면의 결과 확인 버튼을 이용하세요.");
          try {
            const result = await ctx.transport().recover(input || "");
            if (!result) throw Error("복구 기록이 없거나 손상되었습니다.");
            value = {
              message: "서버 응답을 확인했습니다. 거래 ID와 상태를 확인하세요.",
              result,
            };
            ctx.recovered();
          } catch {
            throw Error(
              "아직 결과를 확정하지 못했습니다. 네트워크를 확인하세요. 인증 만료 시 관리자 웹에서 해당 물품의 기록을 확인한 뒤 수동 확인을 진행하세요.",
            );
          }
          break;
        }
        case "reconcile": {
          // Only restart recovery can be reconciled here; never clear an in-flight renderer write.
          assertAllowed();
          if (!ctx.recoveryLocked() || !ctx.transport().pendingSummary())
            throw Error("수동 확인할 복구 거래가 없습니다.");
          if (
            typeof input?.reason !== "string" ||
            input.reason.trim().length < 10 ||
            input.reason.length > 500 ||
            input.confirmed !== true
          )
            throw Error(
              "관리자 웹의 거래 결과를 확인하고 확인 내용(10자 이상)을 입력하세요.",
            );
          // Fresh server authentication is required even for --configure/first-run sessions.
          await authenticate(input);
          const answer = await dialog.showMessageBox(panel, {
            type: "warning",
            message: "서버의 실제 거래 기록과 물품 상태를 확인했나요?",
            detail:
              "이 작업은 서버 거래를 취소하거나 성공 처리하지 않습니다. 확인 기록을 남긴 뒤 이 기기의 이용 제한만 해제합니다.",
            buttons: ["취소", "확인 기록 후 운영 재개"],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response !== 1) {
            value = null;
            break;
          }
          const audit = {
            ...ctx.transport().pendingSummary(),
            checkedAt: new Date().toISOString(),
            reason: input.reason.trim(),
          };
          fs.appendFileSync(
            path.join(ctx.profileDir, "operator-reconciliation.jsonl"),
            JSON.stringify(audit) + "\n",
          );
          ctx.transport().acknowledgeReconciliation();
          ctx.recovered();
          value = publicState();
          break;
        }
        case "admin-web":
          await shell.openExternal(
            (ctx.config() || defaults).apiBaseUrl + "/admin",
          );
          value = null;
          break;
        case "export": {
          assertAllowed();
          const save = await dialog.showSaveDialog(panel, {
            defaultPath: "TagBack-connection-diagnostics.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (!save.canceled) {
            const state = publicState();
            delete state.config.certificate;
            atomicWrite(
              save.filePath,
              JSON.stringify(
                { capturedAt: new Date().toISOString(), ...state },
                null,
                2,
              ),
            );
          }
          value = null;
          break;
        }
        default:
          throw Error("지원하지 않는 작업입니다.");
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        message: /CERT|INVALID_|ONE_CERT/.test(error.message)
          ? "설정 형식 또는 인증서 유효기간을 확인하세요. HTTPS 주소와 올바른 인증서가 필요합니다."
          : error.message,
      };
    } finally {
      busy = false;
    }
  });
  return function open() {
    if (panel && !panel.isDestroyed()) {
      panel.focus();
      return;
    }
    panel = new BrowserWindow({
      parent: ctx.window,
      modal: true,
      width: 1000,
      height: 850,
      minWidth: 740,
      minHeight: 600,
      title: "TagBack 연결·설정",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "operator-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: !app.isPackaged,
      },
    });
    panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    panel.webContents.on("will-navigate", (event, url) => {
      if (url !== URL) event.preventDefault();
    });
    panel.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    panel.on("closed", () => {
      panel = null;
      unlockedUntil = 0;
    });
    panel.loadURL(URL);
  };
}
module.exports = { installOperator };
