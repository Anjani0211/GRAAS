/**
 * Curated public profile checks (Sherlock / Blackbird style).
 * A profile counts as present only when the site returns HTTP 200 and the
 * body does not contain that site's known "not found" marker.
 * This is a short list, not a copy of the 400-site Sherlock catalog.
 */

export interface UsernameSite {
  name: string;
  /** `{username}` is replaced with the encoded handle. */
  urlTemplate: string;
  /** Case-insensitive substrings that mean the account does not exist. */
  absentMarkers?: string[];
  /** Statuses that mean the account does not exist. Default [404]. */
  absentStatuses?: number[];
}

export const USERNAME_SITES: UsernameSite[] = [
  { name: "GitHub", urlTemplate: "https://github.com/{username}" },
  { name: "GitLab", urlTemplate: "https://gitlab.com/{username}" },
  { name: "Reddit", urlTemplate: "https://www.reddit.com/user/{username}", absentMarkers: ["page not found", "nobody on reddit goes by"] },
  { name: "Telegram", urlTemplate: "https://t.me/{username}", absentMarkers: ["if you have telegram, you can contact"] },
  { name: "Medium", urlTemplate: "https://medium.com/@{username}" },
  { name: "Dev.to", urlTemplate: "https://dev.to/{username}" },
  { name: "Hacker News", urlTemplate: "https://news.ycombinator.com/user?id={username}", absentMarkers: ["no such user"] },
  { name: "Keybase", urlTemplate: "https://keybase.io/{username}" },
  { name: "Docker Hub", urlTemplate: "https://hub.docker.com/u/{username}" },
  { name: "npm", urlTemplate: "https://www.npmjs.com/~{username}" },
  { name: "PyPI", urlTemplate: "https://pypi.org/user/{username}" },
  { name: "Hugging Face", urlTemplate: "https://huggingface.co/{username}" },
  { name: "Linktree", urlTemplate: "https://linktr.ee/{username}" },
  { name: "YouTube", urlTemplate: "https://www.youtube.com/@{username}" },
  { name: "Twitch", urlTemplate: "https://www.twitch.tv/{username}" },
  { name: "Mastodon", urlTemplate: "https://mastodon.social/@{username}" },
  { name: "Pastebin", urlTemplate: "https://pastebin.com/u/{username}" },
  { name: "Chess.com", urlTemplate: "https://www.chess.com/member/{username}" },
  { name: "Flickr", urlTemplate: "https://www.flickr.com/people/{username}" },
  { name: "Vimeo", urlTemplate: "https://vimeo.com/{username}" },
  { name: "Steam", urlTemplate: "https://steamcommunity.com/id/{username}", absentMarkers: ["the specified profile could not be found"] },
  { name: "Wikipedia", urlTemplate: "https://en.wikipedia.org/wiki/User:{username}" },
  { name: "Replit", urlTemplate: "https://replit.com/@{username}" },
  { name: "Kaggle", urlTemplate: "https://www.kaggle.com/{username}" },
];

export type ProfileVerdict = "found" | "missing" | "unknown";

export function profileUrl(site: UsernameSite, username: string): string {
  return site.urlTemplate.replaceAll("{username}", encodeURIComponent(username));
}

export function classifyProfileResponse(
  site: UsernameSite,
  status: number | null,
  bodySnippet: string,
): ProfileVerdict {
  if (status == null) return "unknown";
  const absentStatuses = site.absentStatuses ?? [404];
  if (absentStatuses.includes(status)) return "missing";
  if (status === 401 || status === 403 || status === 429 || status >= 500) return "unknown";
  if (status < 200 || status >= 300) return "unknown";
  const hay = bodySnippet.toLowerCase();
  for (const marker of site.absentMarkers ?? []) {
    if (marker && hay.includes(marker.toLowerCase())) return "missing";
  }
  return "found";
}
