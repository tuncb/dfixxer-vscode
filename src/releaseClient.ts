import { managedDfixxerReleaseTag } from "./constants";
import { RuntimePlatform } from "./managedPaths";

const githubPinnedReleaseApiUrl = `https://api.github.com/repos/tuncb/dfixxer/releases/tags/${managedDfixxerReleaseTag}`;

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

export async function fetchPinnedDfixxerRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseRecord> {
  const response = await fetchImpl(githubPinnedReleaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "dfixxer-vscode",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub release query for ${managedDfixxerReleaseTag} failed with ${response.status} ${response.statusText}.`,
    );
  }

  const payload = (await response.json()) as GitHubReleaseApiRecord;

  return {
    assets: payload.assets.map((asset) => ({
      contentType: asset.content_type,
      downloadUrl: asset.browser_download_url,
      name: asset.name,
      size: asset.size,
    })),
    draft: payload.draft,
    name: payload.name,
    prerelease: payload.prerelease,
    publishedAt: payload.published_at,
    tagName: payload.tag_name,
  };
}

export function selectCompatibleReleaseAsset(
  release: ReleaseRecord,
  runtime: RuntimePlatform,
): CompatibleReleaseAsset {
  const mapping = getPlatformAssetMapping(runtime);

  if (release.draft) {
    throw new Error(
      `Pinned dfixxer release ${release.tagName} is a draft and cannot be downloaded automatically.`,
    );
  }

  const assetName = `${mapping.archiveBaseName}-${release.tagName}.${mapping.archiveType}`;
  const asset = release.assets.find((candidate) => candidate.name === assetName);

  if (!asset) {
    throw new Error(
      `Pinned dfixxer release ${release.tagName} does not include a compatible asset for ${runtime.platform}-${runtime.arch}.`,
    );
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

function getPlatformAssetMapping(runtime: RuntimePlatform): PlatformAssetMapping {
  switch (runtime.platform) {
    case "win32":
      if (runtime.arch !== "x64") {
        throwUnsupportedPlatform(runtime);
      }

      return {
        archiveBaseName: "dfixxer-windows-x86_64",
        archiveType: "zip",
      };
    case "linux":
      if (runtime.arch !== "x64") {
        throwUnsupportedPlatform(runtime);
      }

      return {
        archiveBaseName: "dfixxer-linux-x86_64",
        archiveType: "tar.gz",
      };
    case "darwin":
      if (runtime.arch === "arm64") {
        return {
          archiveBaseName: "dfixxer-macos-arm64",
          archiveType: "tar.gz",
        };
      }

      if (runtime.arch !== "x64") {
        throwUnsupportedPlatform(runtime);
      }

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
