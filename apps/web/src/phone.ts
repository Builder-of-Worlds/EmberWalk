export type PhoneEnv = {
  canShareFiles(files: File[]): boolean;
  share(data: { files: File[]; text: string }): Promise<void>;
  openText(url: string): void;
  copy(text: string): Promise<boolean>;
};

export const smsUrl = (phone: string, body: string): string => `sms:${phone}?&body=${encodeURIComponent(body)}`;

export const shareWasCancelled = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";

export const browserPhone = (nav: Navigator, open: (url: string) => void): PhoneEnv => ({
  canShareFiles: (files) => typeof nav.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files }),
  share: (data) => nav.share(data),
  openText: open,
  copy: async (text) => {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
});
