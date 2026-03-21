import { managedDfixxerReleaseTag } from "../../constants";
import * as assert from "node:assert/strict";
import {
  fetchPinnedDfixxerRelease,
  ReleaseRecord,
  selectCompatibleReleaseAsset,
} from "../../releaseClient";

describe("fetchPinnedDfixxerRelease", () => {
  it("maps the pinned GitHub release fields into the internal shape", async () => {
    const release = await fetchPinnedDfixxerRelease(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            assets: [
              {
                browser_download_url: "https://example.invalid/dfixxer.zip",
                content_type: "application/zip",
                name: `dfixxer-windows-x86_64-${managedDfixxerReleaseTag}.zip`,
                size: 123,
              },
            ],
            draft: false,
            name: `Release ${managedDfixxerReleaseTag}`,
            prerelease: false,
            published_at: "2026-03-16T12:00:00Z",
            tag_name: managedDfixxerReleaseTag,
          }),
          { status: 200 },
        ),
      ),
    );

    assert.deepEqual(release, {
      assets: [
        {
          contentType: "application/zip",
          downloadUrl: "https://example.invalid/dfixxer.zip",
          name: `dfixxer-windows-x86_64-${managedDfixxerReleaseTag}.zip`,
          size: 123,
        },
      ],
      draft: false,
      name: `Release ${managedDfixxerReleaseTag}`,
      prerelease: false,
      publishedAt: "2026-03-16T12:00:00Z",
      tagName: managedDfixxerReleaseTag,
    });
  });
});

describe("selectCompatibleReleaseAsset", () => {
  it("selects the asset from the pinned release tag", () => {
    const release: ReleaseRecord = {
      assets: [
        {
          contentType: "application/zip",
          downloadUrl: "https://example.invalid/windows-v0.12.0.zip",
          name: "dfixxer-windows-x86_64-v0.12.0.zip",
          size: 101,
        },
      ],
      draft: false,
      name: "Release v0.12.0",
      prerelease: false,
      publishedAt: "2026-03-16T11:00:00Z",
      tagName: "v0.12.0",
    };

    assert.deepEqual(
      selectCompatibleReleaseAsset(release, { platform: "win32", arch: "x64" }),
      {
        archiveType: "zip",
        assetName: "dfixxer-windows-x86_64-v0.12.0.zip",
        downloadUrl: "https://example.invalid/windows-v0.12.0.zip",
        releaseName: "Release v0.12.0",
        releaseTag: "v0.12.0",
        size: 101,
      },
    );
  });

  it("maps linux and both macOS architectures to the documented archive names", () => {
    const linuxRelease = selectCompatibleReleaseAsset(
      {
        assets: [
          {
            contentType: "application/gzip",
            downloadUrl: "https://example.invalid/linux-v0.12.0.tar.gz",
            name: "dfixxer-linux-x86_64-v0.12.0.tar.gz",
            size: 201,
          },
        ],
        draft: false,
        name: "Release v0.12.0",
        prerelease: false,
        publishedAt: "2026-03-16T12:00:00Z",
        tagName: "v0.12.0",
      },
      { platform: "linux", arch: "x64" },
    );

    const macRelease = selectCompatibleReleaseAsset(
      {
        assets: [
          {
            contentType: "application/gzip",
            downloadUrl: "https://example.invalid/macos-v0.12.0.tar.gz",
            name: "dfixxer-macos-x86_64-v0.12.0.tar.gz",
            size: 202,
          },
        ],
        draft: false,
        name: "Release v0.12.0",
        prerelease: false,
        publishedAt: "2026-03-16T12:00:00Z",
        tagName: "v0.12.0",
      },
      { platform: "darwin", arch: "x64" },
    );

    const macArmRelease = selectCompatibleReleaseAsset(
      {
        assets: [
          {
            contentType: "application/gzip",
            downloadUrl: "https://example.invalid/macos-arm64-v0.12.0.tar.gz",
            name: "dfixxer-macos-arm64-v0.12.0.tar.gz",
            size: 203,
          },
        ],
        draft: false,
        name: "Release v0.12.0",
        prerelease: false,
        publishedAt: "2026-03-17T12:00:00Z",
        tagName: "v0.12.0",
      },
      { platform: "darwin", arch: "arm64" },
    );

    assert.equal(linuxRelease.archiveType, "tar.gz");
    assert.equal(linuxRelease.assetName, "dfixxer-linux-x86_64-v0.12.0.tar.gz");
    assert.equal(macRelease.archiveType, "tar.gz");
    assert.equal(macRelease.assetName, "dfixxer-macos-x86_64-v0.12.0.tar.gz");
    assert.equal(macArmRelease.archiveType, "tar.gz");
    assert.equal(macArmRelease.assetName, "dfixxer-macos-arm64-v0.12.0.tar.gz");
  });

  it("returns an actionable error when the pinned release lacks a matching asset", () => {
    assert.throws(
      () =>
        selectCompatibleReleaseAsset(
          {
            assets: [],
            draft: false,
            name: "Release v0.12.0",
            prerelease: false,
            publishedAt: "2026-03-17T12:00:00Z",
            tagName: "v0.12.0",
          },
          { platform: "linux", arch: "x64" },
        ),
      /does not include a compatible asset/u,
    );
  });

  it("returns an actionable error for unsupported platforms", () => {
    assert.throws(
      () =>
        selectCompatibleReleaseAsset(
          {
            assets: [],
            draft: false,
            name: "Release v0.12.0",
            prerelease: false,
            publishedAt: "2026-03-17T12:00:00Z",
            tagName: "v0.12.0",
          },
          { platform: "linux", arch: "arm64" },
        ),
      /Set dfixxer\.executablePath/u,
    );
  });
});
