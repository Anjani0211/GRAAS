/**
 * India cyber-fraud assist helpers — offline tables + deep-links.
 * No CAPTCHA bypass; portals are opened by analysts.
 */

/** Common watch districts often cited in mule / call-centre reporting (curated, not exhaustive). */
const WATCH_DISTRICTS = new Set([
  "deoghar",
  "jamtara",
  "giridih",
  "dhanbad",
  "bokaro",
  "godda",
  "dumka",
  "baharampur",
  "murshidabad",
]);

/** Sample PIN prefix → district (extend offline; first 3 digits of PIN often regional). */
const PIN_PREFIX_DISTRICT: Record<string, { state: string; district: string }> = {
  "814": { state: "Jharkhand", district: "Deoghar" },
  "815": { state: "Jharkhand", district: "Jamtara" },
  "825": { state: "Jharkhand", district: "Hazaribagh" },
  "826": { state: "Jharkhand", district: "Dhanbad" },
  "827": { state: "Jharkhand", district: "Bokaro" },
  "700": { state: "West Bengal", district: "Kolkata" },
  "110": { state: "Delhi", district: "New Delhi" },
  "400": { state: "Maharashtra", district: "Mumbai" },
  "560": { state: "Karnataka", district: "Bengaluru" },
  "600": { state: "Tamil Nadu", district: "Chennai" },
  "500": { state: "Telangana", district: "Hyderabad" },
};

const GSTIN_RE = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const PIN_RE = /\b[1-9][0-9]{5}\b/g;

export function extractGstins(text: string): string[] {
  return [...new Set((text.toUpperCase().match(GSTIN_RE) ?? []))];
}

export function extractPins(text: string): string[] {
  return [...new Set((text.match(PIN_RE) ?? []))];
}

export function lookupPinAssist(pin: string): {
  pin: string;
  state?: string;
  district?: string;
  watchBelt: boolean;
  flags: string[];
} {
  const clean = pin.replace(/\D/g, "").slice(0, 6);
  const prefix = clean.slice(0, 3);
  const hit = PIN_PREFIX_DISTRICT[prefix];
  const district = hit?.district;
  const watchBelt = Boolean(district && WATCH_DISTRICTS.has(district.toLowerCase()));
  const flags: string[] = [];
  if (watchBelt) flags.push("WATCH_DISTRICT_BELT");
  if (!hit) flags.push("PIN_REGION_UNKNOWN");
  return {
    pin: clean,
    state: hit?.state,
    district,
    watchBelt,
    flags,
  };
}

export function phoneAssistLinks(phone: string): {
  digits: string;
  links: Record<string, string>;
  flags: string[];
  seriesNotes: string[];
} {
  const digits = phone.replace(/\D/g, "").replace(/^91/, "").replace(/^0/, "");
  const flags: string[] = [];
  const seriesNotes: string[] = [];

  if (/^80\d{8}$/.test(digits) || phone.trim().startsWith("080")) {
    flags.push("SERIES_080_LANDLINE_STYLE");
    seriesNotes.push("080-series / Bangalore STD style — check spoofing vs genuine landline");
  }
  if (/^[6-9]\d{9}$/.test(digits)) {
    seriesNotes.push("Indian mobile format");
  } else if (digits.length >= 8) {
    flags.push("NONSTANDARD_PHONE_SHAPE");
  }

  const q = encodeURIComponent(digits || phone);
  return {
    digits,
    links: {
      sanchar_saathi: "https://sancharsaathi.gov.in/",
      chakshu: "https://sancharsaathi.gov.in/",
      truecaller_search: `https://www.truecaller.com/search/in/${q}`,
      google_dork: `https://www.google.com/search?q=${encodeURIComponent(`"${digits}" scam OR fraud OR UPI OR cyber`)}`,
      cybercrime_portal: "https://www.cybercrime.gov.in/",
    },
    flags,
    seriesNotes,
  };
}

export function merchantAssistLinks(query: string): Record<string, string> {
  const q = encodeURIComponent(query.trim());
  return {
    gst_portal: "https://www.gst.gov.in/",
    gst_search: `https://www.google.com/search?q=${encodeURIComponent(`${query} GSTIN`)}`,
    mca21: "https://www.mca.gov.in/content/mca/global/en/home.html",
    zauba: `https://www.zaubacorp.com/companysearchresults/${q}`,
  };
}

export function escalationDeepLinks(caseNumber: string): Array<{
  id: string;
  label: string;
  url: string;
  note: string;
}> {
  return [
    {
      id: "ncrp",
      label: "National Cybercrime Portal",
      url: "https://www.cybercrime.gov.in/",
      note: "File / track complaint; attach GRAAS escalation pack",
    },
    {
      id: "helpline_1930",
      label: "Cyber Fraud Helpline 1930",
      url: "https://www.cybercrime.gov.in/",
      note: "Immediate financial fraud reporting guidance",
    },
    {
      id: "sanchar_saathi",
      label: "Sanchar Saathi / Chakshu",
      url: "https://sancharsaathi.gov.in/",
      note: "Report / check suspected numbers",
    },
    {
      id: "i4c",
      label: "I4C / Suspect Registry (reference)",
      url: "https://i4c.mha.gov.in/",
      note: `Reference case ${caseNumber} when coordinating LE`,
    },
  ];
}

export { GSTIN_RE, PIN_RE, WATCH_DISTRICTS };
