import * as assert from "node:assert/strict";
import {
  fetchDfixxerReleases,
  ReleaseRecord,
  selectCompatibleReleaseAsset,
} from "../../releaseClient";

describe("fetchDfixxerReleases", () => {
  it("maps GitHub release fields into the internal shape", async () => {
    const releases = await fetchDfixxerReleases(() =>
      Promise.resolve(
        new Response(
        JSON.stringify([
          {
            assets: [
              {
                browser_download_url: "https://example.invalid/dfixxer.zip",
                content_type: "application/zip",
                name: "dfixxer-windows-x86_64-v0.1.0.zip",
                size: 123,
              },
            ],
            draft: false,
            name: "Release v0.1.0",
            prerelease: false,
            published_at: "2026-03-16T12:00:00Z",
            tag_name: "v0.1.0",
          },
        ]),
          { status: 200 },
        ),
      ),
    );

    assert.deepEqual(releases, [
      {
        assets: [
          {
            contentType: "application/zip",
            downloadUrl: "https://example.invalid/dfixxer.zip",
            name: "dfixxer-windows-x86_64-v0.1.0.zip",
            size: 123,
          },
        ],
        draft: false,
        name: "Release v0.1.0",
        prerelease: false,
        publishedAt: "2026-03-16T12:00:00Z",
        tagName: "v0.1.0",
      },
    ]);
  });
});

describe("selectCompatibleReleaseAsset", () => {
  const releases: ReleaseRecord[] = [
    {
      assets: [
        {
          contentType: "application/zip",
          downloadUrl: "https://example.invalid/windows-v0.11.0-rc.1.zip",
          name: "dfixxer-windows-x86_64-v0.11.0-rc.1.zip",
          size: 101,
        },
      ],
      draft: false,
      name: "Release v0.11.0-rc.1",
      prerelease: true,
      publishedAt: "2026-03-16T11:00:00Z",
      tagName: "v0.11.0-rc.1",
    },
    {
      assets: [
        {
          contentType: "application/zip",
          downloadUrl: "https://example.invalid/windows-v0.11.0.zip",
          name: "dfixxer-windows-x86_64-v0.11.0.zip",
          size: 102,
        },
      ],
      draft: true,
      name: "Release v0.11.0",
      prerelease: false,
      publishedAt: "2026-03-16T12:00:00Z",
      tagName: "v0.11.0",
    },
    {
      assets: [
        {
          contentType: "application/zip",
          downloadUrl: "https://example.invalid/windows-v0.10.0.zip",
          name: "dfixxer-windows-x86_64-v0.10.0.zip",
          size: 100,
        },
      ],
      draft: false,
      name: "Release v0.10.0",
      prerelease: false,
      publishedAt: "2026-03-10T10:00:00Z",
      tagName: "v0.10.0",
    },
  ];

  it("includes prereleases by default and ignores drafts", () => {
    assert.deepEqual(
      selectCompatibleReleaseAsset(releases, { platform: "win32", arch: "x64" }),
      {
        archiveType: "zip",
        assetName: "dfixxer-windows-x86_64-v0.11.0-rc.1.zip",
        downloadUrl: "https://example.invalid/windows-v0.11.0-rc.1.zip",
        releaseName: "Release v0.11.0-rc.1",
        releaseTag: "v0.11.0-rc.1",
        size: 101,
      },
    );
  });

  it("maps linux and macOS assets to the documented archive names", () => {
    const linuxRelease = selectCompatibleReleaseAsset(
      [
        {
          assets: [
            {
              contentType: "application/gzip",
              downloadUrl: "https://example.invalid/linux-v0.11.0.tar.gz",
              name: "dfixxer-linux-x86_64-v0.11.0.tar.gz",
              size: 201,
            },
          ],
          draft: false,
          name: "Release v0.11.0",
          prerelease: false,
          publishedAt: "2026-03-16T12:00:00Z",
          tagName: "v0.11.0",
        },
      ],
      { platform: "linux", arch: "x64" },
    );

    const macRelease = selectCompatibleReleaseAsset(
      [
        {
          assets: [
            {
              contentType: "application/gzip",
              downloadUrl: "https://example.invalid/macos-v0.11.0.tar.gz",
              name: "dfixxer-macos-x86_64-v0.11.0.tar.gz",
              size: 202,
            },
          ],
          draft: false,
          name: "Release v0.11.0",
          prerelease: false,
          publishedAt: "2026-03-16T12:00:00Z",
          tagName: "v0.11.0",
        },
      ],
      { platform: "darwin", arch: "x64" },
    );

    assert.equal(linuxRelease.archiveType, "tar.gz");
    assert.equal(linuxRelease.assetName, "dfixxer-linux-x86_64-v0.11.0.tar.gz");
    assert.equal(macRelease.archiveType, "tar.gz");
    assert.equal(macRelease.assetName, "dfixxer-macos-x86_64-v0.11.0.tar.gz");
  });

  it("returns an actionable error for unsupported platforms", () => {
    assert.throws(
      () => selectCompatibleReleaseAsset(releases, { platform: "linux", arch: "arm64" }),
      /Set dfixxer\.executablePath/u,
    );
  });
});
