export const INSTALL_SEEN_KEY = "emberwalk.installSeen";

export type InstallHint = "ios_safari" | "ios_other" | "prompt";

export type InstallPhone = {
  userAgent: string;
  standalone: boolean;
  installedView: boolean;
  canPrompt: boolean;
  seen: () => boolean;
};

const IOS = /iPhone|iPad|iPod/;
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//;

export const installHint = (phone: InstallPhone): InstallHint | null => {
  if (phone.standalone || phone.installedView || phone.seen()) return null;
  if (IOS.test(phone.userAgent)) return NOT_SAFARI.test(phone.userAgent) ? "ios_other" : "ios_safari";
  return phone.canPrompt ? "prompt" : null;
};

type PromptEvent = Event & { prompt: () => Promise<void> };

let waiting: PromptEvent | null = null;

export const listenForInstall = (onReady: () => void): (() => void) => {
  const keep = (event: Event) => {
    event.preventDefault();
    waiting = event as PromptEvent;
    onReady();
  };
  window.addEventListener("beforeinstallprompt", keep);
  return () => window.removeEventListener("beforeinstallprompt", keep);
};

export const promptInstall = async (): Promise<void> => {
  const event = waiting;
  waiting = null;
  await event?.prompt();
};

export const markInstallSeen = (): void => {
  try {
    window.localStorage.setItem(INSTALL_SEEN_KEY, "on");
  } catch {
    return;
  }
};

export const forgetInstallSeen = (): void => {
  try {
    window.localStorage.removeItem(INSTALL_SEEN_KEY);
  } catch {
    return;
  }
};

const readSeen = (): boolean => {
  try {
    return window.localStorage.getItem(INSTALL_SEEN_KEY) === "on";
  } catch {
    return false;
  }
};

export const thisPhone = (): InstallPhone => ({
  userAgent: navigator.userAgent,
  standalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
  installedView: window.matchMedia?.("(display-mode: standalone)").matches === true,
  canPrompt: waiting !== null,
  seen: readSeen,
});
