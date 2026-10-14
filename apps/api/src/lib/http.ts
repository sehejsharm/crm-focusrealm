import type { NextFunction, Request, Response } from "express";
import { z, ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = "You don't have access to that") => new HttpError(403, msg);
export const notFound = (what = "Not found") => new HttpError(404, what);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Parses and validates a request body/query with zod, throwing a 400 on failure. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw badRequest(`${where}${issue?.message ?? "Invalid request"}`, r.error.issues);
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const pgCode = (err as { code?: string })?.code;
  if (pgCode === "23505") {
    res.status(409).json({ error: "That conflicts with an existing record" });
    return;
  }
  console.error("[api] unhandled error", err);
  res.status(500).json({ error: "Something went wrong on our side" });
}

// Small shared zod pieces.
export const zId = z.string().uuid();
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const zPage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
