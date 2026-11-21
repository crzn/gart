/** Predefined avatar library. Participants never upload photos; artwork is added in Phase 5. */
export const AVATAR_IDS = [
  "fox", "owl", "bear", "wolf", "lynx", "otter", "panda", "koala",
  "tiger", "eagle", "whale", "dolphin", "falcon", "hedgehog", "badger", "raven",
  "rabbit", "deer", "seal", "heron", "bison", "gecko", "crane", "swan",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export function isAvatarId(value: string): value is AvatarId {
  return (AVATAR_IDS as readonly string[]).includes(value);
}
