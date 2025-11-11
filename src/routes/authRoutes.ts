import express, { Router } from "express";
import type { RequestHandler } from "express";
import { auth } from "../lib/auth";
import { buildRequestFromExpress } from "../utils/http";

const router = Router();

router.use(express.raw({ type: "*/*" }));

const proxyAuthRequest: RequestHandler = async (req, res, next) => {
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : undefined;
    const request = buildRequestFromExpress(req, body);
    const response = await auth.handler(request);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    res.status(response.status);

    if (response.body) {
      const data = Buffer.from(await response.arrayBuffer());
      res.send(data);
      return;
    }

    res.end();
  } catch (error) {
    next(error);
  }
};

router.use(proxyAuthRequest);

export default router;
