import { createHash } from "crypto";
import { safeHttp } from "../../../utils/httpClient";
import { searchPublicProfiles, type UsernameCheck } from "./usernameSearch";

export function gravatarHash(email: string): string {
  return createHash("md5").update(email.trim().toLowerCase()).digest("hex");
}

export function emailLocalPart(email: string): string | null {
  const local = email.split("@")[0]?.trim().replace(/^\.+|\.+$/g, "") ?? "";
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(local)) return null;
  return local;
}

export interface EmailFootprint {
  email: string;
  gravatarHash: string;
  gravatarUrl: string;
  hasGravatar: boolean | null;
  localPart: string | null;
  profileChecks: UsernameCheck[];
  likelyProfiles: string[];
}

/**
 * Public email footprint: Gravatar image existence plus the local-part
 * checked as a username. Does not use Google cookies or paid APIs.
 */
export async function publicEmailFootprint(email: string): Promise<EmailFootprint> {
  const hash = gravatarHash(email);
  const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404`;
  let hasGravatar: boolean | null = null;
  try {
    const response = await safeHttp.get(gravatarUrl, {
      timeout: 6000,
      maxRedirects: 2,
      responseType: "arraybuffer",
      maxContentLength: 200_000,
      validateStatus: (status) => status < 500,
    });
    if (response.status === 200) hasGravatar = true;
    else if (response.status === 404) hasGravatar = false;
  } catch {
    hasGravatar = null;
  }

  const localPart = emailLocalPart(email);
  const profiles = localPart ? await searchPublicProfiles(localPart) : null;

  return {
    email,
    gravatarHash: hash,
    gravatarUrl,
    hasGravatar,
    localPart,
    profileChecks: profiles?.checks ?? [],
    likelyProfiles: profiles?.likelyProfiles ?? [],
  };
}
