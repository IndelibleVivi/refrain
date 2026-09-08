import { describe, expect, it, vi } from "vitest";
import type { DownloadArtifact } from "@refrain/renderer";
import {
  exportCanvasArtifact,
  type CanvasExportHost,
} from "./canvas-export.js";

const jsonFile: DownloadArtifact = {
  filename: "little-air.refrain.json",
  mimeType: "application/json",
  bytes: new TextEncoder().encode('{"exact":true}'),
};

function portableHost(result: { isError?: boolean } = {}): CanvasExportHost {
  return {
    portableDownload: vi.fn().mockResolvedValue(result),
  };
}

describe("Canvas export routing", () => {
  it("uses the feature-detected ChatGPT file route without persisting to the library", async () => {
    const upload = vi.fn().mockResolvedValue({
      fileId: "file_exact",
      fileName: jsonFile.filename,
      mimeType: jsonFile.mimeType,
    });
    const getDownloadUrl = vi
      .fn()
      .mockResolvedValue({ downloadUrl: "https://files.example/export" });
    const openExternal = vi.fn();
    const portableDownload = vi.fn();

    const outcome = await exportCanvasArtifact(jsonFile, {
      chatFile: { upload, getDownloadUrl, openExternal },
      portableDownload,
    });

    expect(outcome.disposition).toBe("downloaded");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(expect.any(File));
    expect(upload.mock.calls[0]).toHaveLength(1);
    const uploaded = upload.mock.calls[0]![0] as File;
    expect(uploaded.name).toBe(jsonFile.filename);
    expect(uploaded.type).toBe(jsonFile.mimeType);
    await expect(uploaded.text()).resolves.toBe('{"exact":true}');
    expect(getDownloadUrl).toHaveBeenCalledWith({
      fileId: "file_exact",
      fileName: jsonFile.filename,
      mimeType: jsonFile.mimeType,
    });
    expect(openExternal).toHaveBeenCalledWith("https://files.example/export", {
      redirectUrl: false,
    });
    expect(portableDownload).not.toHaveBeenCalled();
  });

  it("uses portable ui/download-file when the ChatGPT extension is absent", async () => {
    const host = portableHost();

    const outcome = await exportCanvasArtifact(jsonFile, host);

    expect(outcome.disposition).toBe("downloaded");
    expect(host.portableDownload).toHaveBeenCalledWith({
      contents: [
        {
          type: "resource",
          resource: {
            uri: `file:///${jsonFile.filename}`,
            mimeType: "application/json",
            text: '{"exact":true}',
          },
        },
      ],
    });
  });

  it("copies exact JSON when a portable host rejects download", async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const host = {
      ...portableHost({ isError: true }),
      copyText,
    };

    const outcome = await exportCanvasArtifact(jsonFile, host);

    expect(outcome).toEqual({
      disposition: "copied",
      messageKey: "hostExportCopied",
      message:
        "This host cannot download the file here; its exact JSON was copied to the clipboard.",
    });
    expect(copyText).toHaveBeenCalledWith('{"exact":true}');
  });

  it("does not bypass a rejection on the selected ChatGPT file route", async () => {
    const portableDownload = vi.fn();
    const copyText = vi.fn();

    await expect(
      exportCanvasArtifact(jsonFile, {
        chatFile: {
          upload: vi
            .fn()
            .mockRejectedValue(
              new DOMException("User cancelled", "AbortError"),
            ),
          getDownloadUrl: vi.fn(),
          openExternal: vi.fn(),
        },
        portableDownload,
        copyText,
      }),
    ).rejects.toThrow("Host file export failed (AbortError): User cancelled");
    expect(portableDownload).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
  });

  it("preserves a ChatGPT policy denial from download URL resolution", async () => {
    await expect(
      exportCanvasArtifact(jsonFile, {
        chatFile: {
          upload: vi.fn().mockResolvedValue({ fileId: "file_exact" }),
          getDownloadUrl: vi
            .fn()
            .mockRejectedValue(
              new DOMException(
                "Blocked by workspace file policy",
                "NotAllowedError",
              ),
            ),
          openExternal: vi.fn(),
        },
        portableDownload: vi.fn(),
      }),
    ).rejects.toThrow(
      "Host file export failed (NotAllowedError): Blocked by workspace file policy",
    );
  });

  it("preserves both portable rejection and clipboard denial", async () => {
    await expect(
      exportCanvasArtifact(jsonFile, {
        ...portableHost({ isError: true }),
        copyText: vi
          .fn()
          .mockRejectedValue(
            new DOMException("Permission denied", "NotAllowedError"),
          ),
      }),
    ).rejects.toThrow(
      "The host rejected file download and the clipboard fallback failed (NotAllowedError): Permission denied",
    );
  });

  it("keeps portable rejection distinct when no exact fallback exists", async () => {
    await expect(
      exportCanvasArtifact(
        {
          filename: "air.wav",
          mimeType: "audio/wav",
          bytes: new Uint8Array([82, 73, 70, 70]),
        },
        portableHost({ isError: true }),
      ),
    ).rejects.toThrow(
      "The host rejected or cancelled file download, and no exact export fallback is available.",
    );
  });
});
