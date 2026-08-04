import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-s3", () => {
  const mockSend = vi.fn();
  class MockS3Client {
    send = mockSend;
  }
  class MockCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  return {
    S3Client: MockS3Client as unknown as typeof import("@aws-sdk/client-s3").S3Client,
    CreateBucketCommand: MockCommand as unknown as typeof import("@aws-sdk/client-s3").CreateBucketCommand,
    HeadBucketCommand: MockCommand as unknown as typeof import("@aws-sdk/client-s3").HeadBucketCommand,
    PutObjectCommand: MockCommand as unknown as typeof import("@aws-sdk/client-s3").PutObjectCommand,
    GetObjectCommand: MockCommand as unknown as typeof import("@aws-sdk/client-s3").GetObjectCommand,
    __mockSend: mockSend,
  };
});

import { initS3Client, putObject, getObject } from "../src/lib/s3-client.js";
import { __mockSend } from "@aws-sdk/client-s3";

const testConfig = {
  port: 3000,
  dataDir: "./data",
  jwtSecret: "secret",
  bootstrapApiKey: "key",
  templateRepoUrl: "http://example.com",
  gitDownloadUrl: "",
  adminStaticDir: "",
  minCliVersion: "",
  llmApiKey: "",
  llmModel: "gpt-4o-mini",
  llmBaseUrl: "https://api.openai.com/v1",
  minioEndpoint: "localhost:9000",
  minioAccessKey: "minioadmin",
  minioSecretKey: "minioadmin",
  minioBucket: "test-bucket",
};

describe("s3-client", () => {
  beforeEach(() => {
    __mockSend.mockReset();
  });

  describe("initS3Client", () => {
    it("creates S3 client and ensures bucket exists", async () => {
      __mockSend.mockResolvedValueOnce({});
      await initS3Client(testConfig);
      expect(__mockSend).toHaveBeenCalledTimes(1);
    });

    it("creates bucket when it does not exist", async () => {
      const notFound = new Error("NotFound");
      (notFound as { name: string }).name = "NotFound";
      __mockSend.mockRejectedValueOnce(notFound).mockResolvedValueOnce({});
      await initS3Client(testConfig);
      expect(__mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("putObject", () => {
    it("sends PutObjectCommand with correct params", async () => {
      __mockSend.mockResolvedValueOnce({});
      await initS3Client(testConfig);
      __mockSend.mockResolvedValueOnce({});

      await putObject("user/app/file.png", Buffer.from("data"), "image/png");

      const lastCall = __mockSend.mock.calls[1][0];
      expect(lastCall.input.Bucket).toBe("test-bucket");
      expect(lastCall.input.Key).toBe("user/app/file.png");
      expect(lastCall.input.ContentType).toBe("image/png");
    });
  });

  describe("getObject", () => {
    it("returns body and contentType when object exists", async () => {
      __mockSend.mockResolvedValueOnce({});
      await initS3Client(testConfig);

      const bodyBytes = new Uint8Array([1, 2, 3]);
      __mockSend.mockResolvedValueOnce({
        Body: { transformToByteArray: () => Promise.resolve(bodyBytes) },
        ContentType: "image/png",
      });

      const result = await getObject("user/app/file.png");
      expect(result).toEqual({
        body: Buffer.from(bodyBytes),
        contentType: "image/png",
      });
    });

    it("returns null when object does not exist", async () => {
      __mockSend.mockResolvedValueOnce({});
      await initS3Client(testConfig);

      const err = new Error("no such key");
      (err as { name: string }).name = "NoSuchKey";
      __mockSend.mockRejectedValueOnce(err);

      const result = await getObject("nonexistent");
      expect(result).toBeNull();
    });
  });
});
