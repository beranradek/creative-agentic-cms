export type JobStatus = "processing" | "completed" | "error";

export interface ImageGenJob {
  id: string;
  status: JobStatus;
  tempImageId?: string;
  error?: string;
  createdAt: number;
}

export interface TempImage {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdAt: number;
}

export interface GenerateResponse {
  jobId: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  tempImageId?: string;
  error?: string;
}

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "low" | "medium" | "high";

export const IMAGE_SIZES: ImageSize[] = ["1024x1024", "1024x1536", "1536x1024"];
export const IMAGE_QUALITIES: ImageQuality[] = ["low", "medium", "high"];
