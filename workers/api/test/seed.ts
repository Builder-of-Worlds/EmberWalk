import { env } from "cloudflare:workers";

const VISITOR = "a".repeat(64);

export const seedWalk = async (id: string, state: string, step: string | null = null): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO walks (id, visitor_id, state, step, language, jurisdiction, device_camera, device_width, device_height) VALUES (?, ?, ?, ?, 'en', 'us_ca', 'rear', 1920, 1080)",
  )
    .bind(id, VISITOR, state, step)
    .run();
};

export const walkState = async (id: string): Promise<string | null> => {
  const row = await env.DB.prepare("SELECT state FROM walks WHERE id = ?").bind(id).first<{ state: string }>();
  return row === null ? null : row.state;
};

export const clearWalks = async (): Promise<void> => {
  await env.DB.prepare("DELETE FROM walks").run();
};
