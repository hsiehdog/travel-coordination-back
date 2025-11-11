import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes";
import authRouter from "./routes/authRoutes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { isProduction } from "./config/env";
import { attachAuthContext } from "./middleware/authMiddleware";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(morgan(isProduction ? "combined" : "dev"));
app.use("/auth", authRouter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(attachAuthContext);

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
