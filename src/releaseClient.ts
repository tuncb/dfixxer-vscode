import { RuntimePlatform } from "./managedPaths";

const githubReleasesApiUrl = "https://api.github.com/repos/tuncb/dfixxer/releases?per_page=20";

interface GitHubReleaseApiAsset {
  browser_download_url: string;
  content_type: string;
  name: string;
  size: number;
}

interface GitHubReleaseApiRecord {
  assets: GitHubReleaseApiAsset[];
  draft: boolean;
  name: string;
  prerelease: boolean;
  published_at: string | null;
  tag_name: string;
}

export interface ReleaseAsset {
  contentType: string;
  downloadUrl: string;
  name: string;
  size: number;
}

export interface ReleaseRecord {
  assets: ReleaseAsset[];
  draft: boolean;
  name: string;
  prerelease: boolean;
  publishedAt: string | null;
  tagName: string;
}

export interface CompatibleReleaseAsset {
  archiveType: "tar.gz" | "zip";
  assetName: string;
  downloadUrl: string;
  releaseName: string;
  releaseTag: string;
  size: number;
}

interface PlatformAssetMapping {
  archiveBaseName: string;
  archiveType: CompatibleReleaseAsset["archiveType"];
}

export async function fetchDfixxerReleases(
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseRecord[]> {
  const response = await fetchImpl(githubReleasesApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "dfixxer-vscode",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release query failed with ${response.status} ${response.statusText}.`);
  }

  const payload = (await response.json()) as GitHubReleaseApiRecord[];

  return payload.map((release) => ({
    assets: release.assets.map((asset) => ({
      contentType: asset.content_type,
      downloadUrl: asset.browser_download_url,
      name: asset.name,
      size: asset.size,
    })),
    draft: release.draft,
    name: release.name,
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    tagName: release.tag_name,
  }));
}

export function selectCompatibleReleaseAsset(
  releases: readonly ReleaseRecord[],
  runtime: RuntimePlatform,
): CompatibleReleaseAsset {
  const mapping = getPlatformAssetMapping(runtime);

  const compatibleReleases = [...releases]
    .filter((release) => !release.draft)
    .sort(compareReleaseRecords);

  for (const release of compatibleReleases) {
    const assetName = `${mapping.archiveBaseName}-${release.tagName}.${mapping.archiveType}`;
    const asset = release.assets.find((candidate) => candidate.name === assetName);

    if (!asset) {
      continue;
    }

    return {
      archiveType: mapping.archiveType,
      assetName: asset.name,
      downloadUrl: asset.downloadUrl,
      releaseName: release.name,
      releaseTag: release.tagName,
      size: asset.size,
    };
  }

  throw new Error(`No compatible dfixxer release asset was found for ${runtime.platform}-${runtime.arch}.`);
}

function compareReleaseRecords(left: ReleaseRecord, right: ReleaseRecord): number {
  const leftTime = Date.parse(left.publishedAt ?? "1970-01-01T00:00:00.000Z");
  const rightTime = Date.parse(right.publishedAt ?? "1970-01-01T00:00:00.000Z");

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return right.tagName.localeCompare(left.tagName);
}

function getPlatformAssetMapping(runtime: RuntimePlatform): PlatformAssetMapping {
  if (runtime.arch !== "x64") {
    throwUnsupportedPlatform(runtime);
  }

  switch (runtime.platform) {
    case "win32":
      return {
        archiveBaseName: "dfixxer-windows-x86_64",
        archiveType: "zip",
      };
    case "linux":
      return {
        archiveBaseName: "dfixxer-linux-x86_64",
        archiveType: "tar.gz",
      };
    case "darwin":
      return {
        archiveBaseName: "dfixxer-macos-x86_64",
        archiveType: "tar.gz",
      };
    default:
      throwUnsupportedPlatform(runtime);
  }
}

function throwUnsupportedPlatform(runtime: RuntimePlatform): never {
  throw new Error(
    `Managed dfixxer downloads do not support ${runtime.platform}-${runtime.arch}. Set dfixxer.executablePath to a compatible binary instead.`,
  );
}
