const { randomUUID } = require("node:crypto");
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const id = (value) =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
const uid = (value) =>
  typeof value === "string" &&
  /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(value);
const code = (value) => typeof value === "string" && /^[0-9]{6}$/.test(value);
const fields = (obj, names) =>
  obj &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.keys(obj).sort().join(",") === names.split(" ").sort().join(",");
function proof(p) {
  return (
    fields(p, "bridgeId uid issuedAt nonce signature") &&
    uid(p.uid) &&
    uuid(p.nonce) &&
    typeof p.bridgeId === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(p.bridgeId) &&
    Number.isSafeInteger(p.issuedAt) &&
    p.issuedAt > 0 &&
    typeof p.signature === "string" &&
    /^[0-9a-f]{64}$/i.test(p.signature)
  );
}
function validate(request) {
  if (
    !fields(request, "version requestId command") ||
    request.version !== 2 ||
    !uuid(request.requestId)
  )
    throw Error("INVALID_REQUEST");
  const c = request.command;
  const schemas = {
    "admin-login": "action adminNumber password",
    "admin-api": "action adminRef path method body",
    "admin-session": "action adminRef",
    "admin-logout": "action adminRef",
    "admin-items": "action adminRef keyword page pending",
    "admin-tag-current": "action adminRef itemId",
    "admin-tag": "action adminRef operationId itemId expectedUid proof",
    image: "action imageId",
    health: "action",
    verify: "action code",
    catalog: "action grantRef",
    scan: "action uid grantRef",
    rent: "action operationId grantRef itemId itemTypeId",
    "return-scan": "action proof",
    return: "action operationId scanTicketId proof condition returnCode",
  };
  if (
    !c ||
    !Object.hasOwn(schemas, c.action) ||
    !fields(
      c,
      schemas[c.action] +
        (c.action === "return" && "grantRef" in c ? " grantRef" : ""),
    )
  )
    throw Error("INVALID_COMMAND");
  if (c.action === "image" && !uuid(c.imageId)) throw Error("INVALID_COMMAND");
  if (c.action === "admin-api" && !adminRoute(c.path, c.method, c.body))
    throw Error("INVALID_COMMAND");
  if ("adminNumber" in c && !/^[0-9]{3}$/.test(c.adminNumber))
    throw Error("INVALID_COMMAND");
  if (
    ("adminRef" in c && !uuid(c.adminRef)) ||
    ("password" in c &&
      (typeof c.password !== "string" ||
        !c.password.length ||
        c.password.length > 128)) ||
    ("keyword" in c &&
      (typeof c.keyword !== "string" || c.keyword.length > 100)) ||
    ("page" in c &&
      (!Number.isSafeInteger(c.page) || c.page < 0 || c.page > 100000)) ||
    ("pending" in c && typeof c.pending !== "boolean") ||
    ("expectedUid" in c && c.expectedUid !== null && !uid(c.expectedUid))
  )
    throw Error("INVALID_COMMAND");
  if (
    ("grantRef" in c && !uuid(c.grantRef)) ||
    ("operationId" in c && !uuid(c.operationId)) ||
    ("itemId" in c && !id(c.itemId)) ||
    ("itemTypeId" in c && !id(c.itemTypeId)) ||
    ("uid" in c && !uid(c.uid)) ||
    ("code" in c && !code(c.code)) ||
    ("returnCode" in c && !code(c.returnCode)) ||
    ("scanTicketId" in c && !uuid(c.scanTicketId)) ||
    ("proof" in c && !proof(c.proof)) ||
    ("condition" in c && !["NORMAL", "DAMAGED"].includes(c.condition))
  )
    throw Error("INVALID_COMMAND");
  return c;
}
function adminRoute(path, method, body) {
  if (
    typeof path !== "string" ||
    path.length > 2000 ||
    !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)
  )
    return false;
  const [route, query] = path.split("?");
  if (
    path.split("?").length > 2 ||
    (query && !/^[A-Za-z0-9_%=&+.,~-]*$/.test(query))
  )
    return false;
  const read =
    /^\/api\/(?:v1\/(?:items(?:\/[1-9][0-9]*)?|item-types|admin\/(?:auth\/session|accounts|access-log|items|users(?:\/[1-9][0-9]*(?:\/rentals)?)?|rentals(?:\/[1-9][0-9]*)?|items\/[1-9][0-9]*\/(?:status-history|rentals)))|items\/[1-9][0-9]*\/tag)$/;
  if (method === "GET") return read.test(route);
  if (JSON.stringify(body).length > 2800100) return false;
  return (
    (method === "POST" &&
      /^\/api\/v1\/(?:items|admin\/(?:accounts|auth\/password|auth\/logout))$/.test(
        route,
      )) ||
    (method === "PATCH" &&
      /^\/api\/v1\/(?:items\/[1-9][0-9]*(?:\/status)?|admin\/accounts\/[0-9]{3})$/.test(
        route,
      )) ||
    (["PUT", "DELETE"].includes(method) &&
      /^\/api\/v1\/(?:items|item-types)\/[1-9][0-9]*\/image$/.test(route)) ||
    (method === "DELETE" && /^\/api\/v1\/items\/[1-9][0-9]*$/.test(route))
  );
}
function apiOrigin(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw Error("INVALID_API_ORIGIN");
  return u.origin;
}
const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
function receipt(c, d, ticket) {
  if (c.action === "admin-tag")
    return (
      d?.itemId === c.itemId &&
      d.uid === c.proof.uid &&
      ["AVAILABLE", "INSPECTION", "REPAIR", "NOT_APPLIED"].includes(d.status)
    );
  if (
    !d ||
    !id(d.rentalId) ||
    !id(d.itemId) ||
    !date(d.rentedAt) ||
    !date(d.dueAt)
  )
    return false;
  if (c.action === "rent")
    return (
      d.itemId === c.itemId &&
      d.itemTypeId === c.itemTypeId &&
      d.rentalStatus === "RENTED" &&
      d.itemStatus === "RENTED"
    );
  return (
    ticket &&
    d.itemId === ticket.itemId &&
    d.rentalId === ticket.rentalId &&
    d.rentalStatus === "RETURNED" &&
    d.itemStatus === (c.condition === "NORMAL" ? "AVAILABLE" : "INSPECTION") &&
    d.condition === c.condition &&
    date(d.returnedAt)
  );
}
// Optional encrypted journal is supplied by the Windows main process.
function createTransport(origin, fetcher = fetch, journal) {
  const base = origin ? apiOrigin(origin) : null;
  const grants = new Map(),
    tickets = new Map(),
    finished = new Map();
  let pending, admin;
  const saved = journal?.load();
  if (saved) {
    if (
      saved.version !== 1 ||
      saved.origin !== base ||
      !saved.pending?.command ||
      !Array.isArray(saved.grants) ||
      !Array.isArray(saved.tickets)
    )
      throw Error("JOURNAL_INVALID");
    validate({
      version: 2,
      requestId: randomUUID(),
      command: saved.pending.command,
    });
    for (const [key, value] of saved.grants) grants.set(key, value);
    for (const [key, value] of saved.tickets) tickets.set(key, value);
    admin = saved.admin;
    pending = { ...saved.pending, unknown: true };
  }
  function persist() {
    journal?.save(
      pending
        ? {
            version: 1,
            origin: base,
            pending: {
              id: pending.id,
              fingerprint: pending.fingerprint,
              grantRef: pending.grantRef,
              adminTag: pending.adminTag,
              unknown: true,
              command: pending.command,
              createdAt: pending.createdAt,
            },
            grants: [...grants],
            tickets: [...tickets],
            admin,
          }
        : null,
    );
  }
  async function execute(c) {
    if (!base) throw Error("HOST_NOT_CONFIGURED");
    let route, body, token, method;
    if ("grantRef" in c) {
      token = grants.get(c.grantRef)?.token;
      if (!token) throw Error("UNKNOWN_GRANT");
    }
    if ("adminRef" in c) {
      if (!admin || admin.handle !== c.adminRef)
        throw Error("ADMIN_SESSION_REQUIRED");
      token = admin.token;
    }
    switch (c.action) {
      case "admin-api":
        route = c.path;
        method = c.method;
        body = c.body ?? undefined;
        break;
      case "admin-login":
        route = "/api/v1/kiosk/admin/login";
        body = { adminNumber: c.adminNumber, password: c.password };
        break;
      case "admin-session":
        route = "/api/v1/kiosk/admin/session";
        break;
      case "admin-logout":
        route = "/api/v1/kiosk/admin/logout";
        body = {};
        break;
      case "admin-items":
        route = `/api/v1/kiosk/admin/items?keyword=${encodeURIComponent(c.keyword)}&page=${c.page}&pending=${c.pending}`;
        break;
      case "admin-tag-current":
        route = `/api/v1/kiosk/admin/items/${c.itemId}/tag`;
        break;
      case "admin-tag":
        route = "/api/v1/kiosk/admin/tags";
        body = {
          operationId: c.operationId,
          itemId: c.itemId,
          expectedUid: c.expectedUid,
          proof: c.proof,
        };
        break;
      case "image":
        route = "/api/v1/catalog/images/" + c.imageId;
        break;
      case "health":
        route = "/api/v1/kiosk/health";
        break;
      case "verify":
        route = "/api/v1/kiosk/rental-grants";
        body = { code: c.code };
        break;
      case "catalog":
        route = "/api/v1/item-types";
        break;
      case "scan":
        route = `/api/tags/${c.uid}`;
        break;
      case "rent":
        route = "/api/v1/rentals";
        body = { itemId: c.itemId, itemTypeId: c.itemTypeId };
        break;
      case "return-scan":
        route = "/api/v1/rentals/return/scan";
        body = { proof: c.proof };
        break;
      case "return":
        route = "/api/v1/rentals/return";
        body = {
          scanTicketId: c.scanTicketId,
          proof: c.proof,
          condition: c.condition,
          returnCode: c.returnCode,
          ...(token ? { grantToken: token } : {}),
        };
        break;
    }
    const response = await fetcher(base + route, {
      method: method || (body ? "POST" : "GET"),
      redirect: "error",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...("adminRef" in c ? { "X-TagBack-Admin": "1" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(c.action === "rent" ? { "Idempotency-Key": c.operationId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(c.action === "health" ? 2500 : 14000),
    });
    // Bounded stream, including responses without Content-Length.
    let size = 0;
    const chunks = [];
    if (response.body)
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > (c.action === "image" ? 4 * 1024 * 1024 : 2 * 1024 * 1024))
          throw Error("RESPONSE_TOO_LARGE");
        chunks.push(Buffer.from(chunk));
      }
    if (c.action === "image")
      return {
        status: response.status,
        data: response.ok
          ? {
              dataUrl:
                "data:image/png;base64," +
                Buffer.concat(chunks).toString("base64"),
            }
          : null,
      };
    const responseText = Buffer.concat(chunks).toString("utf8");
    // Health is ResponseEntity<Void>; business responses still require valid JSON.
    let data =
      (response.status === 204 ||
        c.action === "health" ||
        c.action === "admin-logout") &&
      !responseText.trim()
        ? null
        : JSON.parse(responseText);
    if (response.ok && c.action === "admin-login") {
      if (
        typeof data?.token !== "string" ||
        !data.token.length ||
        !uuid(data.sessionId) ||
        !date(data.expiresAt)
      )
        throw Error("INVALID_ADMIN_RESPONSE");
      admin = { handle: randomUUID(), token: data.token };
      data = {
        adminHandle: admin.handle,
        sessionId: data.sessionId,
        expiresAt: data.expiresAt,
        adminNumber: data.adminNumber,
        name: data.name,
        mustChangePassword: data.mustChangePassword,
      };
    }
    if (c.action === "admin-logout" && (response.ok || response.status === 401))
      admin = undefined;
    if (response.ok && c.action === "verify") {
      if (
        typeof data?.token !== "string" ||
        !data.token.length ||
        data.token.length > 8192 ||
        typeof data.maskedPhoneNumber !== "string" ||
        !date(data.expiresAt)
      )
        throw Error("INVALID_GRANT_RESPONSE");
      for (const [key, g] of grants)
        if (g.expiresAt < Date.now() && pending?.grantRef !== key)
          grants.delete(key);
      if (grants.size >= 32) throw Error("GRANT_CAPACITY");
      const handle = randomUUID();
      grants.set(handle, {
        token: data.token,
        expiresAt: Date.parse(data.expiresAt),
      });
      data = {
        grantHandle: handle,
        maskedPhoneNumber: data.maskedPhoneNumber,
        expiresAt: data.expiresAt,
      };
    }
    if (response.ok && c.action === "return-scan") {
      if (!uuid(data?.scanTicketId) || !id(data.itemId) || !id(data.rentalId))
        throw Error("INVALID_TICKET_RESPONSE");
      if (tickets.size >= 32) tickets.delete(tickets.keys().next().value);
      tickets.set(data.scanTicketId, {
        itemId: data.itemId,
        rentalId: data.rentalId,
      });
    }
    return { status: response.status, data };
  }
  const host = {
    hasPending: () => !!pending,
    pendingSummary: () =>
      pending
        ? {
            operationId: pending.id,
            action: pending.command.action,
            itemId:
              pending.command.itemId ||
              tickets.get(pending.command.scanTicketId)?.itemId,
            createdAt: pending.createdAt,
          }
        : null,
    async recover(credentials) {
      if (!pending) return null;
      let command = { ...pending.command };
      if (command.action === "admin-tag") {
        const login = await execute({ action: "admin-login", ...credentials });
        if (login.status !== 200 && login.status !== 201)
          throw Error("ADMIN_LOGIN_FAILED");
        command.adminRef = admin.handle;
      }
      return host.request({ version: 2, requestId: randomUUID(), command });
    },
    acknowledgeReconciliation() {
      if (pending?.promise) throw Error("OPERATION_BUSY");
      journal?.save(null);
      pending = undefined;
    },
    async request(request) {
      const c = validate(request),
        write =
          c.action === "rent" ||
          c.action === "return" ||
          c.action === "admin-tag";
      if (c.action === "admin-tag" && (!admin || admin.handle !== c.adminRef))
        throw Error("ADMIN_SESSION_REQUIRED");
      const wrap = (result) => ({
        version: 2,
        requestId: request.requestId,
        ...result,
      });
      if (!write) {
        if (
          pending &&
          c.action !== "health" &&
          !(
            pending.adminTag &&
            ["admin-login", "admin-session"].includes(c.action)
          )
        )
          throw Error("OPERATION_UNRESOLVED");
        return wrap(await execute(c));
      }
      // Canonical keys, independent of IPC object property order.
      const fingerprint = JSON.stringify(
        Object.fromEntries(
          Object.keys(c)
            .filter((k) => c.action !== "admin-tag" || k !== "adminRef")
            .sort()
            .map((k) => [k, c[k]]),
        ),
      );
      const old = finished.get(c.operationId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw Error("OPERATION_CHANGED");
        return wrap(old.result);
      }
      if (
        pending &&
        (pending.id !== c.operationId || pending.fingerprint !== fingerprint)
      )
        throw Error("OPERATION_UNRESOLVED");
      if (!pending)
        pending = {
          id: c.operationId,
          fingerprint,
          grantRef: c.grantRef,
          adminTag: c.action === "admin-tag",
          unknown: false,
          command: c,
          createdAt: new Date().toISOString(),
        };
      const operation = pending;
      // Flush before sending any write. A failed local save must never send the request.
      if (!operation.promise) persist();
      if (!operation.promise)
        operation.promise = (async () => {
          try {
            const result = await execute(c);
            const confirmed =
              result.status >= 200 &&
              result.status < 300 &&
              receipt(c, result.data, tickets.get(c.scanTicketId));
            const rejected =
              !operation.unknown &&
              result.status >= 400 &&
              result.status < 500 &&
              typeof result.data?.error?.code === "string";
            if (confirmed || rejected) {
              journal?.save(null);
              finished.set(c.operationId, { fingerprint, result });
              if (finished.size > 32)
                finished.delete(finished.keys().next().value);
              pending = undefined;
            } else {
              operation.unknown = true;
              throw Error("OPERATION_UNKNOWN");
            }
            return result;
          } catch {
            operation.unknown = true;
            throw Error("OPERATION_UNKNOWN");
          } finally {
            operation.promise = undefined;
          }
        })();
      return wrap(await operation.promise);
    },
  };
  return host;
}
module.exports = { createTransport, validate, apiOrigin, proof };
