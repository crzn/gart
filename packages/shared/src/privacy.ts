import { z } from "zod";

/** How long finished games (nicknames, answers, scores) are kept. 0 keeps them until a person deletes them. */
export const RETENTION_CHOICES = [30, 90, 365, 0] as const;

export const PrivacySchema = z.object({
  retentionDays: z.number().int().refine((n) => (RETENTION_CHOICES as readonly number[]).includes(n)),
  /** Who people write to about their data: shown on the privacy page. */
  contact: z.string().trim().max(200),
  /** Extra text from the owner, shown at the end of the privacy page. */
  note: z.string().trim().max(2000),
});
export type Privacy = z.infer<typeof PrivacySchema>;

export const DEFAULT_PRIVACY: Privacy = { retentionDays: 365, contact: "", note: "" };
