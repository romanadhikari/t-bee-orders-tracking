import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { RequestOrderImageUploadBody, RequestOrderImageUploadResponse } from "@workspace/api-zod";
import { db, orderItemsTable, ordersTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import { checkSameOrigin, requireTbeeAdmin } from "../middlewares/tbeeAdmin";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const uploadedImagePathPattern = /^\/objects\/uploads\/[0-9a-f-]{36}$/i;

function hasExpectedSignature(contentType: string, bytes: Buffer): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (contentType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

export async function validateUploadedProductImages(
  paths: Array<string | null | undefined>,
): Promise<void> {
  for (const path of new Set(paths.filter((value): value is string => Boolean(value)))) {
    if (!uploadedImagePathPattern.test(path)) {
      throw new Error("Product image reference is invalid.");
    }
    const file = await objectStorage.getObjectEntityFile(path);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (size < 1 || size > MAX_IMAGE_BYTES || !allowedMimeTypes.has(contentType)) {
      throw new Error("Product images must be JPG, PNG or WebP files up to 5 MB.");
    }
    const [bytes] = await file.download({ start: 0, end: 15 });
    if (!hasExpectedSignature(contentType, bytes)) {
      throw new Error("The uploaded file is not a supported image.");
    }
  }
}

router.post(
  "/storage/uploads/request-url",
  requireTbeeAdmin,
  async (req: Request, res: Response) => {
    if (!checkSameOrigin(req, res)) {
      return;
    }

    const parsed = RequestOrderImageUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a JPG, PNG or WebP image up to 5 MB." });
      return;
    }

    try {
      const { size, contentType } = parsed.data;
      if (!allowedMimeTypes.has(contentType) || size > MAX_IMAGE_BYTES) {
        res.status(400).json({ error: "Choose a JPG, PNG or WebP image up to 5 MB." });
        return;
      }

      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      res.json(RequestOrderImageUploadResponse.parse({ uploadURL, objectPath }));
    } catch (error) {
      req.log.error({ err: error }, "Could not create T-Bee product-image upload URL");
      res.status(500).json({ error: "Could not prepare the image upload." });
    }
  },
);

router.get(
  "/storage/objects/*path",
  async (req: Request, res: Response) => {
    try {
      const rawPath = req.params.path;
      const entityPath = `/objects/${Array.isArray(rawPath) ? rawPath.join("/") : rawPath}`;
      if (!uploadedImagePathPattern.test(entityPath)) {
        res.status(404).json({ error: "Image not found." });
        return;
      }

      const [linkedImage] = await db
        .select({ id: orderItemsTable.id })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(
          and(
            eq(orderItemsTable.imagePath, entityPath),
            isNull(ordersTable.archivedAt),
          ),
        )
        .limit(1);
      if (!linkedImage) {
        res.status(404).json({ error: "Image not found." });
        return;
      }

      const file = await objectStorage.getObjectEntityFile(entityPath);
      const response = await objectStorage.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "cache-control") {
          res.setHeader(key, "public, max-age=3600");
        } else {
          res.setHeader(key, value);
        }
      });

      if (response.body) {
        Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Image not found." });
        return;
      }
      req.log.error({ err: error }, "Could not serve T-Bee product image");
      res.status(500).json({ error: "Could not load the image." });
    }
  },
);

export default router;
