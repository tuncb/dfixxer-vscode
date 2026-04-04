import { managedDfixxerReleaseTag } from "../../constants";
import * as assert from "node:assert/strict";
import {
  fetchPinnedDfixxerRelease,
  ReleaseRecord,
  selectCompatibleReleaseAsset,
} from "../../releaseClient";

const releaseTag = managedDfixxerReleaseTag;

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
          downloadUrl: `https://example.invalid/windows-${releaseTag}.zip`,
          name: `dfixxer-windows-x86_64-${releaseTag}.zip`,
          size: 101,
        },
      ],
      draft: false,
      name: `Release ${releaseTag}`,
      prerelease: false,
      publishedAt: "2026-03-16T11:00:00Z",
      tagName: releaseTag,
    };

    assert.deepEqual(
      selectCompatibleReleaseAsset(release, { platform: "win32", arch: "x64" }),
      {
        archiveType: "zip",
        assetName: `dfixxer-windows-x86_64-${releaseTag}.zip`,
        downloadUrl: `https://example.invalid/windows-${releaseTag}.zip`,
        releaseName: `Release ${releaseTag}`,
        releaseTag,
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
            downloadUrl: `https://example.invalid/linux-${releaseTag}.tar.gz`,
            name: `dfixxer-linux-x86_64-${releaseTag}.tar.gz`,
            size: 201,
          },
        ],
        draft: false,
        name: `Release ${releaseTag}`,
        prerelease: false,
        publishedAt: "2026-03-16T12:00:00Z",
        tagName: releaseTag,
      },
      { platform: "linux", arch: "x64" },
    );

    const macRelease = selectCompatibleReleaseAsset(
      {
        assets: [
          {
            contentType: "application/gzip",
            downloadUrl: `https://example.invalid/macos-${releaseTag}.tar.gz`,
            name: `dfixxer-macos-x86_64-${releaseTag}.tar.gz`,
            size: 202,
          },
        ],
        draft: false,
        name: `Release ${releaseTag}`,
        prerelease: false,
        publishedAt: "2026-03-16T12:00:00Z",
        tagName: releaseTag,
      },
      { platform: "darwin", arch: "x64" },
    );

    const macArmRelease = selectCompatibleReleaseAsset(
      {
        assets: [
          {
            contentType: "application/gzip",
            downloadUrl: `https://example.invalid/macos-arm64-${releaseTag}.tar.gz`,
            name: `dfixxer-macos-arm64-${releaseTag}.tar.gz`,
            size: 203,
          },
        ],
        draft: false,
        name: `Release ${releaseTag}`,
        prerelease: false,
        publishedAt: "2026-03-17T12:00:00Z",
        tagName: releaseTag,
      },
      { platform: "darwin", arch: "arm64" },
    );

    assert.equal(linuxRelease.archiveType, "tar.gz");
    assert.equal(linuxRelease.assetName, `dfixxer-linux-x86_64-${releaseTag}.tar.gz`);
    assert.equal(macRelease.archiveType, "tar.gz");
    assert.equal(macRelease.assetName, `dfixxer-macos-x86_64-${releaseTag}.tar.gz`);
    assert.equal(macArmRelease.archiveType, "tar.gz");
    assert.equal(macArmRelease.assetName, `dfixxer-macos-arm64-${releaseTag}.tar.gz`);
  });

  it("returns an actionable error when the pinned release lacks a matching asset", () => {
    assert.throws(
      () =>
        selectCompatibleReleaseAsset(
          {
            assets: [],
            draft: false,
            name: `Release ${releaseTag}`,
            prerelease: false,
            publishedAt: "2026-03-17T12:00:00Z",
            tagName: releaseTag,
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
            name: `Release ${releaseTag}`,
            prerelease: false,
            publishedAt: "2026-03-17T12:00:00Z",
            tagName: releaseTag,
          },
          { platform: "linux", arch: "arm64" },
        ),
      /Set dfixxer\.executablePath/u,
    );
  });
});
