import type {
  DownloadArtifact,
  DownloadArtifactOutcome,
} from "@refrain/renderer";
import type { DownloadFn } from "skybridge/web";

interface FileMetadata {
  fileId: string;
  fileName?: string;
  mimeType?: string;
}

export interface CanvasExportHost {
  chatFile?: {
    upload: (file: File) => Promise<FileMetadata>;
    getDownloadUrl: (file: FileMetadata) => Promise<{ downloadUrl: string }>;
    openExternal: (href: string, options?: { redirectUrl?: false }) => void;
  };
  portableDownload: DownloadFn;
  copyText?: (text: string) => Promise<void>;
}

export type CanvasExportOutcome = DownloadArtifactOutcome;

function isTextFile(file: DownloadArtifact): boolean {
  return (
    file.mimeType.startsWith("text/") || file.mimeType === "application/json"
  );
}

function failureMessage(prefix: string, cause: unknown): string {
  if (cause instanceof Error) {
    const name = cause.name && cause.name !== "Error" ? ` (${cause.name})` : "";
    return `${prefix}${name}: ${cause.message}`;
  }
  return `${prefix}: ${String(cause)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function portableDownloadParams(
  file: DownloadArtifact,
): Promise<Parameters<DownloadFn>[0]> {
  const resource = isTextFile(file)
    ? {
        uri: `file:///${file.filename}`,
        mimeType: file.mimeType,
        text: new TextDecoder().decode(file.bytes),
      }
    : {
        uri: `file:///${file.filename}`,
        mimeType: file.mimeType,
        blob: bytesToBase64(file.bytes),
      };
  return {
    contents: [
      {
        type: "resource",
        resource,
      },
    ],
  };
}

export async function exportCanvasArtifact(
  file: DownloadArtifact,
  host: CanvasExportHost,
): Promise<CanvasExportOutcome> {
  if (host.chatFile) {
    try {
      const browserFile = new File(
        [Uint8Array.from(file.bytes).buffer],
        file.filename,
        { type: file.mimeType },
      );
      const metadata = await host.chatFile.upload(browserFile);
      const { downloadUrl } = await host.chatFile.getDownloadUrl(metadata);
      host.chatFile.openExternal(downloadUrl, { redirectUrl: false });
      return {
        disposition: "downloaded",
        message: "File export opened through this host.",
        messageKey: "hostExportOpened",
      };
    } catch (cause) {
      throw new Error(failureMessage("Host file export failed", cause), {
        cause,
      });
    }
  }

  const result = await host.portableDownload(
    await portableDownloadParams(file),
  );
  if (!result.isError) {
    return {
      disposition: "downloaded",
      message: "File export accepted by this host.",
      messageKey: "hostExportAccepted",
    };
  }

  if (isTextFile(file) && host.copyText) {
    try {
      await host.copyText(new TextDecoder().decode(file.bytes));
      return {
        disposition: "copied",
        message:
          "This host cannot download the file here; its exact JSON was copied to the clipboard.",
        messageKey: "hostExportCopied",
      };
    } catch (cause) {
      throw new Error(
        failureMessage(
          "The host rejected file download and the clipboard fallback failed",
          cause,
        ),
        { cause },
      );
    }
  }

  throw new Error(
    "The host rejected or cancelled file download, and no exact export fallback is available.",
  );
}
