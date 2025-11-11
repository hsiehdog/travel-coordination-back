import type { IncomingHttpHeaders } from "http";
import type { Request as ExpressRequest } from "express";

export const headersFromExpress = (headers: IncomingHttpHeaders): Headers => {
  const target = new Headers();
  Object.entries(headers).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      target.append(key, value.join(", "));
      return;
    }
    target.append(key, value);
  });
  return target;
};

type NodeRequestInit = RequestInit & { duplex?: "half" };

export const buildRequestFromExpress = (req: ExpressRequest, body?: Buffer): Request => {
  const headers = headersFromExpress(req.headers);
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const init: NodeRequestInit = {
    method: req.method,
    headers,
  };

  if (body && body.length > 0 && req.method !== "GET" && req.method !== "HEAD") {
    const normalizedBody: Uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body);
    init.body = normalizedBody as unknown as BodyInit;
    init.duplex = "half";
  }

  return new Request(url, init);
};
