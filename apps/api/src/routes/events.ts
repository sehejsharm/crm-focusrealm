import { Router } from "express";
import { eventsSince } from "../lib/bus.js";

/** Live updates by short polling (works on serverless hosting too). */
export const events = Router();

events.get("/events", async (req, res) => {
  const raw = req.query.after;
  const after = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
  res.setHeader("Cache-Control", "no-store");
  res.json(await eventsSince(req.user!, after));
});
