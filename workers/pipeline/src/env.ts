export type PipelineParams = { walkId: string };

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  PIPELINE: Workflow<PipelineParams>;
  MEDIA_CONTAINER: Fetcher;
  R2_HOST: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  META_API_KEY?: string;
  META_BASE_URL: string;
  META_BILLING: string;
  SWEEP_AFTER_HOURS?: string;
  VOICE_NOTES?: string;
};
