import { runtimeValue } from "./db";
import { sigmaCopy } from "./sigma-copy";
import {
  escapeSigmaHtml as esc,
  sigmaTranslation,
  type SigmaDocument,
  type SigmaLocale,
} from "./sigma-input";
export type SigmaMailConfig = {
  key: string;
  from: string;
  origin: string;
  secret: string;
};
export function sigmaMailConfig(locals: App.Locals): SigmaMailConfig | null {
  const key = runtimeValue(locals, "RESEND_API_KEY");
  const from = runtimeValue(locals, "SIGMA_EMAIL_FROM");
  const secret = runtimeValue(locals, "SIGMA_TOKEN_SECRET");
  const origin =
    runtimeValue(locals, "SIGMA_PUBLIC_ORIGIN") ?? "https://superii.site";
  if (
    !key ||
    !from ||
    !secret ||
    secret.length < 32 ||
    !/^https:\/\/[^/]+$/.test(origin) ||
    /[\r\n]/.test(from)
  )
    return null;
  return { key, from, secret, origin };
}
async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function sigmaToken(
  secret: string,
  purpose: "confirm" | "manage",
  id: string,
  nonce: string,
) {
  const data = new TextEncoder().encode(
    `sigma-v1\n${purpose}\n${id}\n${nonce}`,
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    data,
  );
  return `${id}.${nonce}.${Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
export async function verifySigmaToken(
  secret: string,
  purpose: "confirm" | "manage",
  token: string,
) {
  const match = token.match(
    /^([a-f0-9-]{36})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/,
  );
  if (!match) return null;
  const [, id, nonce, signature] = match;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16)),
    new TextEncoder().encode(`sigma-v1\n${purpose}\n${id}\n${nonce}`),
  );
  return valid ? { id, nonce } : null;
}
export class SigmaMailError extends Error {
  constructor(public definitive: boolean) {
    super("sigma_delivery_unavailable");
  }
}
export async function sendSigmaMail(
  config: SigmaMailConfig,
  mail: {
    to: string;
    subject: string;
    html: string;
    text: string;
    key: string;
    unsubscribe?: string;
  },
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      "Idempotency-Key": mail.key,
    },
    body: JSON.stringify({
      from: config.from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.unsubscribe
        ? {
            headers: {
              "List-Unsubscribe": `<${mail.unsubscribe}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    }),
  });
  if (!response.ok)
    throw new SigmaMailError(
      response.status >= 400 &&
        response.status < 500 &&
        ![408, 409, 429].includes(response.status),
    );
  const result = (await response.json()) as { id?: string };
  if (!result.id) throw new SigmaMailError(false);
  return result.id;
}
function frame(body: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f3ed;color:#20344b;font-family:Arial,sans-serif"><div style="max-width:580px;margin:32px auto;padding:28px;background:#fffdf6;border:2px solid #20344b"><div style="background:#c2ff38;padding:16px;font-size:24px;font-weight:bold">👾 Super ii · Sigma News</div>${body}<hr><p style="font-size:13px">${footer}</p></div></body></html>`;
}
export function sigmaConfirmation(locale: SigmaLocale, href: string) {
  const c = sigmaCopy(locale);
  return {
    subject: c.confirmTitle,
    html: frame(
      `<h1 style="font-size:22px">${esc(c.confirmTitle)}</h1><p>${esc(c.confirmBody)}</p><p><a href="${esc(href)}">${esc(c.confirm)}</a></p>`,
      esc(c.emailIgnore),
    ),
    text: `${c.confirmTitle}\n\n${c.confirmBody}\n\n${href}\n\n${c.emailIgnore}`,
  };
}
export type SigmaEditionStory = {
  id: string;
  owner: string;
  slug: string;
  document: SigmaDocument;
};
export function sigmaDigest(
  locale: SigmaLocale,
  stories: SigmaEditionStory[],
  origin: string,
  manage: string,
  date: string,
) {
  const c = sigmaCopy(locale);
  const prefix = locale === "en" ? "" : locale === "ru" ? "/ru" : "/zh-cn";
  const entries = stories.map((story) => {
    const selected = sigmaTranslation(story.document, locale);
    const href = `${origin}${prefix}/sigma/${encodeURIComponent(story.owner)}/${encodeURIComponent(story.slug)}`;
    return { ...selected, href };
  });
  const subject = `Sigma News · ${date.slice(0, 10)}`;
  return {
    subject,
    html: frame(
      `<p>${esc(c.emailIntro)}</p>${entries.map(({ text, fallback, href }) => `<h2 style="font-size:20px"><a href="${esc(href)}">${esc(text.title)}</a></h2><p>${esc(text.summary)}</p>${fallback ? `<small>${esc(c.original)}</small>` : ""}`).join("")}`,
      `<a href="${esc(manage)}">${esc(c.preferences)} · ${esc(c.unsubscribe)}</a>`,
    ),
    text: `${subject}\n${c.emailIntro}\n\n${entries.map(({ text, fallback, href }) => `${text.title}\n${text.summary}\n${fallback ? c.original + "\n" : ""}${href}`).join("\n\n")}\n\n${c.preferences}: ${manage}`,
  };
}
