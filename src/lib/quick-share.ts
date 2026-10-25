import { readCard, suggestedSlug } from "./creator-card";

export type ShareKind = "model" | "dataset";
export const shareFormats = {
  model: ["gguf", "mlx", "safetensors", "other"],
  dataset: ["jsonl", "parquet", "csv", "json", "other"],
} as const;
export const formatLabels: Record<string, string> = {
  gguf: "GGUF",
  mlx: "MLX",
  safetensors: "Safetensors",
  jsonl: "JSONL",
  parquet: "Parquet",
  csv: "CSV / TSV",
  json: "JSON",
  other: "Other / not sure",
};

export function detectShareFormat(
  kind: ShareKind,
  paths: string[],
  library = "",
): string {
  if (kind === "model" && library.toLowerCase().includes("mlx")) return "mlx";
  const lower = paths.map((path) => path.toLowerCase());
  const extensions =
    kind === "model"
      ? ["gguf", "safetensors"]
      : ["jsonl", "parquet", "csv", "json"];
  const matches = extensions.filter((ext) =>
    lower.some(
      (path) =>
        path.endsWith(`.${ext}`) || (ext === "csv" && path.endsWith(".tsv")),
    ),
  );
  return matches.length === 1 ? matches[0] : "other";
}

export function quickTitle(
  files: Array<{ name: string; webkitRelativePath?: string }>,
) {
  const first = files[0];
  if (!first) return "";
  return (
    first.webkitRelativePath?.split("/")[0] ||
    first.name.replace(/\.[^.]+$/, "")
  )
    .replace(/[_-]+/g, " ")
    .slice(0, 200);
}

export function quickSlug(title: string, key: string) {
  return `${suggestedSlug(title).slice(0, 80) || "shared-work"}-${key.replaceAll("-", "").slice(0, 10)}`;
}

export function shareSize(bytes: number, locale = "en") {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index =
    bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${(bytes / 1024 ** index).toLocaleString(locale, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

export function quickCard(
  kind: ShareKind,
  title: string,
  format: string,
  license: string,
  source: string,
) {
  // Facts supplied by the member only. Never invent inference or evaluation evidence.
  const plain = (value: string) =>
    value.replace(/[\r\n<>]/g, " ").replace(/([\\`*_[\]#])/g, "\\$1");
  return `# ${plain(title)}\n\nA shared ${kind} package${format !== "other" ? ` in ${plain(formatLabels[format] ?? format)} format` : ""}.\n\nDownload the complete package to keep its files and folders together.\n\n## License\n\n${plain(license)}\n${source ? `\n## Source\n\n${plain(source)}\n` : ""}\n## Usage and limitations\n\nThe contributor has not supplied additional usage instructions or evaluation results yet. Required software and hardware depend on the files in this release.\n`;
}

export function cardSuggestions(card: string) {
  return readCard(card);
}

/** Accept only Google Drive file/folder share URLs; never arbitrary fetch targets. */
export function canonicalDriveLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "drive.google.com" ||
      url.port ||
      url.username ||
      url.password ||
      raw.length > 2048
    )
      return null;
    const file = url.pathname.match(
      /^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/view)?\/?$/,
    );
    const folder = url.pathname.match(
      /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})\/?$/,
    );
    const id =
      file?.[1] ??
      folder?.[1] ??
      (url.pathname === "/open" ? url.searchParams.get("id") : null);
    if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) return null;
    const result = new URL(
      folder
        ? `https://drive.google.com/drive/folders/${id}`
        : `https://drive.google.com/file/d/${id}/view`,
    );
    const resourceKey = url.searchParams.get("resourcekey");
    if (resourceKey) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(resourceKey)) return null;
      result.searchParams.set("resourcekey", resourceKey);
    }
    return result.href;
  } catch {
    return null;
  }
}

/** Same safe relative path boundary as the runtime object store. */
export function validPackagePath(path: string) {
  return Boolean(
    path &&
    path === path.trim() &&
    path === path.normalize("NFC") &&
    new TextEncoder().encode(path).length <= 1024 &&
    !/[\\\u0000-\u001f\u007f]/.test(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split("/").some((part) => !part || part === "." || part === ".."),
  );
}
