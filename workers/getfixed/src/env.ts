export type TimerParams = { messageId: string };

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  FOLLOW_UP_TIMER: Workflow<TimerParams>;
  GET_IT_FIXED: string;
  META_API_KEY?: string;
  META_BASE_URL: string;
  META_BILLING: string;
  RESEND_API_KEY?: string;
  MAIL_FOOTER?: string;
  OPTOUT_SECRET?: string;
  JOB_MAIL_DOMAIN: string;
  APP_ORIGIN: string;
  FOLLOW_UP_AFTER: string;
};
